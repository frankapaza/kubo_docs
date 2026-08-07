/**
 * El nombre que de verdad mandó quien subió el fichero.
 *
 * **`file.originalname` no lo es.** Busboy decodifica el `filename=` del
 * multipart como **latin1**, y multer 1.4.5 no le pasa `defParamCharset` ni
 * expone forma de configurarlo: cualquier nombre en UTF-8 -- que es lo que
 * manda todo navegador actual -- llega hecho mojibake. Comprobado contra el
 * backend real: `facturación.png` se guardaba como `facturaciÃ³n.png`, y
 * `文件.png` como `æ–‡ä»¶.png`. Se deshace en la frontera HTTP, porque es la
 * única capa que sabe de multipart; el servicio recibe ya el nombre bueno.
 *
 * **Vive en `common/` y no en un controlador porque hay dos puertas de subida**
 * -- el panel (`ticket-messages.controller.ts`) y el portal
 * (`portal-messages.controller.ts`) -- y el mismo navegador manda el mismo
 * mojibake por las dos. Dos copias de una decodificación es exactamente cómo se
 * arregla una y se queda la otra: los nombres del portal seguirían saliendo
 * rotos meses después de que los del panel se hubieran arreglado.
 *
 * **Solo se reinterpreta si los bytes vuelven idénticos.** Un nombre que de
 * verdad venía en latin1 (`café.png` con la `é` en un byte) no es UTF-8 válido,
 * y forzar la conversión le metería un `U+FFFD`: quedaría peor que antes. La
 * primera condición descarta lo que ya no está en el rango latin1 -- si alguien
 * arregla esto aguas arriba, este código se convierte en un no-op en vez de
 * romperlo.
 *
 * No decide nada sobre quién ve qué: es una cuestión de codificación de la capa
 * de transporte, y el nombre no gobierna ninguna regla (ni la clave de
 * almacenamiento, ni el tipo, ni la visibilidad).
 */
export function decodeMultipartFilename(originalname: string): string {
  const recibido = originalname ?? '';
  const bytes = Buffer.from(recibido, 'latin1');
  if (bytes.toString('latin1') !== recibido) return recibido;

  const comoUtf8 = bytes.toString('utf8');
  return Buffer.from(comoUtf8, 'utf8').equals(bytes) ? comoUtf8 : recibido;
}
