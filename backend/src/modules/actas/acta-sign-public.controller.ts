import { Controller, Get, HttpCode, Ip, Param, Post } from '@nestjs/common';

import { ActaSignaturesService } from './services/acta-signatures.service';

/**
 * Confirmación de firma de acta por correo (sin sesión): la persona abre el enlace,
 * lee el acta y confirma. El enlace es de un solo uso y vence a los 7 días.
 */
@Controller('acta-sign')
export class ActaSignPublicController {
  constructor(private readonly signatures: ActaSignaturesService) {}

  @Get(':token')
  preview(@Param('token') token: string) {
    return this.signatures.previewByToken(token);
  }

  @Post(':token/confirm')
  @HttpCode(200)
  async confirm(@Param('token') token: string, @Ip() ip: string) {
    const sig = await this.signatures.confirmByToken(token, ip || null);
    return { ok: true, signerName: sig.signerName, confirmedAt: sig.emailConfirmedAt };
  }
}
