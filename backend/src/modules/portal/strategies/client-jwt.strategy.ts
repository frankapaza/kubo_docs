import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface ClientJwtPayload {
  sub: number;
  email: string;
  clientId: number;
  isClientAdmin: boolean;
}

export interface AuthClientUser {
  clientUserId: number;
  email: string;
  clientId: number;
  isClientAdmin: boolean;
}

/**
 * Estrategia propia del portal, con secreto propio. Un token de cliente NO
 * valida contra la estrategia 'jwt' del personal, y viceversa: la frontera
 * es criptográfica, no una comprobación sobre el contenido del token.
 */
@Injectable()
export class ClientJwtStrategy extends PassportStrategy(Strategy, 'client-jwt') {
  constructor(cfg: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: cfg.get<string>('JWT_CLIENT_ACCESS_SECRET', 'change-me-client'),
    });
  }

  validate(payload: ClientJwtPayload): AuthClientUser {
    return {
      clientUserId: payload.sub,
      email: payload.email,
      clientId: payload.clientId,
      isClientAdmin: payload.isClientAdmin,
    };
  }
}
