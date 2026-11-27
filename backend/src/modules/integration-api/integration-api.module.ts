import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Client } from '../clients/entities/client.entity';
import { ApiClientRateLimiter, ApiKeyGuard, ApiKeyRateLimiter } from './api-key.guard';
import { PortalApiKeysController, StaffApiKeysController } from './api-keys.controllers';
import { ApiKeysService } from './api-keys.service';
import { ClientApiKey } from './entities/client-api-key.entity';

/** API de integración para clientes. Spec: 2026-11-27-api-integracion-clientes-design.md. */
@Module({
  imports: [TypeOrmModule.forFeature([ClientApiKey, Client])],
  controllers: [PortalApiKeysController, StaffApiKeysController],
  providers: [
    ApiKeysService,
    ApiKeyGuard,
    // Estado en memoria del proceso: un limitador por clave y otro por cliente.
    ApiKeyRateLimiter,
    ApiClientRateLimiter,
  ],
})
export class IntegrationApiModule {}
