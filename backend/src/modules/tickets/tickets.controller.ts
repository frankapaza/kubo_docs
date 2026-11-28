import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { TicketsService } from './tickets.service';
import { TicketTransitionsService } from './ticket-transitions.service';
import { TicketAssignmentService } from './ticket-assignment.service';
import { TicketAIService } from './ticket-ai.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TransitionTicketDto } from './dto/transition-ticket.dto';
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { EscalateTicketDto } from './dto/escalate-ticket.dto';
import { OverridePriorityDto } from './dto/override-priority.dto';
import { ArchiveTicketDto } from './dto/archive-ticket.dto';
import { ChangeTicketClientDto } from './dto/change-client.dto';
import { ConcludeTicketDto } from './dto/conclude-ticket.dto';
import { TicketConclusionService } from './ticket-conclusion.service';
import { TicketSystemGuard } from './ticket-system-guard.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TicketsRealtimeGateway } from './tickets-realtime.gateway';
import { ServiceCategory } from './entities/ticket.entity';
import { TicketStatus } from './domain/ticket-state-machine';
import { TicketPriority } from './domain/ticket-priority';

const TRANSCRIBE_MAX_MB = 25;

@Controller('tickets')
@UseGuards(JwtAuthGuard, StaffOnlyGuard)
export class TicketsController {
  constructor(
    private readonly service: TicketsService,
    private readonly transitions: TicketTransitionsService,
    private readonly assignment: TicketAssignmentService,
    private readonly ai: TicketAIService,
    private readonly realtime: TicketsRealtimeGateway,
    private readonly conclusion: TicketConclusionService,
    private readonly systemGuard: TicketSystemGuard,
  ) {}

  /**
   * Toda acción del personal que cambia un ticket avisa a las bandejas
   * abiertas para que recarguen. Se avisa solo si la acción salió bien.
   * (El alta avisa desde `TicketsService.create`, que es la puerta común del
   * panel, el portal y el correo.)
   */
  private async changed<T>(work: Promise<T>): Promise<T> {
    const result = await work;
    this.realtime.notifyChanged();
    return result;
  }

