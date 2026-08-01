import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientUser } from './entities/client-user.entity';

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
    return this.repo.save(this.repo.create(data));
  }

  async update(id: number, data: Partial<ClientUser>): Promise<ClientUser | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }

  async touchLastLogin(id: number): Promise<void> {
    await this.repo.update(id, { lastLoginAt: new Date() });
  }
}
