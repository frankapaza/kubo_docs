import { NotFoundException } from '@nestjs/common';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { AppenderPackageService } from './appender-package.service';

describe('AppenderPackageService', () => {
  let dir: string;
  let saved: string | undefined;
  const svc = () => new AppenderPackageService();
  const manifest = (over: Record<string, unknown> = {}) =>
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({
        version: '1.2.3',
        zip: 'kubo-log-appender-1.2.3.zip',
        sha256: 'abc',
        manualMd: 'MANUAL.md',
        manualHtml: 'MANUAL.html',
        generatedAt: '2026-01-01T00:00:00Z',
        ...over,
      }),
    );

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'appender-'));
    saved = process.env.APPENDER_ASSETS_DIR;
    process.env.APPENDER_ASSETS_DIR = dir;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.APPENDER_ASSETS_DIR;
    else process.env.APPENDER_ASSETS_DIR = saved;
    rmSync(dir, { recursive: true, force: true });
  });

  it('sin manifest.json: 404 NOT_FOUND', async () => {
    await expect(svc().manifest()).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc().manifest()).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
  });

  it('con manifiesto, packageFile devuelve la ruta del zip nombrado', async () => {
    manifest();
    writeFileSync(join(dir, 'kubo-log-appender-1.2.3.zip'), 'zip');
    expect(await svc().packageFile()).toEqual({
      path: join(dir, 'kubo-log-appender-1.2.3.zip'),
      filename: 'kubo-log-appender-1.2.3.zip',
    });
  });

  it.each(['../secreto.zip', 'a/b.zip', 'a\\b.zip', '..', ''])(
    'un zip "%s" en el manifiesto: 404, no sale del directorio',
    async (zip) => {
      manifest({ zip });
      await expect(svc().packageFile()).rejects.toBeInstanceOf(NotFoundException);
    },
  );

  it('un zip que no existe en disco: 404', async () => {
    manifest();
    await expect(svc().packageFile()).rejects.toBeInstanceOf(NotFoundException);
  });

  it('manual devuelve el HTML y el Markdown', async () => {
    manifest();
    writeFileSync(join(dir, 'MANUAL.md'), '# md');
    writeFileSync(join(dir, 'MANUAL.html'), '<h1>html</h1>');
    expect(await svc().manual()).toEqual({ version: '1.2.3', html: '<h1>html</h1>', markdown: '# md' });
  });
});
