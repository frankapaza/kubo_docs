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
import { ClientRequestsService } from './client-requests.service';
import { CreateClientRequestDto } from './dto/create-client-request.dto';
import { UpdateClientRequestDto } from './dto/update-client-request.dto';
import { ClientRequestStatus, ServiceCategory } from './entities/client-request.entity';

const TRANSCRIBE_MAX_MB = 25;

@Controller('client-requests')
@UseGuards(JwtAuthGuard)
export class ClientRequestsController {
  constructor(private readonly service: ClientRequestsService) {}

  @Get()
  list(
    @Query('status') status?: ClientRequestStatus,
    @Query('clientId') clientId?: string,
    @Query('projectId') projectId?: string,
    @Query('serviceCategory') serviceCategory?: ServiceCategory,
    @Query('q') q?: string,
  ) {
    return this.service.list({
      status,
      clientId: clientId ? Number(clientId) : undefined,
      projectId: projectId ? Number(projectId) : undefined,
      serviceCategory,
      q,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findByIdOrFail(id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateClientRequestDto) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateClientRequestDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    await this.service.remove(id);
    return { ok: true };
  }

  @Post(':id/structure')
  structure(@Param('id', ParseIntPipe) id: number) {
    return this.service.structureWithAI(id);
  }

  @Post(':id/push-to-jira')
  pushToJira(@Param('id', ParseIntPipe) id: number) {
    return this.service.pushToJira(id);
  }

  @Post(':id/complete')
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.complete(id, user.id);
  }

  /**
   * Transcribir un audio (WhatsApp voice note o grabación en vivo) y devolver
   * el texto. El resultado no se guarda aún; el cliente usará el texto para
   * crear una nueva solicitud con POST /client-requests.
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
    return this.service.transcribeAudioBuffer(file.buffer, file.mimetype);
  }
}
