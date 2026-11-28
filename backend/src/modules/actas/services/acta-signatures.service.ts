import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { ActaSignature } from '../entities/acta-signature.entity';
import { Acta } from '../entities/acta.entity';
import { Participant } from '../../participants/entities/participant.entity';
import { AuthUser } from '../../../common/decorators/current-user.decorator';

/** Un trazo de firma comprimido pesa unas decenas de KB; más que esto no es una firma. */
export const MAX_SIGNATURE_PNG_BYTES = 300 * 1024;
const PNG_MAGIC = '89504e470d0a1a0a';

export interface InPersonSignatureInput {
  /** Participante ya registrado; si falta, se crea con nombre y DNI. */
  participantId?: number;
  signerName?: string;
  signerDocument?: string;
  signerRole?: string;
  /** data:image/png;base64,… del trazo hecho con el dedo o el Apple Pencil. */
  signaturePng: string;
}

function decodeSignaturePng(dataUrl: string): Buffer {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? '').trim());
  const buf = m ? Buffer.from(m[1], 'base64') : Buffer.alloc(0);
  if (buf.length === 0 || buf.subarray(0, 8).toString('hex') !== PNG_MAGIC) {
    throw new BadRequestException({ code: 'BAD_INPUT', message: 'Falta el trazo de la firma (imagen PNG).' });
  }
  if (buf.length > MAX_SIGNATURE_PNG_BYTES) {
    throw new BadRequestException({ code: 'BAD_INPUT', message: 'El trazo de la firma es demasiado grande.' });
  }
  return buf;
}

@Injectable()
export class ActaSignaturesService {
  constructor(
    @InjectRepository(ActaSignature) private readonly repo: Repository<ActaSignature>,
    @InjectRepository(Acta) private readonly actas: Repository<Acta>,
    @InjectRepository(Participant) private readonly participants: Repository<Participant>,
  ) {}

  listByActa(actaId: number): Promise<ActaSignature[]> {
    return this.repo.find({ where: { actaId }, order: { signedAt: 'ASC' } });
  }

  async sign(
    actaId: number,
    participantId: number,
    user: AuthUser,
    ipAddress: string | null,
  ): Promise<ActaSignature> {
    const acta = await this.actas.findOne({ where: { id: actaId } });
    if (!acta) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Acta no encontrada' });
    if (!['APPROVED', 'EXPORTED', 'IN_REVIEW'].includes(acta.status)) {
      throw new BadRequestException({
        code: 'CONFLICT',
        message: 'El acta debe estar en revisión o aprobada antes de firmar',
      });
    }

    const participant = await this.participants.findOne({ where: { id: participantId } });
    if (!participant || Number(participant.meetingId) !== Number(acta.meetingId)) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'El participante no pertenece a esta reunión',
      });
    }
    if (!participant.attended) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'Solo pueden firmar los participantes que asistieron',
      });
    }

    if (participant.userId != null && Number(participant.userId) !== user.id) {
      throw new BadRequestException({
        code: 'FORBIDDEN',
        message: 'Solo el propio participante puede firmar por sí mismo',
      });
    }

    const existing = await this.repo.findOne({ where: { actaId, participantId } });
    if (existing) {
      throw new BadRequestException({
        code: 'CONFLICT',
        message: 'Este participante ya firmó el acta',
      });
    }

    const payload = [
      acta.id,
      acta.version,
      participant.id,
      participant.fullName,
      participant.documentNumber ?? '',
      user.id,
      new Date().toISOString(),
      acta.contentMarkdown,
    ].join('|');
    const signatureHash = createHash('sha256').update(payload).digest('hex');

    const sig = this.repo.create({
      actaId,
      participantId,
      signedByUser: user.id,
      signerName: participant.fullName,
      signerDocument: participant.documentNumber ?? null,
      signerRole: participant.role ?? null,
      signatureHash,
      ipAddress,
    });
    return this.repo.save(sig);
  }

  /**
   * Firma presencial en el iPad (spec 2026-11-28-metodologia-ia-hoja-de-ruta, entrega 2):
   * el operador (usuario del equipo con sesión) recoge la firma de un asistente. Si no
   * está registrado, se agrega como participante que asistió, con nombre y DNI. La
   * huella incluye el trazo, así que cambiar la imagen después la invalida.
   */
  async signInPerson(
    actaId: number,
    input: InPersonSignatureInput,
    operator: AuthUser,
    ipAddress: string | null,
  ): Promise<ActaSignature> {
    const png = decodeSignaturePng(input.signaturePng);
    const acta = await this.actas.findOne({ where: { id: actaId } });
    if (!acta) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Acta no encontrada' });
    if (!['APPROVED', 'EXPORTED', 'IN_REVIEW'].includes(acta.status)) {
      throw new BadRequestException({ code: 'CONFLICT', message: 'El acta debe estar en revisión o aprobada antes de firmar' });
    }

    let participant: Participant | null;
    if (input.participantId) {
      participant = await this.participants.findOne({ where: { id: input.participantId } });
      if (!participant || Number(participant.meetingId) !== Number(acta.meetingId)) {
        throw new BadRequestException({ code: 'BAD_REQUEST', message: 'El participante no pertenece a esta reunión' });
      }
    } else {
      const name = String(input.signerName ?? '').trim();
      const doc = String(input.signerDocument ?? '').trim();
      if (!name || !doc) {
        throw new BadRequestException({ code: 'BAD_INPUT', message: 'Indica el nombre y el DNI de quien firma.' });
      }
      participant = await this.participants.save(
        this.participants.create({
          meetingId: Number(acta.meetingId),
          userId: null,
          fullName: name.slice(0, 180),
          documentNumber: doc.slice(0, 40),
          role: input.signerRole?.trim().slice(0, 80) || null,
          attended: 1,
        } as Partial<Participant>),
      );
    }

    if (await this.repo.findOne({ where: { actaId, participantId: Number(participant.id) } })) {
      throw new BadRequestException({ code: 'CONFLICT', message: 'Este participante ya firmó el acta' });
    }

    const payload = [
      acta.id, acta.version, participant.id, participant.fullName, participant.documentNumber ?? '',
      'IN_PERSON', operator.id, new Date().toISOString(), acta.contentMarkdown,
      createHash('sha256').update(png).digest('hex'),
    ].join('|');

    return this.repo.save(
      this.repo.create({
        actaId,
        participantId: Number(participant.id),
        signedByUser: operator.id,
        signerName: participant.fullName,
        signerDocument: participant.documentNumber ?? null,
        signerRole: participant.role ?? null,
        signatureHash: createHash('sha256').update(payload).digest('hex'),
        method: 'IN_PERSON',
        signaturePng: png,
        ipAddress,
      }),
    );
  }

  /** Trazos de las firmas presenciales (para el PDF y la imagen). */
  async signaturesWithImages(actaId: number): Promise<ActaSignature[]> {
    return this.repo
      .createQueryBuilder('s')
      .addSelect('s.signaturePng')
      .where('s.acta_id = :actaId', { actaId })
      .orderBy('s.signed_at', 'ASC')
      .getMany();
  }

  async revoke(id: number, user: AuthUser): Promise<void> {
    const sig = await this.repo.findOne({ where: { id } });
    if (!sig) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Firma no encontrada' });
    const isAdmin = user.role === 'ADMIN';
    const isOwner = sig.signedByUser != null && Number(sig.signedByUser) === user.id;
    if (!isAdmin && !isOwner) {
      throw new BadRequestException({
        code: 'FORBIDDEN',
        message: 'No puedes revocar una firma ajena',
      });
    }
    await this.repo.delete(id);
  }
}
