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
import { ServiceCategory } from './entities/ticket.entity';
import { TicketStatus } from './domain/ticket-state-machine';
import { TicketPriority } from './domain/ticket-priority';

const TRANSCRIBE_MAX_MB = 25;

@Controller('tickets')
@UseGuards(JwtAuthGuard)
export class TicketsController {
  constructor(
    private readonly service: TicketsService,
    private readonly transitions: TicketTransitionsService,
    private readonly assignment: TicketAssignmentService,
    private readonly ai: TicketAIService,
  ) {}

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
    @Query('projectId') projectId?: string,
    @Query('systemId') systemId?: string,
    @Query('priority') priority?: TicketPriority,
    @Query('assigneeId') assigneeId?: string,
    @Query('serviceCategory') serviceCategory?: ServiceCategory,
    @Query('atRisk') atRisk?: string,
    @Query('q') q?: string,
  ) {
    return this.service.list({
      status,
      open: open === 'true',
      clientId: clientId ? Number(clientId) : undefined,
      projectId: projectId ? Number(projectId) : undefined,
      systemId: systemId ? Number(systemId) : undefined,
      priority,
      assigneeUserId: assigneeId ? Number(assigneeId) : undefined,
      serviceCategory,
      atRisk: atRisk === 'true',
      q,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findWithTimeline(id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTicketDto) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTicketDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    await this.service.remove(id);
    return { ok: true };
  }

  @Post(':id/transition')
  transition(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TransitionTicketDto,
  ) {
    return this.transitions.transition({
      ticketId: id,
      actorUserId: user.id,
      toStatus: dto.toStatus,
      reason: dto.reason,
      resolutionMd: dto.resolutionMd,
      rootCause: dto.rootCause,
      correctiveAction: dto.correctiveAction,
    });
  }

  @Post(':id/assign')
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignTicketDto,
  ) {
    return this.assignment.assign({
      ticketId: id,
      actorUserId: user.id,
      assigneeUserId: dto.assigneeUserId,
      reason: dto.reason,
    });
  }

  @Post(':id/take')
  take(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.assignment.take({ ticketId: id, actorUserId: user.id });
  }

  @Post(':id/escalate')
  escalate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EscalateTicketDto,
  ) {
    return this.assignment.escalate({
      ticketId: id,
      actorUserId: user.id,
      toLevel: dto.toLevel,
      reason: dto.reason,
      assigneeUserId: dto.assigneeUserId,
    });
  }

  @Post(':id/priority')
  overridePriority(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: OverridePriorityDto,
  ) {
    return this.assignment.overridePriority({
      ticketId: id,
      actorUserId: user.id,
      impact: dto.impact,
      urgency: dto.urgency,
      priority: dto.priority,
      reason: dto.reason,
    });
  }

  @Get(':id/suggest-assignee')
  suggestAssignee(@Param('id', ParseIntPipe) id: number) {
    return this.assignment.suggestAssignee(id);
  }

  @Post(':id/triage')
  triage(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.ai.triage(id, user.id);
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
