import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { Client, ClientStatus } from './entities/client.entity';

@Injectable()
export class ClientsRepository {
  constructor(@InjectRepository(Client) private readonly repo: Repository<Client>) {}

  /**
   * Clientes que ya operan (tickets propios no internos o usuarios del portal
   * activos) sin ningún sistema activo: sus tickets no pueden clasificarse ni
   * llegar al conector MCP. Los ex clientes no cuentan.
   */
  async listWithoutActiveSystems(): Promise<Array<{ id: number; razonSocial: string; tickets: number; usuariosPortal: number }>> {
    const rows: Array<{ id: string | number; razonSocial: string; tickets: string | number; usuariosPortal: string | number }> = await this.repo.query(
      `SELECT c.id AS id, c.razon_social AS razonSocial,
              (SELECT COUNT(*) FROM tickets t WHERE t.client_id = c.id AND t.origin <> 'MONITOREO') AS tickets,
              (SELECT COUNT(*) FROM client_users u WHERE u.client_id = c.id AND u.is_active = 1) AS usuariosPortal
         FROM clients c
        WHERE c.status <> 'FORMER_CLIENT'
          AND NOT EXISTS (SELECT 1 FROM client_systems cs WHERE cs.client_id = c.id AND cs.is_active = 1)
       HAVING tickets > 0 OR usuariosPortal > 0
        ORDER BY c.razon_social`,
    );
    return rows.map((r) => ({ id: Number(r.id), razonSocial: r.razonSocial, tickets: Number(r.tickets), usuariosPortal: Number(r.usuariosPortal) }));
  }

  async list(params: { status?: ClientStatus; q?: string }): Promise<Client[]> {
    const where: Record<string, unknown> = {};
    if (params.status) where.status = params.status;
    if (params.q) where.razonSocial = Like(`%${params.q}%`);
    return this.repo.find({ where, order: { razonSocial: 'ASC' } });
  }

  findById(id: number): Promise<Client | null> {
    return this.repo.findOne({ where: { id } });
  }

  findByRuc(ruc: string): Promise<Client | null> {
    return this.repo.findOne({ where: { ruc } });
  }

  create(data: Partial<Client>): Promise<Client> {
    return this.repo.save(this.repo.create(data));
  }

  async update(id: number, data: Partial<Client>): Promise<Client | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
