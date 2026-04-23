import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentSignatory } from './entities/document-signatory.entity';

@Injectable()
export class DocumentSignatoriesRepository {
  constructor(
    @InjectRepository(DocumentSignatory)
    private readonly orm: Repository<DocumentSignatory>,
  ) {}

  listByDocument(documentId: number): Promise<DocumentSignatory[]> {
    return this.orm.find({
      where: { documentId },
      order: { kind: 'ASC', createdAt: 'ASC' },
    });
  }

  findById(id: number): Promise<DocumentSignatory | null> {
    return this.orm.findOne({ where: { id } });
  }

  findByToken(token: string): Promise<DocumentSignatory | null> {
    return this.orm.findOne({ where: { signatureToken: token } });
  }

  create(data: Partial<DocumentSignatory>): Promise<DocumentSignatory> {
    return this.orm.save(this.orm.create(data));
  }

  async update(id: number, data: Partial<DocumentSignatory>): Promise<DocumentSignatory | null> {
    await this.orm.update(id, data);
    return this.findById(id);
  }

  async remove(id: number): Promise<void> {
    await this.orm.delete(id);
  }
}
