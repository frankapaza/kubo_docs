import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Mensaje único al superar el límite. Deliberadamente genérico: no menciona el
 * correo, ni si existe, ni cuántos intentos quedan. Dos peticiones seguidas con
 * un correo dado de alta y con uno inventado tienen que devolver exactamente lo
 * mismo, byte a byte.
 */
export const THROTTLED_MESSAGE =
  'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.';

/**
 * `ThrottlerGuard` con la forma de error del proyecto.
 *
 * El guard de serie lanza `ThrottlerException`, cuyo cuerpo es la cadena
 * `'ThrottlerException: Too Many Requests'`. Al pasar por `HttpExceptionFilter`
 * eso sale como `{ code: 'INTERNAL_ERROR', message: 'ThrottlerException: Too
 * Many Requests' }`: en inglés, con un `code` que miente sobre lo que pasó y
 * filtrando el nombre de una clase interna. Aquí se sustituye por la forma
 * `{ code, message }` con el mensaje en español que exige el proyecto.
 *
 * Se sobreescribe sin parámetros a propósito: la firma de la clase base recibe
 * el `ExecutionContext` y el detalle del límite, pero ninguno se usa —el
 * mensaje no depende de la ruta ni del contador— y `ThrottlerLimitDetail` no
 * está exportado en el índice del paquete, así que tiparlo obligaría a un
 * import profundo a `dist/`.
 */
@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  protected async throwThrottlingException(): Promise<void> {
    throw new HttpException(
      { code: 'TOO_MANY_REQUESTS', message: THROTTLED_MESSAGE },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
