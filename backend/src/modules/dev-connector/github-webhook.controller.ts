import { Body, Controller, Headers, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Response } from 'express';

import { RawBodyRequest } from './github-webhook-body';
import { GithubWebhookService } from './github-webhook.service';

/**
 * `POST /api/v1/dev/github/webhook`: público (sin JWT ni clave); lo autentica
 * la firma HMAC con el secreto del repo. 200 con lo enlazado; 204 para los
 * eventos que no se tratan (incluido el `ping` de alta del webhook).
 */
@Controller('dev/github')
export class GithubWebhookController {
  constructor(private readonly service: GithubWebhookService) {}

  @Post('webhook')
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest,
    @Headers('x-github-event') event: string | undefined,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ linked: number } | void> {
    const out = await this.service.handle(
      String(event ?? ''),
      req.rawBody ?? Buffer.alloc(0),
      signature,
      (body ?? {}) as Record<string, unknown>,
    );
    if (out.ignored) {
      res.status(204);
      return;
    }
    return { linked: out.linked };
  }
}
