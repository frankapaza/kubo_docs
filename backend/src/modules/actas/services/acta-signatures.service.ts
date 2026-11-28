import { BadRequestException, ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { assertImageDimensions } from './image-guard';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { ActaSignature } from '../entities/acta-signature.entity';
import { Acta } from '../entities/acta.entity';
import { Participant } from '../../participants/entities/participant.entity';
import { Meeting } from '../../meetings/entities/meeting.entity';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { formatPeruDateTime } from '../../../common/peru-date-time';
import { emailButton, escapeEmailHtml } from '../../email/email-layout';
import { EmailService } from '../../email/email.service';

/** Días que vale el enlace de confirmación por correo. */
const CONFIRM_DAYS = 7;
const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

/**
 * Una firma cuenta cuando está completa: con usuario o trazo, sí; por correo, cuando
 * confirmó; con ambos, cuando hay trazo y confirmó.
 */
export function isSignatureComplete(
  s: Pick<ActaSignature, 'method' | 'emailConfirmedAt'> & {
    signaturePng?: Buffer | null;
  },
): boolean {
  if (s.method === 'EMAIL') return !!s.emailConfirmedAt;
  if (s.method === 'BOTH' || s.method === 'REMOTE') return !!s.emailConfirmedAt;
  return true;
}

export interface EmailSignatureInput extends Partial<InPersonSignatureInput> {
  mode: 'EMAIL' | 'BOTH' | 'REMOTE';
  /** Correo al que se envía el enlace; si falta, el del participante. */
  signerEmail?: string;
}

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
    throw new BadRequestException({
      code: 'BAD_INPUT',
      message: 'Falta el trazo de la firma (imagen PNG).',
    });
  }
  if (buf.length > MAX_SIGNATURE_PNG_BYTES) {
    throw new BadRequestException({
      code: 'BAD_INPUT',
      message: 'El trazo de la firma es demasiado grande.',
    });
  }
  assertImageDimensions(buf, 3000);
  return buf;
}

