import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { ClientUsersRepository } from './client-users.repository';
import { ClientUser } from './entities/client-user.entity';
import { ClientJwtPayload } from './strategies/client-jwt.strategy';
import { ClientsService } from '../clients/clients.service';

export interface PortalAuthResponse {
  accessToken: string;
  refreshToken: string;
  clientUser: {
    id: number;
    email: string;
    fullName: string;
    clientId: number;
    /**
     * Solo la razón social del cliente, nunca el objeto completo: la cabecera
     * del portal no tiene por qué recibir RUC, dirección ni datos de
     * facturación para pintar un nombre. `null` si el cliente no pudo
     * resolverse (no debería pasar dado el FK de `client_users.client_id`,
     * pero no se asume); el frontend cae al nombre del usuario en ese caso.
     */
    clientRazonSocial: string | null;
  };
}

/**
 * Mensaje y forma únicos para cualquier fallo de login: correo inexistente,
 * contraseña incorrecta o cuenta desactivada. Distinguirlos permitiría a un
 * atacante enumerar qué direcciones están dadas de alta.
 */
function invalidCredentials(): UnauthorizedException {
  return new UnauthorizedException({
    code: 'UNAUTHORIZED',
    message: 'Correo o contraseña incorrectos.',
  });
}

/**
 * Hash bcrypt fijo (cost 10, sin contraseña real detrás) usado cuando el
 * correo no existe. Sin él, esa rama no pagaría el coste de `bcrypt.compare`
 * y un atacante podría enumerar correos dados de alta midiendo el tiempo de
 * respuesta, aunque el mensaje de error sea idéntico. Se calcula una sola
 * vez aquí, como constante del módulo, no en cada petición.
 */
const DECOY_PASSWORD_HASH = '$2b$10$0uJINUuWpJtynLqJh8R59OtA4TWmKftqsFWtUw2qsATrgOBnd.H9S';

@Injectable()
export class PortalAuthService {
  constructor(
    private readonly clientUsers: ClientUsersRepository,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
    private readonly clients: ClientsService,
  ) {}

  async login(email: string, password: string): Promise<PortalAuthResponse> {
    const user = await this.clientUsers.findByEmail(email);
    // `bcrypt.compare` se ejecuta siempre, exista o no el usuario, contra su
    // hash real o el señuelo: las tres rutas de fallo (correo inexistente,
    // contraseña incorrecta, cuenta desactivada) deben pagar el mismo coste
    // para no filtrar por tiempo qué correos están dados de alta.
    const matches = await bcrypt.compare(password, user?.passwordHash ?? DECOY_PASSWORD_HASH);
    if (!user || !matches || !user.isActive) {
      throw invalidCredentials();
    }

    await this.clientUsers.touchLastLogin(user.id);
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string): Promise<PortalAuthResponse> {
    try {
      const payload = await this.jwt.verifyAsync<ClientJwtPayload>(refreshToken, {
        secret: this.cfg.get<string>('JWT_CLIENT_REFRESH_SECRET'),
      });
      const user = await this.clientUsers.findById(payload.sub);
      if (!user || !user.isActive) {
        throw invalidCredentials();
      }
      return this.issueTokens(user);
    } catch {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'El token de refresco no es válido.',
      });
    }
  }

  private async issueTokens(user: ClientUser): Promise<PortalAuthResponse> {
    const payload: ClientJwtPayload = {
      sub: Number(user.id),
      email: user.email,
      clientId: Number(user.clientId),
      isClientAdmin: !!user.isAdmin,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.cfg.get<string>('JWT_CLIENT_ACCESS_SECRET'),
      expiresIn: this.cfg.get<string>('JWT_CLIENT_ACCESS_EXPIRES_IN', '15m'),
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      secret: this.cfg.get<string>('JWT_CLIENT_REFRESH_SECRET'),
      expiresIn: this.cfg.get<string>('JWT_CLIENT_REFRESH_EXPIRES_IN', '7d'),
    });

    return {
      accessToken,
      refreshToken,
      clientUser: {
        id: Number(user.id),
        email: user.email,
        fullName: user.fullName,
        clientId: Number(user.clientId),
        clientRazonSocial: await this.resolveClientRazonSocial(Number(user.clientId)),
      },
    };
  }

  /**
   * Proyección campo por campo, igual disciplina que `toView` en
   * `client-users.service.ts`: se pide el cliente completo a `ClientsService`
   * (única vía de acceso que expone `ClientsModule` al portal) y se extrae
   * solo `razonSocial`, nunca el resto (RUC, dirección, representante legal,
   * datos de facturación...).
   */
  private async resolveClientRazonSocial(clientId: number): Promise<string | null> {
    try {
      const client = await this.clients.findByIdOrFail(clientId);
      return client.razonSocial;
    } catch (err) {
      // Un cliente que ya no existe degrada a null y la cabecera cae al nombre
      // del usuario. Cualquier otro fallo —la base caída, por ejemplo— tiene
      // que seguir subiendo: silenciarlo lo disfrazaría de "cliente sin
      // resolver" y perderíamos el 500 que de verdad es.
      if (err instanceof NotFoundException) return null;
      throw err;
    }
  }
}
