import { ThrottlerOptions } from '@nestjs/throttler';

/**
 * Limitación de intentos de la superficie de autenticación pública del portal
 * (§9 de la spec: «Superficie de autenticación pública nueva»).
 *
 * Hasta el portal, el producto no exponía ningún endpoint de credenciales
 * alcanzable sin sesión. `POST /portal/auth/login` sí lo es, y sin límite un
 * atacante consigue ~25 intentos por segundo y conexión —bcrypt a coste 10 son
 * unos 38 ms— sin que la cuenta se degrade nunca.
 *
 * ## Dos ventanas, no una
 *
 * Una sola ventana obliga a elegir entre frenar la ráfaga o frenar el goteo:
 *
 *  - Una ventana corta y estricta (5/min) para la ráfaga. Deja margen de sobra
 *    a quien se equivoca al teclear —dos o tres intentos es lo normal— y
 *    recorta el techo de 1500 intentos/minuto a 5: un factor de 300.
 *  - Una ventana larga (20 cada 15 min) para el goteo. Sin ella, gastar 5 por
 *    minuto indefinidamente son 7200 intentos al día desde una sola IP; con
 *    ella, 1920. La corta sola no lo ve porque su contador se reinicia entero
 *    cada minuto.
 *
 * ## El refresco es más laxo que el login
 *
 * El refresco no prueba contraseñas: verifica una firma, que es barata y no se
 * adivina por fuerza bruta. Se limita igualmente porque también es alcanzable
 * sin sesión y no queremos un endpoint sin techo, pero con margen: varias
 * pestañas abiertas del portal pueden refrescar a la vez cuando caduca el
 * access token (15 min por defecto), y cada pestaña tiene su propia promesa
 * compartida en `portal.api.ts`. 5/min ahí sí cerraría sesiones legítimas.
 *
 * ## El contador es por IP, nunca por correo
 *
 * `ThrottlerGuard.getTracker` usa `req.ip` por defecto y así se deja. Contar
 * por correo permitiría distinguir una dirección dada de alta de una que no lo
 * está: bastaría con ver cuál de las dos empieza a devolver 429 antes. Con el
 * contador por IP, la respuesta al límite es idéntica para cualquier correo, y
 * como el guard corre antes que el pipe y antes que el servicio, cuenta todas
 * las peticiones por igual: válidas, inválidas y malformadas.
 *
 * ## Alcance
 *
 * Estos limitadores solo se montan en `PortalAuthController`. El panel interno
 * NO se limita: tiene pantallas que disparan ráfagas legítimas de peticiones
 * (el tablero de work items, el detalle de ticket, los reportes), y romperlas
 * sería peor que el problema que se arregla aquí. El login del personal
 * (`auth.controller.ts`) tiene la misma carencia y queda fuera de esta rama.
 *
 * Las excepciones a esa regla son dos, y las dos mandan correo de verdad: el
 * envío de prueba de una plantilla de correo (`NOTIFICATION_TEST_THROTTLE`) y
 * el envío de la carga masiva de usuarios (`BULK_INVITE_THROTTLE`), los dos al
 * final del fichero.
 */

/** Ventana corta: frena la ráfaga. */
export const THROTTLER_BURST = 'burst';
/** Ventana larga: frena el goteo sostenido. */
export const THROTTLER_SUSTAINED = 'sustained';

const ONE_MINUTE_MS = 60_000;
const FIFTEEN_MINUTES_MS = 15 * 60_000;

/** Configuración base del `ThrottlerModule`, que es la del login del portal. */
export const PORTAL_AUTH_THROTTLERS: ThrottlerOptions[] = [
  { name: THROTTLER_BURST, ttl: ONE_MINUTE_MS, limit: 5 },
  { name: THROTTLER_SUSTAINED, ttl: FIFTEEN_MINUTES_MS, limit: 20 },
];

/** Override para `POST /portal/auth/refresh`, vía `@Throttle`. */
export const PORTAL_REFRESH_THROTTLE = {
  [THROTTLER_BURST]: { ttl: ONE_MINUTE_MS, limit: 10 },
  [THROTTLER_SUSTAINED]: { ttl: FIFTEEN_MINUTES_MS, limit: 60 },
};

/**
 * Override para `POST /notification-templates/:id/test`.
 *
 * La primera excepción al «el panel interno no se limita» de arriba, y por un
 * motivo que no aplica al resto: es una de las dos rutas del panel con un
 * efecto externo e irreversible (la otra es `BULK_INVITE_THROTTLE`). Cada llamada saca un correo de verdad por el SMTP de
 * producción. Un administrador con el dedo pegado al botón —o una sesión suya
 * comprometida— puede quemar la cuota del proveedor y la reputación del
 * remitente, que es justo el activo que la §9 de la spec señala como riesgo:
 * si el dominio se quema, los avisos acaban en no deseado y toda la
 * funcionalidad deja de servir por perfecto que esté el código.
 *
 * Los límites son holgados para el uso real —enviarse una prueba es algo que
 * se hace unas pocas veces mientras se ajusta un texto— y estrechos frente al
 * abuso. Se limita SOLO esta ruta: listar, editar y previsualizar no envían
 * nada, y limitarlas sería molestar sin motivo.
 */
export const NOTIFICATION_TEST_THROTTLE = {
  [THROTTLER_BURST]: { ttl: ONE_MINUTE_MS, limit: 3 },
  [THROTTLER_SUSTAINED]: { ttl: FIFTEEN_MINUTES_MS, limit: 10 },
};