  /**
   * Transcribir un audio (WhatsApp voice note o grabación en vivo) y devolver
   * el texto. El resultado no se guarda; el cliente lo usa para crear o
   * completar un ticket con POST /tickets.
   *
   * Declarado antes de cualquier ruta `:id/...` a propósito: Nest resuelve
   * las rutas en orden de declaración, y una ruta `POST :id/...` matchearía
   * `/tickets/transcribe` interpretando "transcribe" como `:id` si se
   * declarara después.
   */
  @Post('transcribe')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: TRANSCRIBE_MAX_MB * 1024 * 1024 },
    }),
  )
  async transcribe(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'Falta el archivo "file"' });
    }
    return this.ai.transcribeAudioBuffer(file.buffer, file.mimetype);
  }

  @Get()
  list(
    @Query('status') status?: TicketStatus,
    @Query('open') open?: string,
    @Query('clientId') clientId?: string,
    @Query('systemId') systemId?: string,
    @Query('priority') priority?: TicketPriority,
    @Query('assigneeId') assigneeId?: string,
    @Query('serviceCategory') serviceCategory?: ServiceCategory,
    @Query('atRisk') atRisk?: string,
    @Query('q') q?: string,
    @Query('excludeClosed') excludeClosed?: string,
    @Query('archived') archived?: string,
    @Query('sinSistema') sinSistema?: string,
  ) {
    return this.service.list({
      status,
      open: open === 'true',
      clientId: clientId ? Number(clientId) : undefined,
      systemId: systemId ? Number(systemId) : undefined,
      priority,
      assigneeUserId: assigneeId ? Number(assigneeId) : undefined,
      serviceCategory,
      atRisk: atRisk === 'true',
      q,
      excludeClosed: excludeClosed === 'true',
      // Siempre booleano aquí, nunca `undefined`: la bandeja del equipo oculta
      // los archivados por omisión. El repositorio solo filtra si se lo piden
      // (el portal no lo pide), así que esta es la puerta que lo decide.
      // 'any' (al buscar texto) no filtra: un archivado también aparece en la búsqueda.
      archived: archived === 'true' ? true : archived === 'any' ? undefined : false,
      sinSistema: sinSistema === '1' || sinSistema === 'true',
    });
  }

  /** Aviso del panel: tickets abiertos sin sistema de clientes que sí tienen sistemas. */
  @Get('sin-sistema/resumen')
  async withoutSystemSummary(): Promise<{ total: number; porCliente: Array<{ clientId: number; cliente: string; total: number }> }> {
    const porCliente = await this.service.summaryWithoutSystem();
    return { total: porCliente.reduce((a, c) => a + c.total, 0), porCliente };
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findWithTimeline(id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTicketDto) {
    return this.service.create({ kind: 'STAFF', userId: user.id }, dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTicketDto) {
    return this.changed(this.service.update(id, dto));
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    await this.changed(this.service.remove(id));
    return { ok: true };
  }

  @Post(':id/archive')
  archive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ArchiveTicketDto,
  ) {
    return this.changed(this.service.archive(id, user.id, dto.reason));
  }

  /** Pasa el ticket a otro cliente (solo ADMIN): sistema, usuario de avisos y proyecto incluidos. */
  @Post(':id/client')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  changeClient(@Param('id', ParseIntPipe) id: number, @Body() dto: ChangeTicketClientDto) {
    return this.changed(this.service.changeClient(id, dto));
  }

  @Post(':id/unarchive')
  unarchive(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.changed(this.service.unarchive(id, user.id));
  }

  @Post(':id/transition')
  async transition(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TransitionTicketDto,
  ) {
    // Volver a Nuevo o Triaje es ordenar, no trabajar: no exige sistema.
    if (dto.toStatus !== 'NUEVO' && dto.toStatus !== 'TRIAJE') {
      await this.systemGuard.assertCanWork(id, 'cambiar su estado');
    }
    return this.changed(this.transitions.transition({
      ticketId: id,
      actorUserId: user.id,
      toStatus: dto.toStatus,
      reason: dto.reason,
      resolutionMd: dto.resolutionMd,
      rootCause: dto.rootCause,
      correctiveAction: dto.correctiveAction,
    }));
  }

  /**
   * Solo ADMIN: da por concluido un ticket ya atendido con una observación
   * general (resuelto y cerrado por el camino normal). Lo usa el cierre en
   * lote de la bandeja.
   */
  @Post(':id/conclude')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async conclude(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ConcludeTicketDto,
  ) {
    await this.systemGuard.assertCanWork(id, 'concluirlo');
    return this.changed(this.conclusion.conclude({
      ticketId: id,
      actorUserId: user.id,
      solucion: dto.solucion,
      rootCause: dto.rootCause,
      correctiveAction: dto.correctiveAction,
    }));
  }

  @Post(':id/assign')
  async assign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignTicketDto,
  ) {
    await this.systemGuard.assertCanWork(id, 'asignarlo');
    return this.changed(this.assignment.assign({
      ticketId: id,
      actorUserId: user.id,
      assigneeUserId: dto.assigneeUserId,
      reason: dto.reason,
    }));
  }

  @Post(':id/take')
  async take(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.systemGuard.assertCanWork(id, 'tomarlo');
    return this.changed(this.assignment.take({ ticketId: id, actorUserId: user.id }));
  }

  @Post(':id/escalate')
  async escalate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EscalateTicketDto,
  ) {
    await this.systemGuard.assertCanWork(id, 'escalarlo');
    return this.changed(this.assignment.escalate({
      ticketId: id,
      actorUserId: user.id,
      toLevel: dto.toLevel,
      reason: dto.reason,
      assigneeUserId: dto.assigneeUserId,
    }));
  }

  @Post(':id/priority')
  overridePriority(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: OverridePriorityDto,
  ) {
    return this.changed(this.assignment.overridePriority({
      ticketId: id,
      actorUserId: user.id,
      impact: dto.impact,
      urgency: dto.urgency,
      priority: dto.priority,
      reason: dto.reason,
    }));
  }

  @Get(':id/suggest-assignee')
  suggestAssignee(@Param('id', ParseIntPipe) id: number) {
    return this.assignment.suggestAssignee(id);
  }

  @Post(':id/triage')
  triage(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.changed(this.ai.triage(id, user.id));
  }

  @Post(':id/push-to-jira')
  pushToJira(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.ai.pushToJira(id, user.id);
  }

  @Post(':id/closure-document')
  closureDocument(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.ai.generateClosureDocument(id, user.id);
  }
}
