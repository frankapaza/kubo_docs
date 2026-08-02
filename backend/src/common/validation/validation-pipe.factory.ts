import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';

/**
 * Mensaje único para `forbidNonWhitelisted`.
 *
 * El literal de serie es «property clientId should not exist»: en inglés y con
 * el nombre exacto de la propiedad dentro. En el portal eso es superficie
 * interna filtrada —§4.2 de la spec dice que un endpoint del portal que acepte
 * un `clientId` es un fallo de seguridad, y el propio error de rechazo le
 * confirmaba al atacante el nombre que estaba buscando— y en el panel interno
 * tampoco aporta nada al usuario, que no elige los nombres de las propiedades
 * que manda el frontend.
 */
export const UNEXPECTED_PROPERTY_MESSAGE =
  'La solicitud incluye campos que no se admiten en este formulario.';

/**
 * Clave con la que class-validator marca los errores de `forbidNonWhitelisted`
 * (`ValidationTypes.WHITELIST`).
 */
const WHITELIST_CONSTRAINT = 'whitelistValidation';

/**
 * Aplana el árbol de `ValidationError` a una lista de mensajes, sustituyendo
 * los de lista blanca por el genérico y quitando repetidos: dos decoradores
 * distintos pueden compartir mensaje a propósito (`@IsString` y `@MinLength(1)`
 * sobre el mismo campo dicen los dos «es obligatorio»), y varias propiedades no
 * declaradas producen todas el mismo texto genérico.
 */
function collectMessages(errors: ValidationError[], into: string[] = []): string[] {
  for (const error of errors) {
    for (const [constraint, message] of Object.entries(error.constraints ?? {})) {
      into.push(constraint === WHITELIST_CONSTRAINT ? UNEXPECTED_PROPERTY_MESSAGE : String(message));
    }
    if (error.children?.length) collectMessages(error.children, into);
  }
  return into;
}

/**
 * El `ValidationPipe` global, en un solo sitio.
 *
 * Vive aquí y no dentro de `main.ts` para que las pruebas de integración monten
 * exactamente el mismo pipe que producción: si la prueba configura el suyo, va
 * derivando y acaba comprobando otra aplicación.
 *
 * La `exceptionFactory` devuelve la forma `{ code, message }` del proyecto, con
 * `message` como lista de mensajes. El `HttpExceptionFilter` es quien la
 * convierte en el texto que ve el usuario y en el `details` de la respuesta.
 */
export function createGlobalValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    exceptionFactory: (errors: ValidationError[]) =>
      new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: [...new Set(collectMessages(errors))],
      }),
  });
}
