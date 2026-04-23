import { Injectable } from '@nestjs/common';
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

  getPath(key: string): string {
    return path.join(this.basePath, key);
  }

  createReadStream(key: string): NodeJS.ReadableStream {
    return fs.createReadStream(this.getPath(key));
  }

  async remove(key: string): Promise<void> {
    await fs.promises.rm(this.getPath(key), { force: true });
  }
}
