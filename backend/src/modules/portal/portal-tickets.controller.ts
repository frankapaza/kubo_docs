import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';

import { ClientJwtGuard } from './guards/client-jwt.guard';
import { CurrentClientUser } from './decorators/current-client-user.decorator';
import { AuthClientUser } from './strategies/client-jwt.strategy';
import { PortalTicketsService } from './portal-tickets.service';
import { CreatePortalTicketDto } from './dto/create-portal-ticket.dto';
import { PortalClientSystemView, PortalTicketView } from './dto/portal-ticket.dto';

/**
 * Superficie del portal de clientes. Ninguna ruta acepta un `clientId`: el
 * único que existe aquí es el del token que `ClientJwtGuard` acaba de
 * verificar. Cualquier `clientId` que llegara por el cuerpo o la query sería
 * ignorado por el servicio, y además el ValidationPipe global lo rechaza.
 */
@Controller('portal')
@UseGuards(ClientJwtGuard)
export class PortalTicketsController {
  constructor(private readonly service: PortalTicketsService) {}

  @Get('tickets')
  list(@CurrentClientUser() user: AuthClientUser): Promise<PortalTicketView[]> {
    return this.service.list(user.clientId);
  }

  /**
   * Declarado antes de `tickets/:id` para que Nest no interprete "systems"
   * como un id al resolver las rutas en orden.
   */
  @Get('systems')
  systems(@CurrentClientUser() user: AuthClientUser): Promise<PortalClientSystemView[]> {
    return this.service.systems(user.clientId);
  }

  @Get('tickets/:id')
  detail(
    @CurrentClientUser() user: AuthClientUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PortalTicketView> {
    return this.service.detail(user.clientId, id);
  }

  @Post('tickets')
  create(
    @CurrentClientUser() user: AuthClientUser,
    @Body() dto: CreatePortalTicketDto,
  ): Promise<PortalTicketView> {
    return this.service.create(user.clientUserId, user.clientId, dto);
  }
}