/**
 * Override para `POST /portal/invitaciones/aceptar` y para
 * `GET /portal/invitaciones/:secret` (la vista previa, decisión 10 de la
 * spec): las dos cuelgan del mismo `PortalInvitationsController` y llevan los
 * MISMOS LÍMITES a propósito — la vista previa no escribe nada, pero sigue
 * siendo una superficie sin autenticar sobre el mismo secreto, y bajarle el
 * tope solo porque no escribe abriría una vía más barata para probar enlaces
 * que la de aceptar.
 *
 * **Mismos límites no es el mismo contador.** `ThrottlerGuard.generateKey`
 * mete el nombre del controlador Y el del manejador en la clave, así que cada
 * ruta lleva su cuenta aparte: desde una misma IP salen 5 aceptaciones por
 * minuto MÁS 5 vistas previas, no 5 entre las dos. Es la misma propiedad que
 * ya tiene el par login/refresco del portal —y que su prueba fija por escrito
 * («lleva su propio contador»)— y se deja así en vez de forzar un contador
 * compartido: unificarlo obligaría a sobreescribir `generateKey` solo para
 * este par, y 10/minuto desde una IP sigue siendo un techo irrelevante frente
 * a un secreto de 32 bytes al azar. Lo que no se deja es la promesa a medias:
 * si mañana el número importa, el número es 10, no 5.
 *
 * Es la tercera superficie del producto abierta a internet y la primera sin
 * autenticar que entrega una credencial. El contador va **por dirección de
 * origen** (`ThrottlerGuard.getTracker` usa `req.ip`), nunca por el secreto:
 * contar por secreto permitiría distinguir un enlace que existe de uno que no
 * según cuál empezara a devolver 429 antes, deshaciendo justo el trabajo de
 * que todos los fallos respondan lo mismo.
 *
 * Falla cerrado por construcción: el guard corre ANTES del pipe y ANTES del
 * servicio, así que cuenta todas las peticiones por igual —válidas, inválidas
 * y malformadas—, y si su almacén de contadores revienta, la excepción sube y
 * la petición no se atiende. Misma disciplina que los topes del correo
 * entrante: un tope que falla abierto no es un tope.
 *
 * Los límites son los del login, no los del refresco: aceptar una invitación
 * es algo que una persona hace una vez, y adivinar un secreto de 32 bytes no
 * es el escenario —el escenario es el ruido y el abuso.
 */
export const PORTAL_INVITATION_THROTTLE = {
  [THROTTLER_BURST]: { ttl: ONE_MINUTE_MS, limit: 5 },
  [THROTTLER_SUSTAINED]: { ttl: FIFTEEN_MINUTES_MS, limit: 20 },
};

/**
 * Override para `POST /client-users/carga-masiva/envio`.
 *
 * **La segunda excepción al «el panel interno no se limita»**, y por el mismo
 * motivo que la primera (`NOTIFICATION_TEST_THROTTLE`): efecto externo e
 * irreversible. Aquí en peor, además: una sola petición saca hasta 200 correos
 * de verdad por el SMTP de producción, y quemar la cuota del proveedor o la
 * reputación del remitente es el riesgo que hunde la funcionalidad entera por
 * perfecto que esté el código.
 *
 * **NO es el tope de invitar del portal, y conviene saber por qué.** Aquel
 * existe para cerrar un oráculo —un 201 contra un 400 dice si una dirección
 * está libre—. Aquí ese oráculo no existe, y no porque lo hayamos cerrado:
 * porque el panel dice el motivo de cada fila a propósito (decisión 10 de la
 * spec), y lo dice porque quien mira ya puede leerse la lista entera de
 * empresas y usuarios. Copiar aquel tope sería copiar el mecanismo sin su
 * motivo, que es como se acumulan las reglas que nadie sabe por qué están.
 *
 * Las otras dos rutas de la carga masiva —la plantilla y la revisión— van SIN
 * tope: no mandan nada, y limitar la revisión molestaría justo en el paso que
 * existe para que el operador corrija y vuelva a intentarlo.
 *
 * **Los números, y por qué estos y no otros (decisión 2 de esta revisión del
 * diseño):** el caso real es una carga de 22 una vez, pero el tope no se
 * calibra contra ese caso suelto sino contra la sesión de trabajo completa,
 * que puede traer **dos clientes seguidos** el mismo rato.
 *
 * - **Ráfaga: 1 por minuto.** Entre revisar 22 filas y confirmar pasa siempre
 *   más de un minuto, así que ningún uso legítimo la roza; lo único que corta
 *   es un doble clic.
 * - **Sostenido: 3 cada quince minutos.** Caben los dos clientes seguidos
 *   **y** un reintento —volver a subir el archivo entero porque una fila
 *   quedó `INVITADA_SIN_CORREO` (decisión 13 de la spec)— sin esperar entre
 *   medias. Con 2 cabría la pareja y nada más: el primer reintento del día
 *   chocaría con el tope, y reintentar no es un caso raro.
 *
 * El techo teórico queda anotado tal cual: 3 × 200 = 600 correos cada quince
 * minutos desde una dirección. Es la mitad del que dejaban los valores
 * anteriores de este mismo diseño (2 y 6, con un techo de 1200), y llegar a él
 * exige de todos modos tres archivos de 200 filas en el mismo cuarto de hora
 * desde una sesión con rol ADMIN y asiento en `audit_log` — no es el patrón de
 * un cliente cargándose, es el patrón de alguien intentando algo raro. Bajarlo
 * más (a 1) sí estorbaría el uso legítimo: dejaría sin sitio al segundo
 * cliente del día o a cualquier reintento del primero.
 */
export const BULK_INVITE_THROTTLE = {
  [THROTTLER_BURST]: { ttl: ONE_MINUTE_MS, limit: 1 },
  [THROTTLER_SUSTAINED]: { ttl: FIFTEEN_MINUTES_MS, limit: 3 },
};
