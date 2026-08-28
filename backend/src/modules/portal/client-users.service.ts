import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { QueryFailedError } from 'typeorm';

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

/** Código con el que MySQL/mysql2 reporta un choque contra una clave única. */
const MYSQL_DUPLICATE_ENTRY = 'ER_DUP_ENTRY';

/**
 * Se discrimina por el código de error del driver, nunca por el texto del
 * mensaje: `sqlMessage` cambia de redacción entre versiones de MySQL/mysql2 y
 * no es un contrato estable. `QueryFailedError` copia las propiedades del
 * error del driver sobre sí mismo (ver `driverError` más abajo), así que se
 * lee de ahí y no de `err.message`.
 */
function isDuplicateEntryError(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const driverError = err.driverError as { code?: string } | undefined;
  return driverError?.code === MYSQL_DUPLICATE_ENTRY;
}

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
   * El usuario de cliente dueño de esa dirección, o `null`. Sin decorar a
   * `ClientUserView`: quien llama (la ingesta de correo) necesita `clientId`
   * y `isActive` tal cual vienen de la fila, no la vista que se publica al
   * panel.
   */
  findByEmail(email: string): Promise<ClientUser | null> {
    return this.repo.findByEmail(email);
  }

  /**
   * `staffUserId` viene de la sesión del panel (`created_by`), nunca del
   * cuerpo. El cliente se valida antes de tocar `client_users`: un
   * `clientId` inexistente no debe dejar una fila huérfana.
   */
  async create(staffUserId: number, dto: CreateClientUserDto): Promise<ClientUserView> {
    await this.clients.findByIdOrFail(dto.clientId);

    // Comprobación previa: da un mensaje mejor y basta para el caso normal.
    // No basta para el caso concurrente: dos altas con el mismo correo pueden
    // pasar ambas por aquí antes de que cualquiera escriba. La red para esa
    // carrera es el catch de más abajo, sobre el propio INSERT.
    const existing = await this.repo.findByEmail(dto.email);
    if (existing) {
      throw this.duplicateEmailConflict(dto.email);
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    try {
      const created = await this.repo.create({
        clientId: dto.clientId,
        email: dto.email,
        passwordHash,
        fullName: dto.fullName,
        isAdmin: dto.isAdmin ? 1 : 0,
        createdBy: staffUserId,
        // Explícito, no por omisión: este alta la hace el personal, así que la
        // columna del administrador de cliente tiene que quedar vacía y tiene
        // que verse que se quiere vacía.
        createdByClientUserId: null,
      });
      return toView(created);
    } catch (err) {
      // Solo el choque de clave duplicada se traduce a 409: el resto de
      // fallos de escritura (una caída de conexión, una columna que no
      // encaja) no son de este servicio decidirlos y deben seguir subiendo
      // tal cual, como el 500 genérico que de verdad son.
      if (isDuplicateEntryError(err)) {
        throw this.duplicateEmailConflict(dto.email);
      }
      throw err;
    }
  }

  /**
   * Mismo cuerpo tanto si lo detecta la comprobación previa como si lo
   * detecta la carrera: el cliente de la API no debe distinguir dos formas
   * del mismo error.
   */
  private duplicateEmailConflict(email: string): ConflictException {
    return new ConflictException({
      code: 'CONFLICT',
      message: `Ya existe un usuario de cliente con el correo ${email}`,
    });
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
