import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { WorkItemsRepository } from '../work-items/work-items.repository';
import { WorkItemDocView, WorkItemDocumentsService } from '../work-items/work-item-documents.service';
import { MAX_CLIENT_DOCS_PER_ITEM } from '../work-items/domain/work-item-docs';
import { WorkItemStatus } from '../work-items/domain/work-item-board';

import { assertSessionScope } from './session-scope';

/** Lo único que el portal ve de un archivo. */
export interface PortalRequirementAttachmentView {
  id: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

/** Ya no se trabaja: adjuntar ahí no llegaría a nadie. */
const CLOSED: WorkItemStatus[] = ['CERRADO', 'CANCELADO', 'RECHAZADO'];

/**
 * Capturas, Word y PDF que el cliente adjunta a su requerimiento. Van a los
 * Documentos del requerimiento como `OTRO` con origen `CLIENTE`; el cliente
 * solo ve (y descarga) esos, nunca la Especificación, el Manual ni el Acta.
 *
 * `clientId` y `clientUserId` salen siempre del token, y el requerimiento se
 * busca con `findPortalRequirement`, que filtra por empresa y por origen
 * PORTAL en la consulta: uno ajeno da el mismo 404 que uno inexistente.
 */
@Injectable()
export class PortalRequirementAttachmentsService {
  constructor(
    private readonly repo: WorkItemsRepository,
    private readonly docs: WorkItemDocumentsService,
  ) {}

  async list(clientId: number, requirementId: number): Promise<PortalRequirementAttachmentView[]> {
    await this.requirementOrFail(clientId, requirementId);
    const rows = await this.docs.listBySource(requirementId, 'CLIENTE');
    return rows.map(toView);
  }

  async upload(
    clientUserId: number,
    clientId: number,
    requirementId: number,
    file: { buffer: Buffer; filename: string },
  ): Promise<PortalRequirementAttachmentView> {
    assertSessionScope(clientUserId, 'clientUserId', PortalRequirementAttachmentsService.name);
    const w = await this.requirementOrFail(clientId, requirementId);
    if (CLOSED.includes(w.status)) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'Este requerimiento ya está cerrado: no admite más archivos.',
      });
    }
    if ((await this.docs.countBySource(requirementId, 'CLIENTE')) >= MAX_CLIENT_DOCS_PER_ITEM) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: `Ya adjuntaste ${MAX_CLIENT_DOCS_PER_ITEM} archivos a este requerimiento, que es el máximo.`,
      });
    }
    const saved = await this.docs.upload({
      workItemId: requirementId,
      actorUserId: null,
      actorClientUserId: clientUserId,
      kind: 'OTRO',
      source: 'CLIENTE',
      status: 'VIGENTE',
      buffer: file.buffer,
      filename: file.filename,
    });
    return toView(saved);
  }

  async download(clientId: number, requirementId: number, docId: number) {
    await this.requirementOrFail(clientId, requirementId);
    const own = await this.docs.listBySource(requirementId, 'CLIENTE');
    if (!own.some((d) => d.id === docId)) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Archivo no encontrado' });
    }
    return this.docs.download(requirementId, docId);
  }

  private async requirementOrFail(clientId: number, requirementId: number) {
    assertSessionScope(clientId, 'clientId', PortalRequirementAttachmentsService.name);
    const w = await this.repo.findPortalRequirement(clientId, requirementId);
    if (!w) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Requerimiento no encontrado' });
    return w;
  }
}

function toView(d: WorkItemDocView): PortalRequirementAttachmentView {
  return { id: d.id, filename: d.filename, mimeType: d.mimeType, sizeBytes: d.sizeBytes, createdAt: d.createdAt };
}
