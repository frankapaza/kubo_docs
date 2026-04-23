import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { DocumentTemplate } from './entities/document-template.entity';
import {
  CommercialDocument,
  CommercialDocumentStatus,
} from './entities/commercial-document.entity';

@Injectable()
export class DocumentsRepository {
  constructor(
    @InjectRepository(DocumentTemplate)
    private readonly templatesRepo: Repository<DocumentTemplate>,
    @InjectRepository(CommercialDocument)
    private readonly docsRepo: Repository<CommercialDocument>,
  ) {}

  listTemplates(onlyActive = true): Promise<DocumentTemplate[]> {
    const where: FindOptionsWhere<DocumentTemplate> = {};
    if (onlyActive) where.isActive = 1;
    return this.templatesRepo.find({ where, order: { updatedAt: 'DESC' } });
  }

  findTemplate(id: number): Promise<DocumentTemplate | null> {
    return this.templatesRepo.findOne({ where: { id } });
  }

  createTemplate(data: Partial<DocumentTemplate>): Promise<DocumentTemplate> {
    return this.templatesRepo.save(this.templatesRepo.create(data));
  }

  async updateTemplate(
    id: number,
    data: Partial<DocumentTemplate>,
  ): Promise<DocumentTemplate | null> {
    await this.templatesRepo.update(id, data);
    return this.findTemplate(id);
  }

  async removeTemplate(id: number): Promise<void> {
    await this.templatesRepo.delete(id);
  }

  listDocuments(params: {
    clientId?: number;
    status?: CommercialDocumentStatus;
  }): Promise<CommercialDocument[]> {
    const where: FindOptionsWhere<CommercialDocument> = {};
    if (params.clientId) where.clientId = params.clientId;
    if (params.status) where.status = params.status;
    return this.docsRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  findDocument(id: number): Promise<CommercialDocument | null> {
    return this.docsRepo.findOne({ where: { id } });
  }

  createDocument(data: Partial<CommercialDocument>): Promise<CommercialDocument> {
    return this.docsRepo.save(this.docsRepo.create(data));
  }

  async updateDocument(
    id: number,
    data: Partial<CommercialDocument>,
  ): Promise<CommercialDocument | null> {
    await this.docsRepo.update(id, data);
    return this.findDocument(id);
  }

  async removeDocument(id: number): Promise<void> {
    await this.docsRepo.delete(id);
  }
}
