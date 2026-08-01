import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Segunda barrera. Con secretos JWT distintos un token de cliente ya no valida
 * contra la estrategia del personal, así que esto no debería dispararse nunca
 * — y va igualmente, porque una sola barrera en algo así es una barrera menos.
 *
 * Rechaza cualquier petición cuyo usuario traiga `clientId`, aunque además
 * traiga un `role` que parezca de personal.
 */
@Injectable()
export class StaffOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (!user || user.clientId !== undefined || user.clientUserId !== undefined) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Esta sección es solo para el equipo interno.',
      });
    }
    return true;
  }
}