@Injectable()
export class ActaSignaturesService {
  constructor(
    @InjectRepository(ActaSignature)
    private readonly repo: Repository<ActaSignature>,
    @InjectRepository(Acta) private readonly actas: Repository<Acta>,
    @InjectRepository(Participant)
    private readonly participants: Repository<Participant>,
    @InjectRepository(Meeting) private readonly meetings: Repository<Meeting>,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Firma por correo (EMAIL) o con trazo + correo (BOTH): queda pendiente hasta que la
   * persona abre el enlace y confirma. Solo se guarda la huella del enlace.
   */
  async requestByEmail(
    actaId: number,
    input: EmailSignatureInput,
    operator: AuthUser,
    ipAddress: string | null,
  ): Promise<ActaSignature> {
    const png = input.mode === 'BOTH' ? decodeSignaturePng(input.signaturePng ?? '') : null;
    const remote = input.mode === 'REMOTE';
    const { acta, participant, created } = await this.resolveSigner(actaId, input);
    // El enlace de un participante con correo va a su correo: no se puede desviar a otro.
    const own = participant.email?.trim().toLowerCase() || null;
    const asked = input.signerEmail?.trim().toLowerCase() || null;
    if (own && asked && asked !== own) {
      if (created) await this.participants.delete({ id: Number(participant.id) });
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: `El enlace solo se puede enviar al correo registrado del participante (${own}). Corrige el participante si cambió.`,
      });
    }
    const to = String(own ?? asked ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'Indica un correo válido para enviar la confirmación.',
      });
    }
    if (
      await this.repo.findOne({
        where: { actaId, participantId: Number(participant.id) },
      })
    ) {
      throw new BadRequestException({
        code: 'CONFLICT',
        message: 'Este participante ya firmó o tiene una firma pendiente',
      });
    }

    const token = randomBytes(32).toString('base64url');
    const payload = [
      acta.id,
      acta.version,
      participant.id,
      participant.fullName,
      participant.documentNumber ?? '',
      input.mode,
      to,
      operator.id,
      new Date().toISOString(),
      acta.contentMarkdown,
      png ? sha256(png) : '',
    ].join('|');
    const sig = await this.repo.save(
      this.repo.create({
        actaId,
        participantId: Number(participant.id),
        signedByUser: operator.id,
        signerName: participant.fullName,
        signerDocument: participant.documentNumber ?? null,
        signerRole: participant.role ?? null,
        signatureHash: sha256(payload),
        method: input.mode,
        signaturePng: png,
        confirmEmail: to,
        confirmTokenHash: sha256(token),
        confirmExpiresAt: new Date(Date.now() + CONFIRM_DAYS * 24 * 3600_000),
        actaVersion: Number(acta.version),
        emailConfirmedAt: null,
        ipAddress,
      }),
    );

    const meeting = await this.meetings.findOne({
      where: { id: Number(acta.meetingId) },
    });
    const title = meeting?.title ?? `Reunión ${acta.meetingId}`;
    const base = ((this.config.get<string>('FRONTEND_URL') || '').trim() || 'http://localhost:5173').replace(
      /\/+$/,
      '',
    );
    const link = `${base}/firmar-acta/${token}`;
    const cuando = meeting?.scheduledAt ? formatPeruDateTime(new Date(meeting.scheduledAt)) : '';
    // Si el correo no sale, la firma no puede quedar pendiente de un enlace que nadie recibió.
    try {
      await this.email.send({
        to,
        subject: remote ? `Firma el acta: ${title}` : `Confirma tu firma del acta: ${title}`,
        text: `Hola ${participant.fullName}:\n\n${remote ? 'Revisa y firma' : 'Confirma que estás de acuerdo con'} el acta de «${title}»${cuando ? ` (${cuando})` : ''}:\n${link}\n\nEl enlace vence en ${CONFIRM_DAYS} días.`,
        html:
          `<p style="margin:0 0 12px">Hola <strong>${escapeEmailHtml(participant.fullName)}</strong>:</p>` +
          (remote
            ? `<p style="margin:0 0 6px">Te pedimos revisar y <strong>firmar</strong> el acta de <strong>${escapeEmailHtml(title)}</strong>${cuando ? ` (${escapeEmailHtml(cuando)})` : ''}. Puedes firmar con el dedo, el mouse o un lápiz desde tu propio dispositivo.</p>`
            : `<p style="margin:0 0 6px">Te pedimos confirmar que estás de acuerdo con el acta de <strong>${escapeEmailHtml(title)}</strong>${cuando ? ` (${escapeEmailHtml(cuando)})` : ''}.</p>`) +
          emailButton(link, remote ? 'Revisar y firmar el acta' : 'Revisar y confirmar el acta') +
          `<p style="margin:0;font-size:12px;color:#7a8794">El enlace vence en ${CONFIRM_DAYS} días y solo se puede usar una vez.</p>`,
      });
    } catch (e) {
      await this.repo.delete({ id: sig.id });
      // Tampoco queda el asistente que se agregó solo para esta firma.
      if (created) await this.participants.delete({ id: Number(participant.id) });
      throw e;
    }
    sig.confirmTokenHash = sha256(token);
    return sig;
  }

  /** Lo que ve la persona al abrir el enlace (sin sesión). */
  async previewByToken(token: string): Promise<{
    signerName: string;
    meetingTitle: string;
    actaMarkdown: string;
    status: 'PENDIENTE' | 'CONFIRMADA';
    /** Firma a distancia: la persona dibuja su firma en la página del enlace. */
    needsDrawing: boolean;
  }> {
    const sig = await this.byToken(token);
    const acta = await this.actas.findOne({
      where: { id: Number(sig.actaId) },
    });
    const meeting = acta ? await this.meetings.findOne({ where: { id: Number(acta.meetingId) } }) : null;
    return {
      signerName: sig.signerName,
      meetingTitle: meeting?.title ?? 'Reunión',
      actaMarkdown: acta?.contentMarkdown ?? '',
      status: sig.emailConfirmedAt ? 'CONFIRMADA' : 'PENDIENTE',
      needsDrawing: sig.method === 'REMOTE',
    };
  }

  /**
   * Envía el enlace de firma a distancia a cada asistente con correo que aún no firmó
   * (reuniones por Meet). Devuelve a quién se envió y a quién no, con el motivo.
   */
  async requestRemoteForAll(
    actaId: number,
    operator: AuthUser,
    ipAddress: string | null,
  ): Promise<{ sent: string[]; skipped: Array<{ name: string; reason: string }> }> {
    const acta = await this.actas.findOne({ where: { id: actaId } });
    if (!acta) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Acta no encontrada' });
    const attendees = await this.participants.find({ where: { meetingId: Number(acta.meetingId), attended: 1 } });
    const sent: string[] = [];
    const skipped: Array<{ name: string; reason: string }> = [];
    for (const p of attendees) {
      if (await this.repo.findOne({ where: { actaId, participantId: Number(p.id) } })) continue;
      if (!p.email?.trim()) {
        skipped.push({ name: p.fullName, reason: 'sin correo' });
        continue;
      }
      try {
        await this.requestByEmail(actaId, { participantId: Number(p.id), mode: 'REMOTE' }, operator, ipAddress);
        sent.push(p.fullName);
      } catch (e) {
        skipped.push({ name: p.fullName, reason: (e as { message?: string }).message ?? 'no se pudo enviar' });
      }
    }
    return { sent, skipped };
  }

  async confirmByToken(token: string, ipAddress: string | null, signaturePng?: string): Promise<ActaSignature> {
    const sig = await this.byToken(token);
    // Lo que se confirma es el acta tal como estaba al enviar el enlace.
    const acta = await this.actas.findOne({ where: { id: Number(sig.actaId) } });
    if (!acta || !['APPROVED', 'EXPORTED', 'IN_REVIEW'].includes(acta.status)) {
      throw new ConflictException({ code: 'CONFLICT', message: 'El acta ya no está disponible para firmar.' });
    }
    if (sig.actaVersion != null && Number(acta.version) !== Number(sig.actaVersion)) {
      throw new ConflictException({ code: 'ACTA_CHANGED', message: 'El acta cambió desde que se envió el enlace. Pide un enlace nuevo.' });
    }
    // A distancia, la firma es el trazo que la persona dibuja en la página del enlace.
    const png = sig.method === 'REMOTE' ? decodeSignaturePng(signaturePng ?? '') : null;
    const confirmedAt = new Date();
    const signatureHash = sha256(
      [sig.signatureHash, 'confirmado', confirmedAt.toISOString(), ipAddress ?? '',
        png ? sha256(png) : '', sha256(acta.contentMarkdown ?? '')].join('|'),
    );
    const patch: Partial<ActaSignature> = { emailConfirmedAt: confirmedAt, confirmTokenHash: null, signatureHash };
    if (png) patch.signaturePng = png;
    // Condicional: dos clics simultáneos no confirman dos veces el mismo enlace.
    const res = await this.repo.update({ id: sig.id, confirmTokenHash: sha256(String(token)) }, patch);
    if (!res.affected) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'El enlace no es válido o ya se usó.' });
    }
    return Object.assign(sig, patch);
  }

  private async byToken(token: string): Promise<ActaSignature> {
    const t = String(token ?? '');
    const sig = /^[A-Za-z0-9_-]{20,100}$/.test(t)
      ? await this.repo.findOne({ where: { confirmTokenHash: sha256(t) } })
      : null;
    if (!sig)
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'El enlace no es válido o ya se usó.',
      });
    if (sig.confirmExpiresAt && sig.confirmExpiresAt.getTime() < Date.now()) {
      throw new GoneException({
        code: 'EXPIRED',
        message: 'El enlace venció. Pide que te lo envíen de nuevo.',
      });
    }
    return sig;
  }

  /** Acta firmable y participante (existente, o nuevo con nombre y DNI). */
  private async resolveSigner(
    actaId: number,
    input: Partial<InPersonSignatureInput>,
  ): Promise<{ acta: Acta; participant: Participant; created: boolean }> {
    const acta = await this.actas.findOne({ where: { id: actaId } });
    if (!acta)
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Acta no encontrada',
      });
    if (!['APPROVED', 'EXPORTED', 'IN_REVIEW'].includes(acta.status)) {
      throw new BadRequestException({
        code: 'CONFLICT',
        message: 'El acta debe estar en revisión o aprobada antes de firmar',
      });
    }
    if (input.participantId) {
      const p = await this.participants.findOne({
        where: { id: input.participantId },
      });
      if (!p || Number(p.meetingId) !== Number(acta.meetingId)) {
        throw new BadRequestException({
          code: 'BAD_REQUEST',
          message: 'El participante no pertenece a esta reunión',
        });
      }
      return { acta, participant: p, created: false };
    }
    const name = String(input.signerName ?? '').trim();
    const doc = String(input.signerDocument ?? '').trim();
    if (!name || !doc) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'Indica el nombre y el DNI de quien firma.',
      });
    }
    const participant = await this.participants.save(
      this.participants.create({
        meetingId: Number(acta.meetingId),
        userId: null,
        fullName: name.slice(0, 180),
        documentNumber: doc.slice(0, 40),
        role: input.signerRole?.trim().slice(0, 80) || null,
        attended: 1,
      } as Partial<Participant>),
    );
    return { acta, participant, created: true };
  }

  listByActa(actaId: number): Promise<ActaSignature[]> {
    return this.repo.find({ where: { actaId }, order: { signedAt: 'ASC' } });
  }

  async sign(actaId: number, participantId: number, user: AuthUser, ipAddress: string | null): Promise<ActaSignature> {
    const acta = await this.actas.findOne({ where: { id: actaId } });
    if (!acta)
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Acta no encontrada',
      });
    if (!['APPROVED', 'EXPORTED', 'IN_REVIEW'].includes(acta.status)) {
      throw new BadRequestException({
        code: 'CONFLICT',
        message: 'El acta debe estar en revisión o aprobada antes de firmar',
      });
    }

    const participant = await this.participants.findOne({
      where: { id: participantId },
    });
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

    const existing = await this.repo.findOne({
      where: { actaId, participantId },
    });
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
    if (!acta)
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Acta no encontrada',
      });
    if (!['APPROVED', 'EXPORTED', 'IN_REVIEW'].includes(acta.status)) {
      throw new BadRequestException({
        code: 'CONFLICT',
        message: 'El acta debe estar en revisión o aprobada antes de firmar',
      });
    }

    let participant: Participant | null;
    if (input.participantId) {
      participant = await this.participants.findOne({
        where: { id: input.participantId },
      });
      if (!participant || Number(participant.meetingId) !== Number(acta.meetingId)) {
        throw new BadRequestException({
          code: 'BAD_REQUEST',
          message: 'El participante no pertenece a esta reunión',
        });
      }
    } else {
      const name = String(input.signerName ?? '').trim();
      const doc = String(input.signerDocument ?? '').trim();
      if (!name || !doc) {
        throw new BadRequestException({
          code: 'BAD_INPUT',
          message: 'Indica el nombre y el DNI de quien firma.',
        });
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

    if (
      await this.repo.findOne({
        where: { actaId, participantId: Number(participant.id) },
      })
    ) {
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
      'IN_PERSON',
      operator.id,
      new Date().toISOString(),
      acta.contentMarkdown,
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
    if (!sig)
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Firma no encontrada',
      });
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
