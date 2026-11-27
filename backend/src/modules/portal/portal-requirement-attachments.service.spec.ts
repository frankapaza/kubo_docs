import { BadRequestException, NotFoundException } from '@nestjs/common';

import { PortalRequirementAttachmentsService } from './portal-requirement-attachments.service';
import { MAX_CLIENT_DOCS_PER_ITEM } from '../work-items/domain/work-item-docs';

const doc = (over: Record<string, unknown> = {}) => ({
  id: 7,
  workItemId: 5,
  kind: 'OTRO',
  kindLabel: 'Otro',
  status: 'VIGENTE',
  source: 'CLIENTE',
  filename: 'captura.png',
  mimeType: 'image/png',
  sizeBytes: 1200,
  uploadedByUserId: null,
  uploadedByClientUserId: 3,
  approvedByUserId: null,
  approvedAt: null,
  createdAt: '2026-11-26T10:00:00.000Z',
  ...over,
});

function build(status = 'SOLICITADO') {
  const repo = {
    findPortalRequirement: jest.fn().mockResolvedValue({ id: 5, status }),
  };
  const docs = {
    listBySource: jest.fn().mockResolvedValue([doc()]),
    countBySource: jest.fn().mockResolvedValue(0),
    upload: jest.fn().mockResolvedValue(doc()),
    download: jest.fn().mockResolvedValue({ stream: 'S' }),
  };
  const service = new PortalRequirementAttachmentsService(repo as any, docs as any);
  return { service, repo, docs };
}

describe('PortalRequirementAttachmentsService', () => {
  it('sube el archivo como documento del cliente, con el autor del token', async () => {
    const { service, docs, repo } = build('FALTA_INFO');
    const out = await service.upload(3, 9, 5, { buffer: Buffer.from('x'), filename: 'captura.png' });

    expect(repo.findPortalRequirement).toHaveBeenCalledWith(9, 5);
    expect(docs.upload).toHaveBeenCalledWith({
      workItemId: 5,
      actorUserId: null,
      actorClientUserId: 3,
      kind: 'OTRO',
      source: 'CLIENTE',
      status: 'VIGENTE',
      buffer: Buffer.from('x'),
      filename: 'captura.png',
    });
    expect(out).toEqual({
      id: 7,
      filename: 'captura.png',
      mimeType: 'image/png',
      sizeBytes: 1200,
      createdAt: '2026-11-26T10:00:00.000Z',
    });
  });

  it('un requerimiento de otra empresa da 404 y no sube nada', async () => {
    const { service, docs, repo } = build();
    repo.findPortalRequirement.mockResolvedValue(null);
    await expect(service.upload(3, 9, 5, { buffer: Buffer.from('x'), filename: 'a.pdf' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(docs.upload).not.toHaveBeenCalled();
  });

  it.each(['CERRADO', 'CANCELADO', 'RECHAZADO'])('no admite adjuntos en un requerimiento %s', async (status) => {
    const { service, docs } = build(status);
    await expect(service.upload(3, 9, 5, { buffer: Buffer.from('x'), filename: 'a.pdf' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(docs.upload).not.toHaveBeenCalled();
  });

  it('corta al llegar al tope de archivos por requerimiento', async () => {
    const { service, docs } = build();
    docs.countBySource.mockResolvedValue(MAX_CLIENT_DOCS_PER_ITEM);
    await expect(service.upload(3, 9, 5, { buffer: Buffer.from('x'), filename: 'a.pdf' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(docs.upload).not.toHaveBeenCalled();
  });

  it('lista solo lo que subió el cliente, con la lista blanca de campos', async () => {
    const { service, docs } = build();
    const out = await service.list(9, 5);
    expect(docs.listBySource).toHaveBeenCalledWith(5, 'CLIENTE');
    expect(Object.keys(out[0]).sort()).toEqual(['createdAt', 'filename', 'id', 'mimeType', 'sizeBytes']);
  });

  it('descarga solo un archivo del cliente de ese requerimiento', async () => {
    const { service, docs } = build();
    await expect(service.download(9, 5, 7)).resolves.toEqual({ stream: 'S' });
    expect(docs.download).toHaveBeenCalledWith(5, 7);
  });

  it('un documento interno (Especificación, Manual) da 404 al cliente', async () => {
    const { service, docs } = build();
    await expect(service.download(9, 5, 99)).rejects.toBeInstanceOf(NotFoundException);
    expect(docs.download).not.toHaveBeenCalled();
  });
});
