import { Injectable } from '@nestjs/common';

import { FixedWindowLimiter } from '../../../common/rate-limit/fixed-window-limiter';

/** Contrato de recepción: 600 lotes por minuto y por instalación. */
export const INGEST_WINDOW_MS = 60_000;
export const INGEST_MAX_BATCHES_PER_WINDOW = 600;

/**
 * Limitador de ritmo de la ingesta, por instalación y no por IP.
 *
 * Por instalación porque la clave es la identidad: varios servidores de una
 * granja salen por la misma IP, y una IP de NAT puede tener a varios clientes.
 * No se usa `@nestjs/throttler` porque cuenta antes de saber de quién es la
 * clave (va por `req.ip`) y porque aquí hace falta el `Retry-After` exacto,
 * que el appender respeta.
 *
 * La mecánica (ventana fija, en memoria, reloj por parámetro) vive en
 * `FixedWindowLimiter`, compartida con el conector de Claude.
 */
@Injectable()
export class IngestRateLimiter extends FixedWindowLimiter {
  constructor() {
    super(INGEST_MAX_BATCHES_PER_WINDOW, INGEST_WINDOW_MS);
  }
}
