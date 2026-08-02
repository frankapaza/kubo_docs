import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { NotificationAudience } from './domain/template-renderer';
import { NotificationTemplate } from './entities/notification-template.entity';

/** Valor de `is_active` que marca una plantilla encendida. */
const ACTIVE = 1;

@Injectable()
export class NotificationTemplatesRepository {
  constructor(
    @InjectRepository(NotificationTemplate)
    private readonly repo: Repository<NotificationTemplate>,
  ) {}

  /** Todas las plantillas, activas e inactivas: el panel debe poder verlas y reactivarlas. */
  findAll(): Promise<NotificationTemplate[]> {
    return this.repo.find({ order: { audience: 'ASC', triggerKey: 'ASC' } });
  }

  findById(id: number): Promise<NotificationTemplate | null> {
    return this.repo.findOne({ where: { id } });
  }

  /**
   * Solo devuelve la plantilla si sigue activa. El filtro va en la propia
   * consulta -- no en un descarte posterior en el servicio -- porque
   * desactivar una plantilla es la forma de apagar ese aviso concreto sin
   * tocar código, y ese camino tiene que funcionar de verdad.
   */
  findActive(triggerKey: string, audience: NotificationAudience): Promise<NotificationTemplate | null> {
    return this.repo.findOne({ where: { triggerKey, audience, isActive: ACTIVE } });
  }

  async update(id: number, data: Partial<NotificationTemplate>): Promise<NotificationTemplate | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }
}
