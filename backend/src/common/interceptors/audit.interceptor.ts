import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../../modules/audit/entities/audit-log.entity';

/**
 * Quién viene en `req.user`. El interceptor es global, así que atiende a los
 * dos tipos de sesión: `JwtStrategy` deja `{ id, email, role }` para el
 * personal y `ClientJwtStrategy` deja un `AuthClientUser`
 * (`{ clientUserId, email, clientId, isClientAdmin }`), que **no tiene `id`**.
 */
type AuditPrincipal = { id?: number | null; clientUserId?: number | null };

/** Cómo queda atribuido el asiento. Las dos columnas nunca van juntas. */
interface AuditActor {
  userId: number | null;
  clientUserId: number | null;
}

/**
 * Registra toda acción mutante (POST/PATCH/PUT/DELETE) en `audit_log`.
 * Lee `user` inyectado por `JwtAuthGuard` / `ClientJwtGuard` y resuelve la
 * acción desde la ruta.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuditPrincipal }>();
    const method = req.method.toUpperCase();
    const isMutation = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);
    const actor = AuditInterceptor.resolveActor(req.user);

    return next.handle().pipe(
      tap(async (response) => {
        if (!isMutation) return;
        try {
          const entry = this.repo.create({
            userId: actor.userId,
            clientUserId: actor.clientUserId,
            action: `${method} ${req.route?.path ?? req.url}`,
            entityType: this.resolveEntity(req.url),
            entityId: (response as { id?: number | string })?.id?.toString() ?? null,
            payloadJson: this.safePayload(req.body, response),
            ipAddress: req.ip ?? null,
            userAgent: req.headers['user-agent']?.toString() ?? null,
          });
          await this.repo.save(entry);
        } catch (err) {
          this.logger.warn(`Audit log write failed: ${(err as Error).message}`);
        }
      }),
    );
  }

  /**
   * Reparte la autoría en la columna que le corresponde.
   *
   * El `clientUserId` no puede ir en `user_id`: se confundiría con un
   * identificador de `users` y, además, esa columna tiene FK a `users(id)` —
   * el INSERT fallaría y el asiento se perdería entero (el catch de arriba lo
   * degradaría a un warn). Va en `client_user_id` (migración 014).
   *
   * El personal tiene prioridad por si alguna vez llegara un objeto con las
   * dos marcas: entre atribuir a un id de `users` o a uno de `client_users`,
   * la sesión de personal es la que gobierna la petición.
   *
   * Las dos nulas siguen significando "sistema" (o petición sin sesión, como
   * el propio login: ahí todavía no hay principal, ni del personal ni del
   * portal).
   */
  private static resolveActor(user: AuditPrincipal | undefined): AuditActor {
    if (user?.id !== undefined && user.id !== null) {
      return { userId: user.id, clientUserId: null };
    }
    if (user?.clientUserId !== undefined && user.clientUserId !== null) {
      return { userId: null, clientUserId: user.clientUserId };
    }
    return { userId: null, clientUserId: null };
  }

  private resolveEntity(url: string): string {
    const m = url.match(/\/api\/v1\/([^/?]+)/);
    return (m?.[1] ?? 'unknown').toUpperCase();
  }

  private safePayload(body: unknown, response: unknown): Record<string, unknown> {
    const scrub = (o: unknown): unknown => {
      if (!o || typeof o !== 'object') return o;
      const clone: Record<string, unknown> = { ...(o as Record<string, unknown>) };
      for (const k of ['password', 'passwordHash', 'accessToken', 'refreshToken']) {
        if (k in clone) clone[k] = '***';
      }
      return clone;
    };
    return { request: scrub(body), response: scrub(response) };
  }
}
