import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * La frontera entre el personal y los usuarios de cliente (Tarea 3 del portal)
 * es criptográfica: `JwtStrategy` firma y valida con `JWT_ACCESS_SECRET` y
 * `ClientJwtStrategy` con `JWT_CLIENT_ACCESS_SECRET`. Un token de cliente no
 * valida contra la estrategia del personal porque las firmas no coinciden.
 *
 * Toda esa garantía se apoya en una precondición que no estaba vigilada por
 * nada: que los secretos sean realmente distintos. Si alguien copia el mismo
 * valor en `JWT_ACCESS_SECRET` y en `JWT_CLIENT_ACCESS_SECRET`, un token de
 * cliente pasa a validar contra `JwtStrategy`, y las tres barreras caen a la
 * vez:
 *
 *  1) La firma coincide, así que `JwtAuthGuard` lo acepta.
 *  2) `JwtStrategy.validate()` devuelve solo `{ id, email, role }` — descarta
 *     `clientId`. `StaffOnlyGuard` busca `clientId`/`clientUserId` en
 *     `request.user` y no encuentra ninguno, así que lo deja pasar. La lista
 *     blanca de la estrategia, que normalmente ayuda, aquí juega en contra.
 *  3) `RolesGuard` solo frena las rutas con `@Roles`. Las clases sin `@Roles`
 *     (tickets, work-items, agenda, participants, transcriptions, agents,
 *     agreements, audio, client-systems) quedarían abiertas a un usuario de
 *     cliente con `role: undefined`.
 *
 * Por eso la comprobación va aquí, al arranque, y tira el error en vez de
 * dejar que la app acepte tráfico en ese estado. Sigue la forma de
 * `DbTimezoneInitializer`: hacer explícita al boot una precondición que de
 * otro modo solo se nota cuando ya es tarde.
 *
 * Sobre la severidad, dos niveles distintos a propósito:
 *
 *  - **Ausencia y colisión abortan en cualquier entorno.** Son el fallo de
 *    seguridad descrito arriba y no se relajan ni en local.
 *  - **Los placeholders abortan salvo en `development`/`test` declarados**,
 *    donde solo avisan. `backend/.env.example` reparte `change-me-access` a
 *    propósito para que un clon recién hecho arranque; abortar ahí rompería
 *    el arranque del repo sin ganar seguridad, porque el riesgo real es un
 *    despliegue publicado con el literal commiteado. La comprobación falla
 *    cerrado: si `NODE_ENV` no está definido, se considera entorno serio y
 *    aborta.
 *
 * Este validador es también lo que vuelve inalcanzable el valor por defecto
 * `'change-me-client'` de `ClientJwtStrategy` en un entorno mal configurado,
 * sin necesidad de tocar esa línea.
 */
@Injectable()
export class JwtSecretsValidator implements OnApplicationBootstrap {
  private readonly logger = new Logger('JwtSecretsValidator');

  /** Los cuatro secretos que sostienen la separación personal / cliente. */
  private static readonly KEYS = [
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'JWT_CLIENT_ACCESS_SECRET',
    'JWT_CLIENT_REFRESH_SECRET',
  ] as const;

  /**
   * Prefijos de los valores de ejemplo que reparten `backend/.env.example`,
   * `.env.production.example` y los `cfg.get(..., default)` del código.
   */
  private static readonly PLACEHOLDER_PREFIXES = ['change-me', 'cambiar'];

  /** Entornos donde un placeholder avisa en vez de abortar. */
  private static readonly LAX_ENVS = ['development', 'test'];

  constructor(private readonly cfg: ConfigService) {}

  onApplicationBootstrap(): void {
    const present = new Map<string, string>();
    const missing: string[] = [];

    for (const key of JwtSecretsValidator.KEYS) {
      const value = (this.cfg.get<string>(key) ?? '').trim();
      if (value) present.set(key, value);
      else missing.push(key);
    }

    if (missing.length > 0) {
      throw new Error(
        `Faltan secretos JWT obligatorios: ${missing.join(', ')}. La separación entre el ` +
          'personal interno y los usuarios del portal de clientes se apoya en que cada lado ' +
          'firme con su propio secreto; sin ellos definidos la app usaría los valores por ' +
          'defecto del código, que son públicos. Defínelos en el entorno (en producción, ' +
          'en el bloque environment: del servicio backend de docker-compose.yml) y genéralos ' +
          'con: openssl rand -base64 48',
      );
    }

    this.assertAllDistinct(present);
    this.checkPlaceholders(present);

    this.logger.log(
      'Los cuatro secretos JWT están presentes y son distintos entre sí: la frontera ' +
        'entre el personal y los usuarios de cliente es criptográficamente efectiva.',
    );
  }

  /**
   * Dos secretos iguales bastan para romper la frontera, así que se comparan
   * los cuatro entre sí y no solo el par personal/cliente: reutilizar el
   * secreto de refresco como el de acceso también es un fallo.
   */
  private assertAllDistinct(present: Map<string, string>): void {
    const firstSeenBy = new Map<string, string>();
    const collisions: string[] = [];

    for (const [key, value] of present) {
      const previous = firstSeenBy.get(value);
      if (previous) collisions.push(`${previous} y ${key}`);
      else firstSeenBy.set(value, key);
    }

    if (collisions.length > 0) {
      throw new Error(
        `Los cuatro secretos JWT deben ser distintos entre sí, y hay valores repetidos: ` +
          `${collisions.join('; ')}. Con el secreto del personal y el del portal iguales, un ` +
          'token de cliente valida contra la estrategia del personal: JwtAuthGuard lo acepta, ' +
          'StaffOnlyGuard no lo detecta porque JwtStrategy.validate() descarta el clientId, y ' +
          'RolesGuard solo cubre las rutas con @Roles. Genera un valor propio para cada uno ' +
          'con: openssl rand -base64 48',
      );
    }
  }

  private checkPlaceholders(present: Map<string, string>): void {
    const offenders = [...present]
      .filter(([, value]) => JwtSecretsValidator.isPlaceholder(value))
      .map(([key]) => key);

    if (offenders.length === 0) return;

    const detail =
      `Estos secretos JWT conservan un valor placeholder de ejemplo: ${offenders.join(', ')}. ` +
      'Son literales commiteados y públicos: cualquiera puede firmar un token válido con el ' +
      'clientId o el role que quiera. Genera uno propio para cada uno con: ' +
      'openssl rand -base64 48';

    const nodeEnv = (this.cfg.get<string>('NODE_ENV') ?? '').trim().toLowerCase();

    // Falla cerrado: solo un development/test declarado se libra del aborto.
    if (JwtSecretsValidator.LAX_ENVS.includes(nodeEnv)) {
      this.logger.warn(`${detail} (Se permite el arranque porque NODE_ENV=${nodeEnv}.)`);
      return;
    }

    throw new Error(detail);
  }

  private static isPlaceholder(value: string): boolean {
    const normalized = value.toLowerCase();
    return JwtSecretsValidator.PLACEHOLDER_PREFIXES.some((prefix) =>
      normalized.startsWith(prefix),
    );
  }
}
