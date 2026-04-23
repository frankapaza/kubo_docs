import { Injectable, NotFoundException } from '@nestjs/common';
import { decryptSecret, encryptSecret } from '../../common/crypto/aes-gcm.util';
import { Integration } from './entities/integration.entity';
import { IntegrationsRepository } from './integrations.repository';
import { JiraService } from './jira.service';
import { CreateIntegrationDto } from './dto/create-integration.dto';

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly repo: IntegrationsRepository,
    private readonly jira: JiraService,
  ) {}

  listView(): Promise<Integration[]> {
    return this.repo.findAll();
  }

  async findByIdOrFail(id: number): Promise<Integration> {
    const i = await this.repo.findById(id);
    if (!i) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Integración no encontrada' });
    return i;
  }

  async create(userId: number, dto: CreateIntegrationDto): Promise<Integration> {
    return this.repo.create({
      provider: dto.provider,
      label: dto.label,
      workspaceUrl: dto.workspaceUrl.replace(/\/$/, ''),
      email: dto.email,
      apiTokenEncrypted: encryptSecret(dto.apiToken),
      isActive: 1,
      createdBy: userId,
    });
  }

  async remove(id: number): Promise<void> {
    await this.findByIdOrFail(id);
    return this.repo.remove(id);
  }

  async test(id: number): Promise<{ ok: true; displayName: string }> {
    const integration = await this.findByIdOrFail(id);
    return this.jira.testConnection({
      workspaceUrl: integration.workspaceUrl,
      email: integration.email,
      apiToken: decryptSecret(integration.apiTokenEncrypted),
    });
  }

  async listProjects(id: number): Promise<Array<{ key: string; name: string }>> {
    const integration = await this.findByIdOrFail(id);
    return this.jira.listProjects({
      workspaceUrl: integration.workspaceUrl,
      email: integration.email,
      apiToken: decryptSecret(integration.apiTokenEncrypted),
    });
  }

  getJiraAuth(integration: Integration) {
    return {
      workspaceUrl: integration.workspaceUrl,
      email: integration.email,
      apiToken: decryptSecret(integration.apiTokenEncrypted),
    };
  }
}
