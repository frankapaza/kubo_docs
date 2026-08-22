import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { ClientJwtGuard } from './guards/client-jwt.guard';
import { CurrentClientUser } from './decorators/current-client-user.decorator';
import { AuthClientUser } from './strategies/client-jwt.strategy';
import { PortalReportsService } from './portal-reports.service';
import { MonthlyReportQueryDto, MonthlyReportView } from './dto/monthly-report.dto';

/**
 * No acepta `clientId` por ningún lado: el único que existe es el del token
 * que `ClientJwtGuard` acaba de verificar. Mismo criterio que el resto del
 * portal.
 *
 * Sin `ClientAdminGuard`: descargarlo puede cualquier usuario de la empresa.
 * Es el registro del servicio que su compañía recibió, y esconderlo no
 * protege nada.
 */
@Controller('portal/informes')
@UseGuards(ClientJwtGuard)
export class PortalReportsController {
  constructor(private readonly service: PortalReportsService) {}

  @Get('mensual')
  monthly(
    @CurrentClientUser() user: AuthClientUser,
    @Query() dto: MonthlyReportQueryDto,
  ): Promise<MonthlyReportView> {
    return this.service.monthly(user.clientId, dto);
  }
}
