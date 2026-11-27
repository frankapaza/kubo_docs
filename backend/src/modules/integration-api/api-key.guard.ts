import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';

import { FixedWindowLimiter } from '../../common/rate-limit/fixed-window-limiter';
import { ApiKeysService, ApiPrincipal } from './api-keys.service';
import { fingerprintApiKey, isWellFormedApiKey } from './domain/api-key';

/** 60 peticiones por minuto y por clave; 120 por cliente sumando todas sus claves (spec). */
export const API_MAX_PER_KEY = 60;
export const API_MAX_PER_CLIENT = 120;
export const API_WINDOW_MS = 60_000;

/** Limitadores propios: no comparten ventanas con la ingesta ni con el conector. */
export class ApiKeyRateLimiter extends FixedWindowLimiter {
  constructor() {
    super(API_MAX_PER_KEY, API_WINDOW_MS);
  }
}
export class ApiClientRateLimiter extends FixedWindowLimiter {
  constructor() {
    super(API_MAX_PER_CLIENT, API_WINDOW_MS);
  }
}

export type IntegrationRequest = Request & { integration?: ApiPrincipal };

const INVALID = { code: 'UNAUTHORIZED', message: 'Clave de API inválida o revocada.' } as const;

/** `Authorization: Bearer kci_…` manda; si no hay, `X-Api-Key`. Nunca por query. */
export function extractApiKey(headers: Record<string, unknown> | undefined): unknown {
  const auth = headers?.authorization;
  if (typeof auth === 'string' && auth.trim() !== '') {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(auth.trim());
    return m ? m[1] : undefined;
  }
  return headers?.['x-api-key'];
}

/**
 * Autentica `/integracion/*`. Una clave mal formada no llega a la base, y
 * desconocida, revocada o de un cliente no vigente dan el mismo 401. El
 * `clientId` sale de la clave y nunca de la petición.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly keys: ApiKeysService,
    private readonly perKey: ApiKeyRateLimiter,
    private readonly perClient: ApiClientRateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<IntegrationRequest>();
    const key = extractApiKey(req.headers as Record<string, unknown>);
    if (!isWellFormedApiKey(key)) throw new UnauthorizedException({ ...INVALID });

    const principal = await this.keys.resolve(fingerprintApiKey(key));
    if (!principal) throw new UnauthorizedException({ ...INVALID });

    const now = Date.now();
    const byKey = this.perKey.take(principal.keyId, now);
    const byClient = byKey.ok ? this.perClient.take(principal.clientId, now) : byKey;
    if (!byClient.ok) {
      http.getResponse<Response>().setHeader?.('Retry-After', String(byClient.retryAfterSec));
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: `Demasiadas peticiones. Reintenta en ${byClient.retryAfterSec} s.`,
          retryAfterSec: byClient.retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    req.integration = principal;
    return true;
  }
}
