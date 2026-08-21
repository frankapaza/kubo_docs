/**
 * La zona horaria del negocio: Lima, Perú.
 *
 * Vive en `common/` porque más de un sitio la necesita, y no debe haber dos
 * copias: `NotificationDispatcher` la usa para imprimir fechas legibles en
 * los correos, y `WorkItemIntakeService` para decidir qué día es "hoy" al
 * validar una fecha comprometida. La copia que alguien olvide actualizar es
 * la que vuelve a comparar contra la zona del proceso.
 *
 * El sistema corre en UTC de punta a punta —ni el Dockerfile, ni el compose,
 * ni el `.env.production.example` fijan `TZ`, y no deben fijarla: eso sería
 * depender de que alguien acierte con una variable de entorno—. El negocio,
 * en cambio, corre en hora de Lima, cinco horas detrás de UTC. La zona se
 * escribe aquí, en el código, para que el resultado sea determinista y no
 * dependa de en qué máquina corra el proceso.
 *
 * Este es justo el fallo que ya mordió una vez, en los correos: un ticket
 * abierto a las 18:14 de Lima le llegaba al cliente como las 11:14 p. m.
 * porque `toLocaleString` sin `timeZone` toma la del proceso. Y no se cazó
 * antes porque el backend de desarrollo corre en el host, que ya está en
 * hora de Lima —el mismo motivo por el que un `hoyCivil` construido con
 * `getFullYear/getMonth/getDate` (que también leen la zona del proceso) pasa
 * inadvertido en desarrollo y falla en producción.
 */
export const PERU_TIME_ZONE = 'America/Lima';
