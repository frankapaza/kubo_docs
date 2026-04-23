import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ClientsRepository } from './clients.repository';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { Client, ClientStatus } from './entities/client.entity';

@Injectable()
export class ClientsService {
  constructor(private readonly repo: ClientsRepository) {}

  async findByIdOrFail(id: number): Promise<Client> {
    const c = await this.repo.findById(id);
    if (!c) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Cliente no encontrado' });
    return c;
  }

  list(params: { status?: ClientStatus; q?: string }): Promise<Client[]> {
    return this.repo.list(params);
  }

  async create(userId: number, dto: CreateClientDto): Promise<Client> {
    if (dto.ruc) {
      const exists = await this.repo.findByRuc(dto.ruc);
      if (exists) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: `Ya existe un cliente con RUC ${dto.ruc} (${exists.razonSocial})`,
        });
      }
    }
    return this.repo.create({
      razonSocial: dto.razonSocial,
      ruc: dto.ruc ?? null,
      jiraCode: dto.jiraCode?.toUpperCase() ?? null,
      legalRepName: dto.legalRepName ?? null,
      legalRepDoc: dto.legalRepDoc ?? null,
      address: dto.address ?? null,
      phone: dto.phone ?? null,
      contactEmail: dto.contactEmail ?? null,
      status: dto.status ?? 'PROSPECT',
      notes: dto.notes ?? null,
      createdBy: userId,
    });
  }

  async update(id: number, dto: UpdateClientDto): Promise<Client> {
    await this.findByIdOrFail(id);
    if (dto.ruc) {
      const other = await this.repo.findByRuc(dto.ruc);
      if (other && other.id !== id) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: `Ya existe otro cliente con RUC ${dto.ruc}`,
        });
      }
    }
    const patch: Partial<Client> = { ...dto } as Partial<Client>;
    if (patch.jiraCode) patch.jiraCode = patch.jiraCode.toUpperCase();
    const updated = await this.repo.update(id, patch);
    return updated!;
  }

  async remove(id: number): Promise<void> {
    await this.findByIdOrFail(id);
    await this.repo.remove(id);
  }
}
