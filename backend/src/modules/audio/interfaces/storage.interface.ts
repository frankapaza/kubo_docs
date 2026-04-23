/**
 * Abstracción de almacenamiento de archivos.
 * MVP: implementación local en FS.
 * TODO (sprint 5): implementación S3/MinIO (IStorageService → S3StorageService).
 */
export interface IStorageService {
  save(buffer: Buffer, key: string, mimeType: string): Promise<{ key: string; size: number }>;
  saveFromPath(
    sourcePath: string,
    key: string,
    mimeType: string,
  ): Promise<{ key: string; size: number }>;
  getPath(key: string): string;
  createReadStream(key: string): NodeJS.ReadableStream;
  remove(key: string): Promise<void>;
}

export const STORAGE_SERVICE = Symbol('IStorageService');
