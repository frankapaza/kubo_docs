/**
 * Un fallo al **escribir** en el hilo, partido en dos.
 *
 * El titular va aparte del detalle porque **importa tanto como él**: no es lo
 * mismo «no se publicó nada» que «no lo sé». Con una respuesta que no llega no
 * se sabe si el mensaje entró, y afirmar que no entró sería la forma más
 * directa de provocar el envío duplicado — que en una respuesta pública son dos
 * correos idénticos al cliente, y ninguno se puede retirar.
 *
 * Vive en su propio módulo y no dentro del compositor porque lo pintan dos
 * sitios --el compositor y el diálogo de confirmación-- y el compositor ya
 * importa al diálogo: tenerlo en cualquiera de los dos crearía un ciclo.
 */
export interface PostFailure {
  /** Qué se sabe con certeza. Se pinta en negrita. */
  headline: string;
  /** Por qué, con el texto del backend cuando lo hay. */
  detail: string;
}
