import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { ActaSignature } from '../entities/acta-signature.entity';
import { Acta } from '../entities/acta.entity';
import { Participant } from '../../participants/entities/participant.entity';
import { AuthUser } from '../../../common/decorators/current-user.decorator';

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
