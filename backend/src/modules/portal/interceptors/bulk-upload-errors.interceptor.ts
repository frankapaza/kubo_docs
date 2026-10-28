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

import { MAX_BULK_FILE_BYTES } from '../domain/bulk-user-file';

/**
 * Traduce al idioma y a la forma de la casa los errores que produce la propia
 * subida, antes de que llegue a ejecutarse el método del controlador.
 *
 * **Por qué no se reutiliza `AttachmentUploadErrorsInterceptor`**, que hace lo
 * mismo para los adjuntos de tickets: su mensaje nombra el tope de 10 MB por
 * archivo adjunto, que es otro número y otra superficie. Reutilizarlo obligaría
 * a parametrizarlo —y a tocar dos controladores que están en producción por una
 * funcionalidad nueva— o a que esta ruta mintiera sobre su propio tope. Son
 * ochenta líneas de las que solo se repiten diez, y la copia queda anotada en
 * las dos puntas.
 *
 * **Por qué no un `ExceptionFilter` con `@Catch(MulterError)`:** porque no se
 * dispararía. `@nestjs/platform-express` pasa todos los errores de multer por
 * `transformException` y los convierte en `HttpException` antes de que ningún
 * filtro los vea.
 *
 * Va **por delante** de `FileInterceptor` en `@UseInterceptors`: es su
 * `next.handle()` el que envuelve a la subida y el único sitio desde el que se
 * ve ese error.
 */
@Injectable()
export class BulkUploadErrorsInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(catchError((error) => throwError(() => traducir(error))));
  }
}

const MAX_KB = Math.round(MAX_BULK_FILE_BYTES / 1024);

const DEMASIADO_GRANDE = {
  code: 'PAYLOAD_TOO_LARGE',
  message:
    `El archivo supera el máximo de ${MAX_KB} KB. Una plantilla rellenada con doscientas ` +
    'filas no llega ni a la décima parte: comprueba que estás subiendo la plantilla y no otra cosa.',
} as const;

const SUBIDA_ILEGIBLE = {
  code: 'UPLOAD_ERROR',
  message: 'No se pudo leer el archivo enviado. Adjúntalo en el campo «file» y vuelve a intentarlo.',
} as const;

/**
 * El criterio para saber si hay que traducirlo es **si ya trae `code`**, el
 * mismo que usa `HttpExceptionFilter.resolveCode`. Todo lo que lanzan el
 * dominio y el servicio lo trae; lo que sale de `transformException` es un
 * `HttpException` con un texto suelto en inglés, y no. Así no hay que reconocer
 * mensajes concretos de una librería, que es lo que se rompe en la siguiente
 * versión menor.
 */
function traducir(error: unknown): unknown {
  if (!(error instanceof HttpException) || yaTieneCodigo(error)) return error;
  if (error instanceof PayloadTooLargeException) return new PayloadTooLargeException(DEMASIADO_GRANDE);
  if (error instanceof BadRequestException) return new BadRequestException(SUBIDA_ILEGIBLE);
  return error;
}

function yaTieneCodigo(error: HttpException): boolean {
  const cuerpo = error.getResponse();
  return (
    typeof cuerpo === 'object' &&
    cuerpo !== null &&
    typeof (cuerpo as { code?: unknown }).code === 'string'
  );
}
