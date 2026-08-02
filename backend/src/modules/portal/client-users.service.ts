import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { ClientsService } from '../clients/clients.service';
import { ClientUsersRepository } from './client-users.repository';
import { ClientUser } from './entities/client-user.entity';
import { ClientUserView, CreateClientUserDto, UpdateClientUserDto } from './dto/client-user.dto';

/**
 * Mismo coste que el hash señuelo de `PortalAuthService` (ver
 * `DECOY_PASSWORD_HASH`): las tres rutas de fallo del login pagan el mismo
 * `bcrypt.compare` porque el señuelo se calculó a coste 10. Un alta con otro
 * coste no rompería el login, pero sí reabriría el canal de tiempos que ese
 * señuelo existe para cerrar.
 */
const BCRYPT_ROUNDS = 10;

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Campo por campo, nunca con spread ni delete: si mañana `client_users` gana
 * una columna, el panel no la publica por defecto y, sobre todo, jamás sale
 * `passwordHash`.
 */
function toView(u: ClientUser): ClientUserView {
  return {
    id: Number(u.id),
    clientId: Number(u.clientId),
    email: u.email,
    fullName: u.fullName,
    isAdmin: !!u.isAdmin,
    isActive: !!u.isActive,
    lastLoginAt: toIso(u.lastLoginAt),
    createdAt: toIso(u.createdAt)!,
    updatedAt: toIso(u.updatedAt)!,
  };
}

@Injectable()
export class ClientUsersService {
  constructor(
    private readonly repo: ClientUsersRepository,
    private readonly clients: ClientsService,
  ) {}

  async listByClient(clientId: number): Promise<ClientUserView[]> {
    const rows = await this.repo.listByClient(clientId);
    return rows.map(toView);
  }

  /**
   * `staffUserId` viene de la sesión del panel (`created_by`), nunca del
   * cuerpo. El cliente se valida antes de tocar `client_users`: un
   * `clientId` inexistente no debe dejar una fila huérfana.
   */
  async create(staffUserId: number, dto: CreateClientUserDto): Promise<ClientUserView> {
    await this.clients.findByIdOrFail(dto.clientId);

    // Comprobación previa en español de negocio; el índice único de la base
    // (case-insensitive por la collation de la columna) es la red de
    // seguridad ante una carrera, no la primera línea.
    const existing = await this.repo.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `Ya existe un usuario de cliente con el correo ${dto.email}`,
      });
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const created = await this.repo.create({
      clientId: dto.clientId,
      email: dto.email,
      passwordHash,
      fullName: dto.fullName,
      isAdmin: dto.isAdmin ? 1 : 0,
      createdBy: staffUserId,
    });
    return toView(created);
  }

  /**
   * Nunca lee `clientId` del dto: el tipo ya no lo declara, y aunque llegara
   * por un cuerpo manipulado, este método no lo copiaría al parche.
   */
  async update(id: number, dto: UpdateClientUserDto): Promise<ClientUserView> {
    await this.findByIdOrFail(id);

    const patch: Partial<ClientUser> = {};
    if (dto.fullName !== undefined) patch.fullName = dto.fullName;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive ? 1 : 0;
    if (dto.isAdmin !== undefined) patch.isAdmin = dto.isAdmin ? 1 : 0;
    if (dto.password !== undefined) {
      patch.passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    }

    const updated = await this.repo.update(id, patch);
    return toView(updated!);
  }

  private async findByIdOrFail(id: number): Promise<ClientUser> {
    const u = await this.repo.findById(id);
    if (!u) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Usuario de cliente no encontrado',
      });
    }
    return u;
  }
}
