import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Agreement } from './entities/agreement.entity';
import { Commitment } from './entities/commitment.entity';
import {
  CreateAgreementDto,
  UpdateAgreementDto,
} from './dto/agreement.dto';
import {
  CreateCommitmentDto,
  UpdateCommitmentDto,
} from './dto/commitment.dto';

@Injectable()
export class AgreementsService {
  constructor(
    @InjectRepository(Agreement) private readonly agreementRepo: Repository<Agreement>,
    @InjectRepository(Commitment) private readonly commitmentRepo: Repository<Commitment>,
  ) {}

  // Agreements --------------------------------------------------------------
  listAgreements(actaId: number): Promise<Agreement[]> {
    return this.agreementRepo.find({ where: { actaId }, order: { orderIndex: 'ASC' } });
  }

  createAgreement(actaId: number, dto: CreateAgreementDto): Promise<Agreement> {
    return this.agreementRepo.save(
      this.agreementRepo.create({ actaId, ...dto, orderIndex: dto.orderIndex ?? 0 }),
    );
  }

  async updateAgreement(id: number, dto: UpdateAgreementDto): Promise<Agreement> {
    const a = await this.agreementRepo.findOne({ where: { id } });
    if (!a) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Acuerdo no encontrado' });
    Object.assign(a, dto);
    return this.agreementRepo.save(a);
  }

  async removeAgreement(id: number): Promise<void> {
    await this.agreementRepo.delete(id);
  }

  // Commitments -------------------------------------------------------------
  listCommitments(actaId: number): Promise<Commitment[]> {
    return this.commitmentRepo.find({ where: { actaId }, order: { dueDate: 'ASC' } });
  }

  createCommitment(actaId: number, dto: CreateCommitmentDto): Promise<Commitment> {
    return this.commitmentRepo.save(
      this.commitmentRepo.create({
        actaId,
        description: dto.description,
        assigneeUserId: dto.assigneeUserId ?? null,
        assigneeName: dto.assigneeName ?? null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      }),
    );
  }

  async updateCommitment(id: number, dto: UpdateCommitmentDto): Promise<Commitment> {
    const c = await this.commitmentRepo.findOne({ where: { id } });
    if (!c) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Compromiso no encontrado' });
    Object.assign(c, {
      ...dto,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : c.dueDate,
    });
    return this.commitmentRepo.save(c);
  }

  async removeCommitment(id: number): Promise<void> {
    await this.commitmentRepo.delete(id);
  }
}
