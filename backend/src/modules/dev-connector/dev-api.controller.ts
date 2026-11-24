import { Body, Controller, Get, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';

import { DevApiService } from './dev-api.service';
import { DevKeyGuard, DevRequest } from './dev-key.guard';
import { DevLinkDto, DevNoteDto, DevResolveDto, DevStatusDto } from './dto/dev-admin.dto';

/**
 * `/api/v1/dev/*`: lo que llama el MCP `kubo-devdocs`. Autentica la clave
 * `kdev_` (no el JWT) y todo queda acotado a la asignación de esa clave.
 */
@Controller('dev')
@UseGuards(DevKeyGuard)
export class DevApiController {
  constructor(private readonly api: DevApiService) {}

  @Get('contexto')
  contexto(@Req() req: DevRequest) {
    return this.api.contexto(req.dev!);
  }

  @Get('pendientes')
  pendientes(@Req() req: DevRequest) {
    return this.api.pendientes(req.dev!);
  }

  @Get('items/:code')
  item(@Req() req: DevRequest, @Param('code') code: string) {
    return this.api.item(req.dev!, code);
  }

  @Get('items/:code/adjuntos/:id')
  adjunto(@Req() req: DevRequest, @Param('code') code: string, @Param('id', ParseIntPipe) id: number) {
    return this.api.adjunto(req.dev!, code, id);
  }

  @Post('items/:code/tomar')
  tomar(@Req() req: DevRequest, @Param('code') code: string) {
    return this.api.tomar(req.dev!, code);
  }

  @Post('items/:code/resolver')
  resolver(@Req() req: DevRequest, @Param('code') code: string, @Body() dto: DevResolveDto) {
    return this.api.resolver(req.dev!, code, dto);
  }

  @Post('items/:code/borrador')
  borrador(@Req() req: DevRequest, @Param('code') code: string, @Body() dto: DevNoteDto) {
    return this.api.borrador(req.dev!, code, dto.texto);
  }

  @Post('items/:code/nota')
  nota(@Req() req: DevRequest, @Param('code') code: string, @Body() dto: DevNoteDto) {
    return this.api.nota(req.dev!, code, dto.texto);
  }

  @Post('items/:code/estado')
  estado(@Req() req: DevRequest, @Param('code') code: string, @Body() dto: DevStatusDto) {
    return this.api.estado(req.dev!, code, dto.estado);
  }

  @Post('items/:code/vinculos')
  vincular(@Req() req: DevRequest, @Param('code') code: string, @Body() dto: DevLinkDto) {
    return this.api.vincular(req.dev!, code, dto);
  }
}
