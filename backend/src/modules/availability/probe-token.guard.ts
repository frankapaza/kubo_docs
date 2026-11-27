import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { MonitorProbe } from './entities/monitor-probe.entity';

/** Cuerpo único de rechazo, compartido con el corte previo de `registerProbeIngestJsonLimit`. */
export const INVALID_PROBE_TOKEN_BODY = { code: 'UNAUTHORIZED', message: 'Token de sonda inválido o revocado.' } as const;

export type ProbeRequest = Request & { probe?: MonitorProbe };

/** Extrae el token de `Authorization: Bearer <token>`; null si no hay o no tiene esa forma. */
export function bearerToken(header: unknown): string | null {
  if (typeof header !== 'string') return null;
  const m = /^Bearer (\S+)$/.exec(header);
  return m ? m[1] : null;
}

/**
 * Autentica a una sonda por su token (`kmp_…`): sha256 hex contra
 * `monitor_probes.token_hash`. Va SOLA, nunca junto a `JwtAuthGuard`: llama
 * una máquina, no una persona. Mismo 401 para ausente, desconocido o revocado.
 */
@Injectable()
export class ProbeTokenGuard implements CanActivate {
  constructor(@InjectRepository(MonitorProbe) private readonly probes: Repository<MonitorProbe>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ProbeRequest>();
    const token = bearerToken(req.headers?.authorization);
    if (!token) throw unauthorized();

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const probe = await this.probes.findOne({ where: { tokenHash } });
    if (!probe || !probe.tokenHash) throw unauthorized();

    req.probe = probe;
    return true;
  }
}

function unauthorized(): UnauthorizedException {
  return new UnauthorizedException({ ...INVALID_PROBE_TOKEN_BODY });
}
