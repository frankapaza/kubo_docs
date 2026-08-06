import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LocalStorageService } from './local-storage.service';

/**
 * `LocalStorageService` contra el sistema de ficheros de verdad, en un
 * directorio temporal.
 *
 * Sin dobles a propósito: lo que se comprueba aquí es exactamente que una clave
 * con `..` **no escribe fuera del directorio de subidas**, y eso es una
 * propiedad del `path` resuelto y del disco. Un `fs` simulado comprobaría que
 * el servicio llama a lo que el propio test decidió que llamaría.
 */
describe('LocalStorageService', () => {
  let raiz: string;
  let base: string;
  let storage: LocalStorageService;

  const cfg = (basePath: string): ConfigService =>
    ({ get: (_k: string, _d?: string) => basePath }) as unknown as ConfigService;

  beforeEach(() => {
    // Dos niveles: `raiz` es el terreno neutral y `base` el directorio de
    // subidas dentro de él. Hace falta que haya algo FUERA de la base y dentro
    // del temporal para que un escape se pueda observar sin ensuciar el disco.
    raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'kubo-storage-'));
    base = path.join(raiz, 'uploads');
    storage = new LocalStorageService(cfg(base));
  });

  afterEach(() => fs.rmSync(raiz, { recursive: true, force: true }));

  it('crea el directorio base si no existe', () => {
    expect(fs.existsSync(base)).toBe(true);
  });

  describe('el camino normal sigue funcionando', () => {
    it('guarda y vuelve a leer un archivo con una clave corriente', async () => {
      const contenido = Buffer.from('audio de prueba');

      const { key, size } = await storage.save(contenido, 'audio/2026/08/uno.m4a', 'audio/mp4');

      expect(key).toBe('audio/2026/08/uno.m4a');
      expect(size).toBe(contenido.byteLength);

      const destino = path.join(base, 'audio', '2026', '08', 'uno.m4a');
      expect(fs.readFileSync(destino).toString()).toBe('audio de prueba');
      expect(storage.getPath('audio/2026/08/uno.m4a')).toBe(destino);
    });

    it('createReadStream devuelve lo que guardó save', async () => {
      await storage.save(Buffer.from('contenido leído'), 'audio/dos.m4a', 'audio/mp4');

      const trozos: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        const stream = storage.createReadStream('audio/dos.m4a');
        stream.on('data', (c) => trozos.push(Buffer.from(c)));
        stream.on('end', () => resolve());
        stream.on('error', reject);
      });

      expect(Buffer.concat(trozos).toString()).toBe('contenido leído');
    });

    it('saveFromPath mueve el archivo de origen a la clave', async () => {
      const origen = path.join(raiz, 'temporal.m4a');
      fs.writeFileSync(origen, 'grabación');

      const { size } = await storage.saveFromPath(origen, 'audio/tres.m4a', 'audio/mp4');

      expect(size).toBe(Buffer.byteLength('grabación'));
      expect(fs.existsSync(origen)).toBe(false);
      expect(fs.readFileSync(path.join(base, 'audio', 'tres.m4a')).toString()).toBe('grabación');
    });

    it('remove borra el archivo y no se queja si ya no estaba', async () => {
      await storage.save(Buffer.from('x'), 'audio/cuatro.m4a', 'audio/mp4');

      await storage.remove('audio/cuatro.m4a');
      expect(fs.existsSync(path.join(base, 'audio', 'cuatro.m4a'))).toBe(false);

      await expect(storage.remove('audio/cuatro.m4a')).resolves.toBeUndefined();
    });
  });

  /**
   * La razón de ser del endurecimiento. Antes esto era un `path.join` pelado,
   * que resuelve los `..` sin protestar: la clave salía del directorio de
   * subidas y `save` escribía —y `remove` borraba— donde no debía.
   */
  describe('una clave no puede salirse del directorio base', () => {
    const escapes = [
      '../fuera.txt',
      '../../fuera.txt',
      'audio/../../fuera.txt',
      '/etc/passwd',
      // Resuelve al propio directorio base: no nombra ningún archivo, y
      // `remove` sobre él se llevaría por delante todas las subidas.
      '',
      '.',
      'audio/..',
    ];

    it.each(escapes)('getPath("%s") lanza en vez de devolver una ruta de fuera', (clave) => {
      expect(() => storage.getPath(clave)).toThrow(BadRequestException);
    });

    it('el error trae código en inglés y mensaje en español', () => {
      try {
        storage.getPath('../fuera.txt');
        throw new Error('tenía que haber lanzado');
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).getResponse()).toEqual({
          code: 'INVALID_STORAGE_KEY',
          message: 'La ruta del archivo no es válida.',
        });
      }
    });

    it('save no escribe nada fuera de la base', async () => {
      await expect(storage.save(Buffer.from('malo'), '../fuera.txt', 'text/plain')).rejects.toThrow(
        BadRequestException,
      );

      expect(fs.existsSync(path.join(raiz, 'fuera.txt'))).toBe(false);
    });

    it('remove no borra nada fuera de la base', async () => {
      const victima = path.join(raiz, 'no-tocar.txt');
      fs.writeFileSync(victima, 'sigo aquí');

      await expect(storage.remove('../no-tocar.txt')).rejects.toThrow(BadRequestException);

      expect(fs.readFileSync(victima).toString()).toBe('sigo aquí');
    });

    it('saveFromPath no mueve nada fuera de la base', async () => {
      const origen = path.join(raiz, 'temporal.m4a');
      fs.writeFileSync(origen, 'grabación');

      await expect(
        storage.saveFromPath(origen, '../robado.m4a', 'audio/mp4'),
      ).rejects.toThrow(BadRequestException);

      expect(fs.existsSync(path.join(raiz, 'robado.m4a'))).toBe(false);
      // Y el de origen sigue donde estaba: no se pierde por el camino.
      expect(fs.existsSync(origen)).toBe(true);
    });

    it('createReadStream no lee nada de fuera de la base', () => {
      fs.writeFileSync(path.join(raiz, 'secreto.txt'), 'secreto');

      expect(() => storage.createReadStream('../secreto.txt')).toThrow(BadRequestException);
    });

    /**
     * Un directorio hermano cuyo nombre empieza igual que la base. Comparar
     * prefijos sin el separador lo daría por dentro: `/tmp/x/uploads-otro`
     * empieza por `/tmp/x/uploads`.
     */
    it('un directorio hermano con el mismo prefijo no cuenta como dentro', () => {
      expect(() => storage.getPath('../uploads-otro/archivo.txt')).toThrow(BadRequestException);
    });
  });
});
