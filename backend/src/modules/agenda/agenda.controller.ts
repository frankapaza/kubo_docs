import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AgendaService } from './agenda.service';
import { AgendaItemDto, BulkAgendaDto } from './dto/agenda-item.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller()
@UseGuards(JwtAuthGuard)
export class AgendaController {
  constructor(private readonly service: AgendaService) {}

  @Get('meetings/:meetingId/agenda')
  list(@Param('meetingId', ParseIntPipe) meetingId: number) {
    return this.service.listByMeeting(meetingId);
  }

  @Post('meetings/:meetingId/agenda')
  replace(
    @Param('meetingId', ParseIntPipe) meetingId: number,
    @Body() dto: BulkAgendaDto,
  ) {
    return this.service.replaceAll(meetingId, dto);
  }

  @Patch('agenda/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: Partial<AgendaItemDto>) {
    return this.service.update(id, dto);
  }

  @Delete('agenda/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
