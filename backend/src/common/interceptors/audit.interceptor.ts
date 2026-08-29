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
    return { request: scrubSecrets(body), response: scrubSecrets(response) };
  }
}

/**
 * Cualquier clave que **contenga** `password`, `secret` o `token`, sin
 * distinguir mayúsculas.
 *
 * Por patrón y no por lista exacta, y ahí está toda la diferencia. La lista
 * anterior nombraba cuatro claves (`password`, `passwordHash`, `accessToken`,
 * `refreshToken`), así que dejaba pasar EN CLARO las dos del cuerpo de aceptar
 * una invitación: `secret` —el enlace vivo, que el resto de ese módulo trabaja
 * para que no exista escrito en ningún sitio salvo el correo— y
 * `passwordConfirmation`, que ES la contraseña, porque el servicio exige que
 * las dos sean idénticas antes de tocar nada. El asiento quedaba en
 * `audit_log`, que se lee desde el panel y viaja en cada respaldo de la base:
 * el secreto al menos se consume al usarse, la contraseña no caduca nunca. Y
 * era invisible —no falla nada— porque el tachado no tenía ninguna prueba.
 *
 * El defecto se repetiría con el próximo campo que estrene un nombre
 * (`newPassword`, `apiToken`, `webhookSecret`…); el patrón lo cierra de raíz.
 *
 * Lo que NO se hace es convertirlo en lista blanca —tachar todo salvo lo
 * permitido—: este interceptor es global y una lista blanca se comería la
 * auditoría útil de todo el sistema.
 */
const CLAVE_SENSIBLE = /password|secret|token/i;

/** Lo que se guarda en lugar del valor sensible. */
const TACHADO = '***';

/**
 * Hasta dónde se baja. Ni los cuerpos ni las respuestas de este producto
 * anidan tanto; el tope está para que una estructura inesperada no convierta
 * el tachado en un recorrido caro dentro de una petición.
 */
const PROFUNDIDAD_MAXIMA = 8;

/**
 * Tacha en TODOS los niveles, no solo en el primero.
 *
 * El tachado anterior era un `{ ...o }` de un nivel: una contraseña a un solo
 * salto de profundidad —`{ usuario: { password } }`, o cualquier cuerpo
 * anidado que llegue mañana— se escribía tal cual. Aquí se recorre el árbol
 * entero.
 *
 * Tres cuidados:
 *
 *  - `Date` y `Buffer` se devuelven tal cual: recorrerlos los convertiría en
 *    `{}` y el asiento perdería el dato.
 *  - `ancestros` es el CAMINO, no todo lo ya visto: se borra al salir. Así un
 *    mismo objeto repetido en dos ramas —una entidad compartida— se serializa
 *    las dos veces, y solo un ciclo de verdad se corta.
 *  - lo que no es objeto vuelve tal cual: el tachado se decide por la CLAVE,
 *    nunca por el valor. Una contraseña no se reconoce mirándola.
 */
function scrubSecrets(
  value: unknown,
  depth = 0,
  ancestros: WeakSet<object> = new WeakSet(),
): unknown {
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (depth >= PROFUNDIDAD_MAXIMA) return '[...]';
  if (ancestros.has(value)) return '[circular]';

  ancestros.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => scrubSecrets(item, depth + 1, ancestros));
    }
    const salida: Record<string, unknown> = {};
    for (const [clave, valor] of Object.entries(value as Record<string, unknown>)) {
      salida[clave] = CLAVE_SENSIBLE.test(clave)
        ? TACHADO
        : scrubSecrets(valor, depth + 1, ancestros);
    }
    return salida;
  } finally {
    ancestros.delete(value);
  }
}
