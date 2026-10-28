import { readFileSync } from 'fs';
import { join } from 'path';

import { BULK_ROW_VERDICTS, BULK_SEND_OUTCOMES } from './client-users-bulk.service';

/**
 * El contrato de las enumeraciones de la carga masiva, cotejado contra la copia
 * del panel.
 *
 * **Por qué existe esta prueba rara.** El veredicto de cada fila y el resultado
 * de cada envío viajan como cadenas, y el panel los traduce a una etiqueta y a
 * una clase de estilo con sendas tablas. Las uniones del panel
 * (`web/src/api/client-users-bulk.api.ts`) están escritas a mano, porque el
 * backend y el panel son dos proyectos de TypeScript distintos y el fichero que
 * define las del backend arrastra medio Nest: no se pueden importar.
 *
 * El problema no era la copia, era el silencio. Si el backend añadía un
 * veredicto, el panel no se enteraba: la etiqueta salía vacía y la clase de
 * estilo era literalmente «undefined». Ni el compilador del backend, ni el del
 * panel, ni ninguna prueba decían nada — **es el sitio exacto donde las dos
 * puntas pueden divergir sin que nada falle**.
 *
 * Así que la divergencia falla aquí. Es la única punta desde la que se ven las
 * dos listas a la vez: una prueba del panel no puede mirar el backend, pero el
 * backend sí puede leer un fichero del repositorio. Y en el panel el tipo sale
 * de la lista, así que añadir un miembro allí rompe de paso la compilación de
 * todo lo que lo pinta.
 *
 * Si esta prueba falla, no la arregles cambiando el número: cambia la lista que
 * se quedó atrás, y mira las tablas que la usan.
 */
const FICHERO_DEL_PANEL = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'web',
  'src',
  'api',
  'client-users-bulk.api.ts',
);

/**
 * Los miembros de una lista `export const NOMBRE = [...] as const;` del panel.
 *
 * Se lee el texto y no se importa el módulo: ese fichero es TypeScript del
 * panel, con sus propios `import` de axios, y jest del backend no lo compila.
 */
function listaDelPanel(nombre: string): string[] {
  const fuente = readFileSync(FICHERO_DEL_PANEL, 'utf8');
  const encontrado = new RegExp(
    `export const ${nombre}\\s*(?::[^=]+)?=\\s*\\[([^\\]]*)\\]\\s*as const`,
  ).exec(fuente);

  if (!encontrado) {
    throw new Error(
      `El panel ya no declara «export const ${nombre} = [...] as const». ` +
        'O se renombró, o se volvió a escribir la unión a mano: en los dos casos, ' +
        'el cotejo que impide que las dos puntas diverjan deja de funcionar.',
    );
  }

  return [...encontrado[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('las enumeraciones de la carga masiva, en las dos puntas', () => {
  it('los veredictos del panel son exactamente los del backend, y en el mismo orden', () => {
    expect(listaDelPanel('BULK_ROW_VERDICTS')).toEqual([...BULK_ROW_VERDICTS]);
  });

  it('los resultados del envío del panel son exactamente los del backend', () => {
    expect(listaDelPanel('BULK_SEND_OUTCOMES')).toEqual([...BULK_SEND_OUTCOMES]);
  });

  it('el cotejo se nota si alguien se lleva la lista del panel a otro sitio', () => {
    expect(() => listaDelPanel('UNA_QUE_NO_EXISTE')).toThrow(/deja de funcionar/i);
  });
});
