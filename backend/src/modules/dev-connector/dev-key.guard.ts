import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

import { FixedWindowLimiter } from '../../common/rate-limit/fixed-window-limiter';
import { DevKeysService, DevPrincipal } from './dev-keys.service';
import { fingerprintDevKey, isWellFormedDevKey } from './domain/dev-key';

export const DEV_KEY_HEADER = 'x-kubo-dev-key';

/** 60 peticiones por minuto y por clave (spec §4). */
export const DEV_MAX_PER_WINDOW = 60;
export const DEV_WINDOW_MS = 60_000;

/** El limitador del conector: proveedor propio para no compartir ventanas con la ingesta. */
export class DevRateLimiter extends FixedWindowLimiter {
  constructor() {
    super(DEV_MAX_PER_WINDOW, DEV_WINDOW_MS);
  }
}

export type DevRequest = Request & { dev?: DevPrincipal };

const INVALID = { code: 'UNAUTHORIZED', message: 'Clave de desarrollo inválida o revocada.' } as const;

/**
 * Autentica `/dev/*` por `X-Kubo-Dev-Key`. Una clave mal formada no llega a la
 * base. El alcance (cliente, sistema, repo, persona) sale de la clave y nunca
 * de algo que mande el cliente HTTP.
 */
@Injectable()
export class DevKeyGuard implements CanActivate {
  constructor(
    private readonly keys: DevKeysService,
    private readonly limiter: FixedWindowLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<DevRequest>();
    const key = req.headers?.[DEV_KEY_HEADER];
    if (!isWellFormedDevKey(key)) throw new UnauthorizedException({ ...INVALID });

    const principal = await this.keys.resolve(fingerprintDevKey(key));
    if (!principal) throw new UnauthorizedException({ ...INVALID });

    const taken = this.limiter.take(principal.keyId, Date.now());
    if (!taken.ok) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: `Demasiadas peticiones con esta clave. Reintenta en ${taken.retryAfterSec} s.`,
          retryAfterSec: taken.retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    req.dev = principal;
    return true;
  }
}
