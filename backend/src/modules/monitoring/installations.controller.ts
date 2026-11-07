import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { createReadStream, promises as fsp } from 'fs';

import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { serveAttachment } from '../../common/http/attachment-response';
import { AppenderPackageService } from './appender-package.service';
import { DiskWatchService } from './disk-watch.service';
import { CreateInstallationDto, UpdateInstallationDto } from './dto/installation.dto';
import { InstallationsService } from './installations.service';

/**
 * Instalaciones de monitoreo y sus claves: solo `ADMIN`. Quien tiene una clave
 * puede escribir logs bajo la identidad de un cliente, así que emitirla,
 * regenerarla o revocarla no es cosa de todo el personal.
 *
 * `GET sources` es la excepción: los filtros de la pantalla de logs la
 * necesitan todos los que pueden leer logs, y no expone ninguna clave.
 */
@Controller('monitoring')
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class InstallationsController {
  constructor(
    private readonly service: InstallationsService,
    private readonly disk: DiskWatchService,
    private readonly appender: AppenderPackageService,
  ) {}

  @Get('installations')
  @Roles('ADMIN')
  list() {
    return this.service.list();
  }

  @Post('installations')
  @Roles('ADMIN')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateInstallationDto) {
    return this.service.create(dto, user.id);
  }

  @Patch('installations/:id')
  @Roles('ADMIN')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateInstallationDto) {
    return this.service.update(id, dto);
  }

  /** Regenerar: la clave anterior deja de valer en el acto. */
  @Post('installations/:id/key')
  @Roles('ADMIN')
  regenerate(@Param('id', ParseIntPipe) id: number) {
    return this.service.regenerateKey(id);
  }

  @Delete('installations/:id/key')
  @Roles('ADMIN')
  revoke(@Param('id', ParseIntPipe) id: number) {
    return this.service.revokeKey(id);
  }

  @Get('sources')
  sources() {
    return this.service.listSourceOptions();
  }

  /** Estado del disco de Loki, tal como lo midió la última comprobación. */
  @Get('disk')
  @Roles('ADMIN')
  diskStatus() {
    return this.disk.status();
  }

  /** El zip del appender, siempre como descarga (`attachment`, `nosniff`). */
  @Get('appender/package')
  @Roles('ADMIN')
  async appenderPackage(@Res() res: Response): Promise<void> {
    // Primero resolver y medir: si falla aún no hay cabeceras y el filtro global contesta su 404.
    const { path, filename } = await this.appender.packageFile();
    const { size } = await fsp.stat(path);
    await serveAttachment(res, {
      stream: createReadStream(path),
      filename,
      headerFilename: filename, // el servicio garantiza un nombre llano y ASCII
      mimeType: 'application/zip',
      size,
    });
  }

  @Get('appender/manual')
  @Roles('ADMIN')
  appenderManual() {
    return this.appender.manual();
  }
}
