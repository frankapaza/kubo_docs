import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

import { AuthClientUser } from '../strategies/client-jwt.strategy';

/**
 * Exige que la sesión del portal sea la de un administrador de su empresa.
 *
 * Va **siempre después** de `ClientJwtGuard`, que es quien deja el usuario en
 * la petición; por sí solo no autentica nada.
 *
 * Compara contra `true` en vez de mirar si el valor es verdadero. La diferencia
 * importa: `isClientAdmin` viaja dentro de un token, y un token manipulado
 * puede traer `1`, `"true"` o cualquier otra cosa que un `if` daría por buena.
 * Solo el booleano `true` —el que escribe `portal-auth.service.ts` con
 * `!!user.isAdmin`— abre la puerta. Todo lo demás, incluida la ausencia del
 * campo y la ausencia del usuario entero, es «no».
 */
@Injectable()
export class ClientAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<{ user?: AuthClientUser }>().user;

    if (user?.isClientAdmin !== true) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Solo el administrador de la empresa puede crear requerimientos.',
      });
    }

    return true;
  }
}
