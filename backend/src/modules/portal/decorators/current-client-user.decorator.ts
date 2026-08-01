import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthClientUser } from '../strategies/client-jwt.strategy';

/** Extrae el usuario de cliente autenticado (o uno de sus campos) de la petición. */
export const CurrentClientUser = createParamDecorator(
  (data: keyof AuthClientUser | undefined, ctx: ExecutionContext): AuthClientUser | unknown => {
    const req = ctx.switchToHttp().getRequest();
    return data ? req.user?.[data] : req.user;
  },
);
