import { parentPort, workerData } from 'worker_threads';

import { parseWorkbookGrid } from './bulk-users-workbook';

/**
 * El hilo donde se abre el libro subido.
 *
 * **Existe por una sola razón: que una bomba de descompresión mate a un hilo y
 * no al servidor.** El backend es un único proceso —el mismo que manda los
 * avisos y lee el correo entrante—, así que agotarle la memoria aquí dentro no
 * tumbaría esta pantalla, las tumbaría todas. Quien lo arranca, con qué tope
 * de memoria y con qué plazo está en `parseWorkbookInThread`.
 *
 * Este fichero es a propósito **lo más tonto posible**: recibe bytes, llama al
 * lector de siempre y contesta. Toda la lógica de leer un libro sigue viviendo
 * en `bulk-users-workbook.ts`, que es también el único que importa `exceljs`;
 * si esto tuviera su propia copia, el hilo y las pruebas leerían distinto.
 *
 * Lo que NO hace: tocar la base, el correo, el reloj o la configuración. No
 * recibe ninguna variable de entorno (`env: {}`), así que aquí no hay
 * credenciales que robar aunque el parser tuviera un agujero.
 */
async function abrirLibro(): Promise<void> {
  // Sin puerto no hay a quién contestar: esto es un hilo, no un módulo que
  // nadie deba importar por su cuenta.
  if (!parentPort) return;

  try {
    const grid = await parseWorkbookGrid(Buffer.from(workerData as Uint8Array));
    parentPort.postMessage({ ok: true, grid });
  } catch (err) {
    // Un rechazo del lector lleva un texto escrito PARA EL OPERADOR, y ese sí
    // cruza. Cualquier otra cosa no: su mensaje es diagnóstico interno y puede
    // llevar rutas del paquete, así que se queda sin texto y quien recibe
    // decide qué decir.
    parentPort.postMessage({ ok: false, rechazo: textoParaElOperador(err) });
  }
}

/**
 * El texto de un `archivoRechazado`, si lo que falló fue eso.
 *
 * Se lee por la forma y no con un `instanceof BadRequestException`: cruzar la
 * frontera del hilo con una clase de Nest para preguntarle el tipo a un error
 * sería traerse medio framework a un sitio que solo tiene que abrir un ZIP.
 */
function textoParaElOperador(err: unknown): string | undefined {
  const respuesta = (err as { getResponse?: () => unknown })?.getResponse?.();
  const mensaje = (respuesta as { message?: unknown })?.message;
  return typeof mensaje === 'string' ? mensaje : undefined;
}

void abrirLibro();
