import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { MonitorServer } from './entities/monitor-server.entity';
import { bearerToken } from './probe-token.guard';

/** Cuerpo único de rechazo, compartido con el corte previo de `registerProbeIngestJsonLimit`. */
export const INVALID_AGENT_TOKEN_BODY = { code: 'UNAUTHORIZED', message: 'Token de agente inválido o revocado.' } as const;

export const AGENT_TOKEN_PREFIX = 'kma_';

export type AgentRequest = Request & { server?: MonitorServer };

/**
 * Autentica al agente de un servidor por su token (`kma_…`): sha256 hex contra
 * `monitor_servers.agent_token_hash`. Como `ProbeTokenGuard`, va sola (llama
 * una máquina) y da el mismo 401 para ausente, de otro tipo, desconocido o
 * revocado.
 */
@Injectable()
export class AgentTokenGuard implements CanActivate {
  constructor(@InjectRepository(MonitorServer) private readonly servers: Repository<MonitorServer>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AgentRequest>();
    const token = bearerToken(req.headers?.authorization);
    if (!token || !token.startsWith(AGENT_TOKEN_PREFIX)) throw unauthorized();

    const agentTokenHash = createHash('sha256').update(token).digest('hex');
    const server = await this.servers.findOne({ where: { agentTokenHash } });
    if (!server || !server.agentTokenHash) throw unauthorized();

    req.server = server;
    return true;
  }
}

function unauthorized(): UnauthorizedException {
  return new UnauthorizedException({ ...INVALID_AGENT_TOKEN_BODY });
}
