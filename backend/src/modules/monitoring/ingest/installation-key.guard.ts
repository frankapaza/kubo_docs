import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

import { fingerprintInstallationKey, isWellFormedInstallationKey } from '../domain/installation-key';
import { InstallationsService, ResolvedInstallation } from '../installations.service';

export const INSTALLATION_KEY_HEADER = 'x-kubo-log-key';

/** El único cuerpo de rechazo, compartido con el corte previo de `registerIngestJsonLimit`. */
export const INVALID_KEY_BODY = { code: 'UNAUTHORIZED', message: 'Clave de instalación inválida o revocada.' } as const;

/** La petición tras pasar la guarda: la instalación ya resuelta, nunca la clave. */
export type IngestRequest = Request & { installation?: ResolvedInstallation };

/**
 * Autentica la ingesta por `X-Kubo-Log-Key` (sin JWT: llama un aplicativo,
 * no una persona).
 *
 * - Lo que no tiene forma de clave se rechaza SIN consultar la base: un
 *   escáner o un appender mal configurado no cuestan una consulta por lote.
 * - El mensaje es el mismo para clave inexistente, revocada o mal formada:
 *   distinguirlos le diría a quien prueba claves cuáles existieron.
 * - La clave no se escribe en ningún log ni se deja en la petición; solo se
 *   usa su huella para buscar.
 */
@Injectable()
export class InstallationKeyGuard implements CanActivate {
  constructor(private readonly installations: InstallationsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<IngestRequest>();
    const key = req.headers[INSTALLATION_KEY_HEADER];
    if (!isWellFormedInstallationKey(key)) throw unauthorized();

    const installation = await this.installations.findActiveByFingerprint(fingerprintInstallationKey(key as string));
    if (!installation) throw unauthorized();

    req.installation = installation;
    return true;
  }
}

function unauthorized(): UnauthorizedException {
  return new UnauthorizedException({ ...INVALID_KEY_BODY });
}
