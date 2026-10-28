import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { createGlobalValidationPipe } from './common/validation/validation-pipe.factory';
import { registerBulkSendJsonLimit } from './modules/portal/bulk-send-json-limit';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  configureTrustProxy(app, config);

  // Antes de `listen()`, que es quien llama a `init()` y monta el analizador de
  // cuerpos de Nest: por detrás no serviría de nada. Ver el fichero.
  registerBulkSendJsonLimit(app);

  const apiPrefix = config.get<string>('API_PREFIX', 'api/v1');
  app.setGlobalPrefix(apiPrefix);

  app.useGlobalPipes(createGlobalValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());

  app.enableCors({
    origin: config.get<string>('CORS_ORIGINS', '*').split(','),
    credentials: true,
    // Sin esto el navegador no deja que el JavaScript de la página lea
    // `Content-Disposition` en una respuesta de otro origen —y el panel y la
    // API lo son—, así que las descargas no pueden tomar del servidor el
    // nombre del fichero y tienen que volver a escribirlo por su cuenta. Es
    // una cabecera de respuesta, no de petición: no abre nada.
    exposedHeaders: ['Content-Disposition'],
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Kubo DevDocs API')
    .setDescription('API REST del CRM de actas de reunión')
    .setVersion('0.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .build();
  const doc = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, doc, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = parseInt(config.get<string>('PORT', '3000'), 10);
  await app.listen(port, '0.0.0.0');
  Logger.log(`Kubo DevDocs API listening on 0.0.0.0:${port}/${apiPrefix}`, 'Bootstrap');
  Logger.log(`Swagger UI available at http://localhost:${port}/docs`, 'Bootstrap');
}

/**
 * La limitación de intentos del portal cuenta por `req.ip`. Detrás de Caddy,
 * `req.ip` es la IP del contenedor del proxy salvo que express sepa que hay un
 * proxy delante: sin esto, todos los clientes del portal comparten un mismo
 * contador y se bloquean entre sí.
 *
 * `TRUST_PROXY_HOPS` es el número de proxies de confianza que hay por delante
 * (1 con el Caddyfile de este repo). Por defecto **0**: sin proxy declarado,
 * express ignora `X-Forwarded-For`, que es lo correcto en desarrollo y en
 * cualquier despliegue directo — confiar en esa cabecera sin proxy delante
 * dejaría que el propio atacante eligiera su contador falsificándola.
 */
function configureTrustProxy(app: NestExpressApplication, config: ConfigService): void {
  const hops = parseInt(config.get<string>('TRUST_PROXY_HOPS', '0'), 10);
  if (!Number.isInteger(hops) || hops <= 0) return;

  app.set('trust proxy', hops);
  Logger.log(
    `Express confía en ${hops} proxy(s) por delante: la IP del cliente se toma de X-Forwarded-For.`,
    'Bootstrap',
  );
}

bootstrap();
