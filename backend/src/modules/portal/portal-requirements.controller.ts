import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';

import { ClientJwtGuard } from './guards/client-jwt.guard';
import { ClientAdminGuard } from './guards/client-admin.guard';
import { CurrentClientUser } from './decorators/current-client-user.decorator';
import { AuthClientUser } from './strategies/client-jwt.strategy';
import { PortalRequirementsService } from './portal-requirements.service';
import { CreatePortalRequirementDto } from './dto/create-portal-requirement.dto';
import { PortalRequirementView } from './dto/portal-requirement.dto';

/**
 * Ninguna ruta acepta `clientId`: el único que existe aquí es el del token que
 * `ClientJwtGuard` acaba de verificar. Mismo criterio que
 * `PortalTicketsController`.
 */
const requirementIdPipe = new ParseIntPipe({
  exceptionFactory: () =>
    new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'El identificador del requerimiento no es válido.',
    }),
});

@Controller('portal/requerimientos')
@UseGuards(ClientJwtGuard)
export class PortalRequirementsController {
  constructor(private readonly service: PortalRequirementsService) {}

  /**
   * El único punto con `ClientAdminGuard`. Leer queda abierto a cualquier
   * usuario de la empresa: es el registro del trabajo que su compañía pidió.
   */
  @Post()
  @UseGuards(ClientAdminGuard)
  create(
    @CurrentClientUser() user: AuthClientUser,
    @Body() dto: CreatePortalRequirementDto,
  ): Promise<PortalRequirementView> {
    return this.service.create(user.clientUserId, user.clientId, dto);
  }

  @Get()
  list(@CurrentClientUser() user: AuthClientUser): Promise<PortalRequirementView[]> {
    return this.service.list(user.clientId);
  }

  @Get(':id')
  findOne(
    @CurrentClientUser() user: AuthClientUser,
    @Param('id', requirementIdPipe) id: number,
  ): Promise<PortalRequirementView> {
    return this.service.findOne(user.clientId, id);
  }
}
