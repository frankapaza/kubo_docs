import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Observable, catchError, throwError } from 'rxjs';

import { MAX_FILE_BYTES } from '../domain/attachment-rules';

/**
 * Traduce al idioma y a la forma de la casa los errores que produce la propia
 * subida, antes de que llegue a ejecutarse el método del controlador.
 *
 * **Por qué no un `ExceptionFilter` con `@Catch(MulterError)`**, que es lo que
 * hace `audio.controller.ts`: porque ese filtro nunca se dispara.
 * `@nestjs/platform-express` pasa **todos** los errores de multer por
 * `transformException` (`multer/multer/multer.utils.js`) y los convierte en
 * `HttpException` antes de que ningún filtro los vea, así que `@Catch` sobre la
 * clase de multer no llega a casar nunca. Comprobado contra el backend real:
 * un fichero de 12 MB salía con `413` y el mensaje **«File too large»**, en
 * inglés y puesto por Nest -- no por el filtro. (En la subida de audio pasa lo
 * mismo desde siempre; queda anotado, no se toca en esta tarea.)
 *
 * Va **por delante** de `FileInterceptor` en `@UseInterceptors`, que es lo que
 * pone su `next.handle()` alrededor de la subida y lo deja ver ese error.
 *
 * No compone la respuesta: relanza una `HttpException` con el
 * `{ code, message }` de siempre y deja que `HttpExceptionFilter` la sirva como
 * sirve las demás. Un filtro escribiendo aquí su propio JSON sería una segunda
 * forma de respuesta de error que se quedaría vieja sola.
 */
@Injectable()
export class AttachmentUploadErrorsInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(catchError((error) => throwError(() => translate(error))));
  }
}

/** Los megabytes del tope, para el mensaje. `MAX_FILE_BYTES` es un entero de MB. */
const MAX_FILE_MB = Math.round(MAX_FILE_BYTES / (1024 * 1024));

/**
 * Lo que se le contesta a quien se pasa del tope de multer.
 *
 * Dice el mismo número que el mensaje de `assertAcceptable`, porque son el
 * mismo tope: el de aquí es solo la criba que evita tragarse el fichero entero
 * en memoria. Que un rechazo se explique de dos maneras distintas según por
 * cuál de las dos puertas salió sería un misterio para quien lo lee.
 */
const DEMASIADO_GRANDE = {
  code: 'PAYLOAD_TOO_LARGE',
  message: `El archivo supera el máximo de ${MAX_FILE_MB} MB por archivo. Redúcelo y vuelve a subirlo.`,
} as const;

/** Lo demás que puede romper en el multipart: campo inesperado, cuerpo mal formado… */
const SUBIDA_ILEGIBLE = {
  code: 'UPLOAD_ERROR',
  message: 'No se pudo leer el archivo enviado. Adjúntalo en el campo «file» y vuelve a intentarlo.',
} as const;

/**
 * El error, con la forma del proyecto.
 *
 * El criterio para saber si hay que traducirlo es **si ya trae `code`**, que es
 * el mismo que usa `HttpExceptionFilter.resolveCode` para decidir si tiene que
 * inventarse uno. Todo lo que lanzan los servicios y los pipes de este
 * controlador lo trae; lo que sale de `transformException` es un
 * `HttpException` con un texto suelto en inglés, y no. Así no hay que reconocer
 * mensajes concretos de una librería, que es lo que se rompe en la siguiente
 * versión menor.
 */
function translate(error: unknown): unknown {
  if (!(error instanceof HttpException) || yaTieneCodigo(error)) return error;

  if (error instanceof PayloadTooLargeException) {
    return new PayloadTooLargeException(DEMASIADO_GRANDE);
  }
  if (error instanceof BadRequestException) {
    return new BadRequestException(SUBIDA_ILEGIBLE);
  }
  return error;
}

function yaTieneCodigo(error: HttpException): boolean {
  const cuerpo = error.getResponse();
  return typeof cuerpo === 'object' && cuerpo !== null && typeof (cuerpo as { code?: unknown }).code === 'string';
}
