import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    // El cuerpo que no cabe se mira ANTES del 500 genérico: no es una
    // `HttpException`, así que sin esto caía ahí. Ver `cuerpoQueNoCabe`.
    const noCabe = cuerpoQueNoCabe(exception);

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : noCabe
        ? HttpStatus.PAYLOAD_TOO_LARGE
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const payload: string | Record<string, unknown> =
      exception instanceof HttpException
        ? (exception.getResponse() as string | Record<string, unknown>)
        : (noCabe ?? { message: 'Internal server error' });

    const asObject = typeof payload === 'object' ? payload : {};
    // `message` no es siempre un string: los errores de validación de
    // class-validator llegan como `string[]`, uno por restricción incumplida.
    // Serializarlo tal cual dejaba que React los pintara concatenados sin
    // separador alguno («El asunto es obligatorio.La descripción es
    // obligatoria.»), porque un array de nodos se renderiza pegado.
    const rawMessage = typeof payload === 'string' ? payload : asObject.message;
    const messages = Array.isArray(rawMessage) ? rawMessage.map(String) : undefined;

    const body = {
      statusCode: status,
      code: this.resolveCode(status, asObject),
      // Un solo texto legible, siempre. La lista completa sigue disponible en
      // `details` para quien quiera pintarla campo a campo.
      message: messages
        ? messages.join(' ')
        : typeof rawMessage === 'string'
          ? rawMessage
          : 'Error',
      details: asObject.details ?? messages,
      path: req.url,
      timestamp: new Date().toISOString(),
    };

    if (status >= 500) {
      this.logger.error(`${req.method} ${req.url} → ${status}`, exception as Error);
    }

    res.status(status).json(body);
  }

  private resolveCode(status: number, payload: Record<string, unknown>): string {
    if (typeof payload.code === 'string') {
      return payload.code;
    }
    const map: Record<number, string> = {
      400: 'VALIDATION_ERROR',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      413: 'PAYLOAD_TOO_LARGE',
      415: 'UNSUPPORTED_MEDIA_TYPE',
      429: 'TOO_MANY_REQUESTS',
    };
    return map[status] ?? 'INTERNAL_ERROR';
  }
}

/**
 * El cuerpo que no cabe en el analizador de express, traducido a un 413 con el
 * cuerpo de la casa — o `null` si la excepción es otra cosa.
 *
 * **Por qué aquí y no en un interceptor de la ruta:** `body-parser` rechaza
 * antes de que la petición llegue a ningún guarda, pipe, interceptor o
 * controlador, así que el único sitio desde el que se ve ese error es el filtro
 * global. Y lo que lanza no es una `HttpException` de Nest sino un error de
 * `http-errors`, de modo que caía en el 500 genérico: «error interno» para algo
 * que es culpa del cuerpo enviado y que tiene arreglo por parte de quien lo
 * envía. Eso engañaba **en todas las rutas**, no solo en la de la carga masiva.
 *
 * Se reconoce por `type`, que es el campo con el que `body-parser` etiqueta sus
 * propios rechazos, y no por el texto del mensaje: el texto cambia con la
 * siguiente versión menor.
 */
function cuerpoQueNoCabe(exception: unknown): Record<string, unknown> | null {
  const err = exception as { type?: unknown; status?: unknown };
  if (err?.type !== 'entity.too.large') return null;
  return {
    code: 'PAYLOAD_TOO_LARGE',
    message:
      'El contenido enviado es demasiado grande para esta operación. ' +
      'No se ha procesado nada: divídelo en partes más pequeñas y vuelve a intentarlo.',
  };
}
