import { Injectable, NotFoundException } from '@nestjs/common';
import { promises as fsp } from 'fs';
import { join } from 'path';

export interface AppenderManifest {
  version: string;
  zip: string;
  sha256: string;
  manualMd: string;
  manualHtml: string;
  generatedAt: string;
}

/** Un nombre de fichero llano: sin separadores ni `..`, o no se sirve. */
const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Sirve el paquete del appender (zip y manuales) que Tarea 4 deja en
 * `assets/kubo-log-appender/` y el Dockerfile copia a la imagen.
 */
@Injectable()
export class AppenderPackageService {
  /** Se lee en cada llamada: así una prueba (o un despliegue) puede cambiarlo. */
  private dir(): string {
    return process.env.APPENDER_ASSETS_DIR || join(process.cwd(), 'assets', 'kubo-log-appender');
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'NOT_FOUND', message: 'El paquete del appender no está disponible' });
  }

  async manifest(): Promise<AppenderManifest> {
    let raw: string;
    try {
      raw = await fsp.readFile(join(this.dir(), 'manifest.json'), 'utf8');
    } catch {
      throw this.notFound();
    }
    try {
      return JSON.parse(raw) as AppenderManifest;
    } catch {
      throw this.notFound();
    }
  }

  /**
   * Un nombre del manifiesto se convierte en ruta: se exige nombre llano para
   * que un manifiesto manipulado (`../../etc/passwd`) no saque la lectura del
   * directorio de assets.
   */
  private resolve(name: unknown): string {
    if (typeof name !== 'string' || name.includes('..') || !PLAIN_NAME.test(name)) throw this.notFound();
    return join(this.dir(), name);
  }

  async packageFile(): Promise<{ path: string; filename: string }> {
    const m = await this.manifest();
    const path = this.resolve(m.zip);
    try {
      await fsp.access(path);
    } catch {
      throw this.notFound();
    }
    return { path, filename: m.zip };
  }

  async manual(): Promise<{ version: string; html: string; markdown: string }> {
    const m = await this.manifest();
    const htmlPath = this.resolve(m.manualHtml);
    const mdPath = this.resolve(m.manualMd);
    try {
      const [html, markdown] = await Promise.all([fsp.readFile(htmlPath, 'utf8'), fsp.readFile(mdPath, 'utf8')]);
      return { version: m.version, html, markdown };
    } catch {
      throw this.notFound();
    }
  }
}
