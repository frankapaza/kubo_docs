import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PORTAL_AUTH_THROTTLERS } from '../../config/throttler.config';
import { ClientUser } from './entities/client-user.entity';
import { ClientUsersRepository } from './client-users.repository';
import { ClientJwtStrategy } from './strategies/client-jwt.strategy';
import { PortalAuthService } from './portal-auth.service';
import { PortalAuthController } from './portal-auth.controller';
import { PortalTicketsService } from './portal-tickets.service';
import { PortalTicketsController } from './portal-tickets.controller';
import { PortalRequirementsService } from './portal-requirements.service';
import { PortalRequirementsController } from './portal-requirements.controller';
import { ClientUsersService } from './client-users.service';
import { ClientUsersController } from './client-users.controller';
import { TicketsModule } from '../tickets/tickets.module';
import { ClientsModule } from '../clients/clients.module';
import { WorkItemsModule } from '../work-items/work-items.module';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    JwtModule.register({}),
    // Limitación de intentos de la superficie pública del portal. Se registra
    // aquí, y no en AppModule, porque el único sitio donde se monta el guard
    // (`ApiThrottlerGuard`) es `PortalAuthController`: no hay throttler global
    // y el panel interno sigue sin límite a propósito. `ThrottlerModule` está
    // marcado @Global, así que sus providers quedan disponibles igualmente.
    ThrottlerModule.forRoot({ throttlers: PORTAL_AUTH_THROTTLERS }),
    TypeOrmModule.forFeature([ClientUser]),
    // De TicketsModule solo se consumen TicketsRepository, TicketEventsService,
    // TicketsService y ClientSystemsRepository, todos ya exportados por él.
    // La dependencia es en un solo sentido: TicketsModule no conoce el portal.
    TicketsModule,
    // Solo para validar que el cliente existe al dar de alta un usuario suyo
    // (ClientUsersService.create). La dependencia es igualmente unidireccional:
    // ClientsModule no conoce el portal.
    ClientsModule,
    // Solo se consume WorkItemsRepository, ya exportado por WorkItemsModule.
    // Importarlo entero es seguro: solo arrastra ClientsModule (que el portal
    // ya usa) y ProjectsModule, sin colas ni dependencias pesadas.
    WorkItemsModule,
  ],
  controllers: [
    PortalAuthController,
    PortalTicketsController,
    PortalRequirementsController,
    ClientUsersController,
  ],
  // `JwtModule`/`PassportModule` ya no se exportan: PortalAuthService y
  // ClientJwtStrategy los consumen dentro de este mismo módulo y ningún otro
  // módulo del proyecto importa PortalModule para reutilizarlos.
  providers: [
    ClientUsersRepository,
    ClientJwtStrategy,
    PortalAuthService,
    PortalTicketsService,
    PortalRequirementsService,
    ClientUsersService,
  ],
  exports: [ClientUsersRepository],
})
export class PortalModule {}
