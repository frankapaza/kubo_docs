import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Client } from './entities/client.entity';
import { ClientsRepository } from './clients.repository';
import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Client])],
  providers: [ClientsRepository, ClientsService],
  controllers: [ClientsController],
  // `ClientsRepository` se exporta para el despachador de notificaciones, que
  // necesita la razón social del cliente del ticket y para el que un cliente
  // ausente no es un error (se compone el correo con "(no disponible)").
  // `ClientsService.findByIdOrFail` lanzaría 404 y tumbaría el aviso entero.
  exports: [ClientsService, ClientsRepository],
})
export class ClientsModule {}
