import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { IStorageService } from '../interfaces/storage.interface';

@Injectable()
export class LocalStorageService implements IStorageService {
  private readonly basePath: string;

  constructor(cfg: ConfigService) {
    this.basePath = path.resolve(cfg.get<string>('STORAGE_LOCAL_PATH', './uploads'));
    if (!fs.existsSync(this.basePath)) fs.mkdirSync(this.basePath, { recursive: true });
  }

  async save(buffer: Buffer, key: string, _mime: string): Promise<{ key: string; size: number }> {
    const full = this.getPath(key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, buffer);
    return { key, size: buffer.byteLength };
  }

  async saveFromPath(
    sourcePath: string,
    key: string,
    _mime: string,
  ): Promise<{ key: string; size: number }> {
    const full = this.getPath(key);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    try {
      await fs.promises.rename(sourcePath, full);
    } catch (e: any) {
      if (e?.code !== 'EXDEV') throw e;
      await fs.promises.copyFile(sourcePath, full);
      await fs.promises.unlink(sourcePath);
    }
    const { size } = await fs.promises.stat(full);
    return { key, size };
  }

  /**
   * Ruta absoluta de una clave, **garantizando que cae dentro de `basePath`**.
   *
   * Antes era un `path.join` pelado, y `path.join` resuelve los `..` sin
   * quejarse: la clave `../../etc/passwd` daba una ruta fuera del directorio de
   * subidas. Todos los métodos de este servicio pasan por aquí, así que eso no
   * era solo leer — `save` escribía y `remove` borraba fuera.
   *
   * Mientras el único consumidor fue el módulo de audio la clave la generaba
   * siempre el servidor y no había por dónde entrar. Los adjuntos de tickets
   * añaden un segundo consumidor, y una de sus reglas —que el nombre que sube
   * el usuario no toque nunca el sistema de ficheros— se apoya en que esta
   * comprobación exista aquí abajo y no en cada llamador. Una defensa que hay
   * que acordarse de repetir es una defensa que un día falta.
   *
   * Se compara sobre la ruta **resuelta** (`path.resolve`), no sobre la cadena
   * de entrada: buscar `..` en el texto se esquiva con separadores mezclados o
   * segmentos raros, y resolver primero deja una sola forma canónica que
   * comparar. El separador del prefijo es lo que impide que `/uploads-otro`
   * pase por empezar igual que `/uploads`; y exigirlo rechaza también la clave
   * que resuelve al propio `basePath` (`''`, `.`, `subdir/..`), que no nombra
   * ningún archivo y sobre la que `remove` borraría el directorio entero.
   *
   * **El límite de esta guarda**, para quien se apoye en ella: compara rutas
   * resueltas, no reales. Un enlace simbólico que ya existiera **dentro** de
   * `basePath` apuntando fuera seguiría escapando, porque `path.resolve` no
   * sigue enlaces. Hoy no es alcanzable —nada crea enlaces ahí y las claves
   * las genera el servidor—, pero si alguna vez se acepta una clave que
   * nombre una entrada existente, esta comprobación no basta y hace falta
   * `fs.realpath`.
   */
  getPath(key: string): string {
    const full = path.resolve(this.basePath, key);

    if (!full.startsWith(this.basePath + path.sep)) {
      throw new BadRequestException({
        code: 'INVALID_STORAGE_KEY',
        message: 'La ruta del archivo no es válida.',
      });
    }

    return full;
  }

  createReadStream(key: string): NodeJS.ReadableStream {
    return fs.createReadStream(this.getPath(key));
  }

  async remove(key: string): Promise<void> {
    await fs.promises.rm(this.getPath(key), { force: true });
  }
}
