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
import { PortalTicketsService } from './portal-tickets.service';
import { PortalTicketsController } from './portal-tickets.controller';
import { TicketsModule } from '../tickets/tickets.module';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    JwtModule.register({}),
    TypeOrmModule.forFeature([ClientUser]),
    // De TicketsModule solo se consumen TicketsRepository, TicketEventsService,
    // TicketsService y ClientSystemsRepository, todos ya exportados por él.
    // La dependencia es en un solo sentido: TicketsModule no conoce el portal.
    TicketsModule,
  ],
  controllers: [PortalAuthController, PortalTicketsController],
  // `JwtModule`/`PassportModule` ya no se exportan: PortalAuthService y
  // ClientJwtStrategy los consumen dentro de este mismo módulo y ningún otro
  // módulo del proyecto importa PortalModule para reutilizarlos.
  providers: [ClientUsersRepository, ClientJwtStrategy, PortalAuthService, PortalTicketsService],
  exports: [ClientUsersRepository],
})
export class PortalModule {}
