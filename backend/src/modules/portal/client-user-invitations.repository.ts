import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, MoreThan, Repository } from 'typeorm';

import { ClientUserInvitation } from './entities/client-user-invitation.entity';
import { normalizeEmailAddress } from './email-address';

/** Lo mínimo para crear una invitación. Sin `usedAt` ni `revokedAt`: nace viva. */
export interface NewInvitation {
  clientId: number;
  email: string;
  fullName: string;
  /** La huella, nunca el secreto. Ver `domain/invitation-secret.ts`. */
  secretFingerprint: string;
  invitedByClientUserId: number;
  expiresAt: Date;
}

@Injectable()
export class ClientUserInvitationsRepository {
  constructor(
    @InjectRepository(ClientUserInvitation)
    private readonly repo: Repository<ClientUserInvitation>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Ejecuta `work` dentro de una única transacción. Quien llame debe hacer
   * TODAS sus escrituras a través del `EntityManager` que recibe
   * (`manager.getRepository(...)`), nunca de los repositorios inyectados por
   * Nest: solo así comparten conexión y confirman o revierten juntas. Copia
   * literal del criterio de `TicketsRepository.runInTransaction`.
   */
  runInTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }

  create(data: NewInvitation): Promise<ClientUserInvitation> {
    return this.repo.save(
      this.repo.create({ ...data, email: normalizeEmailAddress(data.email) }),
    );
  }

  /**
   * La invitación viva de esa dirección, si la hay: sin usar, sin revocar y
   * sin caducar. Los tres en el `WHERE`, no en un `if` posterior — la consulta
   * no debe poder devolver nunca una invitación gastada.
   */
  findLiveByEmail(email: string, now: Date): Promise<ClientUserInvitation | null> {
    return this.repo.findOne({
      where: {
        email: normalizeEmailAddress(email),
        usedAt: IsNull(),
        revokedAt: IsNull(),
        expiresAt: MoreThan(now),
      },
    });
  }

  /** Las pendientes de esa empresa, de la más reciente a la más antigua. */
  listPendingByClient(clientId: number, now: Date): Promise<ClientUserInvitation[]> {
    return this.repo.find({
      where: { clientId, usedAt: IsNull(), revokedAt: IsNull(), expiresAt: MoreThan(now) },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Una invitación pendiente concreta de esa empresa. El `clientId` va en el
   * `WHERE` y no en una comprobación posterior: la consulta no debe devolver
   * ni un instante una invitación de otra empresa. Quien llame convierte el
   * `null` en 404, nunca en 403.
   */
  findPendingByIdForClient(id: number, clientId: number): Promise<ClientUserInvitation | null> {
    return this.repo.findOne({
      where: { id, clientId, usedAt: IsNull(), revokedAt: IsNull() },
    });
  }

  /**
   * Invalida las invitaciones vivas de esa dirección **dentro de esa
   * empresa**. El `clientId` no es adorno: sin él, invitar desde la empresa B
   * a una dirección que la empresa A tiene pendiente le anularía la invitación
   * a A, un efecto cruzado entre empresas por la puerta de atrás.
   */
  async revokeLiveByEmail(email: string, clientId: number, revokedAt: Date): Promise<void> {
    await this.repo.update(
      {
        email: normalizeEmailAddress(email),
        clientId,
        usedAt: IsNull(),
        revokedAt: IsNull(),
      },
      { revokedAt },
    );
  }

  /**
   * Deja constancia del último intento de envío. `sendError` a `null` cuando
   * fue bien, para que un error viejo no quede colgando y la pantalla no siga
   * enseñando un fallo que ya se resolvió reenviando.
   */
  async markSent(id: number, sentAt: Date, sendError: string | null): Promise<void> {
    await this.repo.update(id, { lastSentAt: sentAt, sendError });
  }
}
