import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ClientUser } from './entities/client-user.entity';
import { ClientUsersRepository } from './client-users.repository';
import { ClientJwtStrategy } from './strategies/client-jwt.strategy';
import { PortalAuthService } from './portal-auth.service';
import { PortalAuthController } from './portal-auth.controller';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    JwtModule.register({}),
    TypeOrmModule.forFeature([ClientUser]),
  ],
  controllers: [PortalAuthController],
  // `JwtModule`/`PassportModule` ya no se exportan: PortalAuthService y
  // ClientJwtStrategy los consumen dentro de este mismo módulo y ningún otro
  // módulo del proyecto importa PortalModule para reutilizarlos.
  providers: [ClientUsersRepository, ClientJwtStrategy, PortalAuthService],
  exports: [ClientUsersRepository],
})
export class PortalModule {}
