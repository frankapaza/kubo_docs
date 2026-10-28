import { INestApplication } from '@nestjs/common';
import { NextFunction, Request, Response, json } from 'express';

import { BULK_SEND_JSON_LIMIT_BYTES } from './domain/bulk-users-review';

/**
 * El analizador de JSON de `POST /client-users/carga-masiva/envio`, con SU
 * tope y no con el de todo el mundo.
 *
 * ## Por qué hace falta
 *
 * El analizador global de express trae 100 KB, y rechaza **antes** de cualquier
 * guarda, pipe o controlador: lo que lanza no es una `HttpException` de Nest,
 * así que caía en el 500 genérico del filtro. Y 100 KB no es un techo teórico
 * aquí: una revisión legítima de 200 filas —el tope que esta pantalla ofrece—
 * con nombres y correos largos los roza. O sea que el tope anunciado daba
 * error interno justo en su extremo. El 500 se arregla en
 * `HttpExceptionFilter` (que es cosa de todas las rutas, no solo de esta); el
 * tope se arregla aquí.
 *
 * ## Por qué así y no con un middleware del módulo
 *
 * Nest monta su analizador de cuerpos dentro de `app.init()`, y los middleware
 * que declara un módulo con `MiddlewareConsumer` corren DESPUÉS. Un segundo
 * `json()` por detrás no serviría de nada: `body-parser` se salta la petición
 * cuyo cuerpo ya está leído (`req._body`), así que el que decide es siempre el
 * primero. Por eso esto se registra con `app.use` **antes de `init()`**, y por
 * eso lo llaman las dos puntas que levantan una aplicación: `main.ts` y
 * `startTestHttpApp`. Si la prueba no monta lo mismo que producción, comprueba
 * otra aplicación.
 *
 * ## Por qué se mira la ruta a mano
 *
 * `app.use('/ruta', ...)` tendría que saber si delante va el prefijo global
 * (`api/v1` en producción, nada en las pruebas). Mirar el final del camino
 * vale para las dos y no obliga a que la prueba invente un prefijo.
 */
const RUTA_DE_ENVIO = /\/client-users\/carga-masiva\/envio\/?$/;

export function registerBulkSendJsonLimit(app: INestApplication): void {
  const analizador = json({ limit: BULK_SEND_JSON_LIMIT_BYTES });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'POST' && RUTA_DE_ENVIO.test(req.path)) {
      analizador(req, res, next);
      return;
    }
    next();
  });
}
