import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientUser } from './entities/client-user.entity';

/**
 * Recorta y pone en minúsculas `email` antes de guardar. `findByEmail` ya
 * normalizaba al leer, pero `create`/`update` guardaban el correo tal cual
 * llegara: esa asimetría dejaba la garantía de "un correo, una fila" en manos
 * de que cada consumidor futuro recordara normalizar por su cuenta. Puesta
 * aquí, en el repositorio, es estructural — no depende de que nadie se
 * acuerde.
 */
function normalizeEmail(data: Partial<ClientUser>): Partial<ClientUser> {
  if (data.email === undefined) return data;
  return { ...data, email: data.email.trim().toLowerCase() };
}

@Injectable()
export class ClientUsersRepository {
  constructor(@InjectRepository(ClientUser) private readonly repo: Repository<ClientUser>) {}

  findByEmail(email: string): Promise<ClientUser | null> {
    return this.repo.findOne({ where: { email: email.trim().toLowerCase() } });
  }

  findById(id: number): Promise<ClientUser | null> {
    return this.repo.findOne({ where: { id } });
  }

  listByClient(clientId: number): Promise<ClientUser[]> {
    return this.repo.find({ where: { clientId }, order: { fullName: 'ASC' } });
  }

  create(data: Partial<ClientUser>): Promise<ClientUser> {
    return this.repo.save(this.repo.create(normalizeEmail(data)));
  }

  async update(id: number, data: Partial<ClientUser>): Promise<ClientUser | null> {
    await this.repo.update(id, normalizeEmail(data));
    return this.findById(id);
  }

  async touchLastLogin(id: number): Promise<void> {
    await this.repo.update(id, { lastLoginAt: new Date() });
  }
}
