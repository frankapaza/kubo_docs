import { Injectable, NotFoundException } from '@nestjs/common';
import { AIProvidersRepository } from './ai-providers.repository';
import { AIProvider } from './entities/ai-provider.entity';
import { CreateAIProviderDto } from './dto/create-ai-provider.dto';
import { UpdateAIProviderDto } from './dto/update-ai-provider.dto';
import { LLMService } from './llm.service';
import { decryptSecret, encryptSecret, maskSecret } from '../../common/crypto/aes-gcm.util';

export interface AIProviderView {
  id: number;
  provider: AIProvider['provider'];
  label: string;
  model: string;
  baseUrl: string | null;
  temperature: number;
  isActive: boolean;
  apiKeyPreview: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AIProvidersService {
  constructor(
    private readonly repo: AIProvidersRepository,
    private readonly llm: LLMService,
  ) {}

  list(): Promise<AIProvider[]> {
    return this.repo.findAll();
  }

  async listView(): Promise<AIProviderView[]> {
    const items = await this.repo.findAll();
    return items.map((p) => this.toView(p));
  }

  async create(userId: number, dto: CreateAIProviderDto): Promise<AIProviderView> {
    const created = await this.repo.create({
      provider: dto.provider,
      label: dto.label,
      model: dto.model,
      apiKeyEncrypted: encryptSecret(dto.apiKey),
      baseUrl: dto.baseUrl ?? null,
      temperature: dto.temperature ?? 0.3,
      isActive: 0,
      createdBy: userId,
    });
    return this.toView(created);
  }

  async update(id: number, dto: UpdateAIProviderDto): Promise<AIProviderView> {
    const p = await this.getOrFail(id);
    if (dto.label !== undefined) p.label = dto.label;
    if (dto.model !== undefined) p.model = dto.model;
    if (dto.baseUrl !== undefined) p.baseUrl = dto.baseUrl;
    if (dto.temperature !== undefined) p.temperature = dto.temperature;
    if (dto.apiKey !== undefined) p.apiKeyEncrypted = encryptSecret(dto.apiKey);
    const saved = await this.repo.save(p);
    return this.toView(saved);
  }

  async activate(id: number): Promise<AIProviderView> {
    await this.getOrFail(id);
    await this.repo.deactivateAll();
    await this.repo.setActive(id);
    const fresh = await this.getOrFail(id);
    return this.toView(fresh);
  }

  async remove(id: number): Promise<void> {
    await this.getOrFail(id);
    await this.repo.remove(id);
  }

  async testConnection(id: number): Promise<{ ok: true; sample: string }> {
    const p = await this.getOrFail(id);
    return this.llm.testConnection(p);
  }

  private async getOrFail(id: number): Promise<AIProvider> {
    const p = await this.repo.findById(id);
    if (!p) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Proveedor no encontrado' });
    }
    return p;
  }

  private toView(p: AIProvider): AIProviderView {
    let plain = '';
    try {
      plain = decryptSecret(p.apiKeyEncrypted);
    } catch {
      plain = '';
    }
    return {
      id: Number(p.id),
      provider: p.provider,
      label: p.label,
      model: p.model,
      baseUrl: p.baseUrl,
      temperature: Number(p.temperature),
      isActive: Boolean(p.isActive),
      apiKeyPreview: maskSecret(plain),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}
