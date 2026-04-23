import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { EmailService } from './email.service';

@Controller('email')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmailController {
  constructor(private readonly service: EmailService) {}

  /**
   * Prueba la configuración SMTP enviando un correo de "ping" al usuario SMTP.
   * Útil para verificar credenciales antes de enviar documentos reales.
   */
  @Post('test-smtp')
  @HttpCode(200)
  @Roles('ADMIN')
  test() {
    return this.service.testConnection();
  }
}
