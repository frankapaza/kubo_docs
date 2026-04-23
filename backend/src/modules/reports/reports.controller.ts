import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';
import { JiraReportDto, MultiJiraReportDto } from './dto/jira-report.dto';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  /**
   * Devuelve el informe mensual estructurado (datos duros de Jira) de un proyecto Kubo.
   */
  @Post('jira/monthly')
  @HttpCode(200)
  monthly(@CurrentUser() user: AuthUser, @Body() dto: JiraReportDto) {
    return this.service.getJiraMonthlyReport(user, dto.projectId, dto.from, dto.to);
  }

  /**
   * Genera un documento con narrativa IA desde un proyecto Kubo.
   */
  @Post('jira/monthly/generate-document')
  @HttpCode(201)
  generate(@CurrentUser() user: AuthUser, @Body() dto: JiraReportDto) {
    return this.service.generateJiraReportDocument(user, dto.projectId, dto.from, dto.to);
  }

  /**
   * Consolidado de MÚLTIPLES proyectos Jira para un cliente.
   */
  @Post('jira/multi')
  @HttpCode(200)
  multi(@CurrentUser() user: AuthUser, @Body() dto: MultiJiraReportDto) {
    return this.service.getMultiProjectReport(
      user,
      dto.clientId,
      dto.from,
      dto.to,
      dto.sources,
    );
  }

  /**
   * Genera documento ejecutivo consolidado de varios proyectos Jira (a nivel de cliente).
   */
  @Post('jira/multi/generate-document')
  @HttpCode(201)
  generateMulti(@CurrentUser() user: AuthUser, @Body() dto: MultiJiraReportDto) {
    return this.service.generateMultiProjectReportDocument(user, {
      clientId: dto.clientId,
      from: dto.from,
      to: dto.to,
      sources: dto.sources,
      title: dto.title,
      additionalContext: dto.additionalContext,
    });
  }
}
