import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { System } from './entities/system.entity';

@Injectable()
export class SystemsRepository {
  constructor(@InjectRepository(System) private readonly repo: Repository<System>) {}

  list(): Promise<System[]> {
    return this.repo.find({ order: { name: 'ASC' } });
  }

  listActive(): Promise<System[]> {
    return this.repo.find({ where: { isActive: 1 }, order: { name: 'ASC' } });
  }

  findById(id: number): Promise<System | null> {
    return this.repo.findOne({ where: { id } });
  }

  /**
   * Por `name` tal cual: la colación `utf8mb4_unicode_ci` de la tabla ya no
   * distingue mayúsculas, así que no hace falta `LOWER(...)` --y añadirlo
   * impediría usar `uq_systems_name`--.
   */
  findByName(name: string): Promise<System | null> {
    return this.repo.findOne({ where: { name } });
  }

  create(data: Partial<System>): Promise<System> {
    return this.repo.save(this.repo.create(data));
  }

  async update(id: number, data: Partial<System>): Promise<System | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
