import { Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';

import { decryptSecret } from '../../common/crypto/aes-gcm.util';
import { TicketsRealtimeGateway } from '../tickets/tickets-realtime.gateway';
import { DevConnectorRepository } from './dev-connector.repository';
import { extractCodes } from './domain/code-refs';
import { verifyGithubSignature } from './domain/github-signature';
import { DevLinkKind } from './entities/dev-link.entity';

const HANDLED = new Set(['push', 'create', 'pull_request']);

const UNAUTHORIZED = { code: 'UNAUTHORIZED', message: 'Firma o repositorio no válidos.' } as const;

/** Algo del evento que puede nombrar un código y acabar como `dev_link`. */
interface Candidate {
  kind: DevLinkKind;
  ref: string;
  title: string | null;
  url: string | null;
  authorLogin: string | null;
  state: string | null;
  occurredAt: Date;
  /** El texto donde se buscan los códigos. */
  text: string;
}

// El cuerpo de GitHub es JSON externo: se lee con cuidado, sin confiar en su forma.
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Recibe los eventos de GitHub de los repos registrados y enlaza ramas,
 * commits y PR con los tickets/RQ que nombran **de la asignación del repo**.
 * Un código de otro cliente en un commit se ignora en silencio.
 */
@Injectable()
export class GithubWebhookService {
  private readonly logger = new Logger(GithubWebhookService.name);

  constructor(
    private readonly data: DevConnectorRepository,
    @Optional() private readonly realtime?: TicketsRealtimeGateway,
  ) {}

  async handle(event: string, raw: Buffer, signature: unknown, body: Json): Promise<{ linked: number; ignored?: true }> {
    const fullName = String(body?.repository?.full_name ?? '').toLowerCase();
    const repo = fullName ? await this.data.findRepoByFullName(fullName) : null;
    if (!repo || !Number(repo.isActive)) throw new UnauthorizedException({ ...UNAUTHORIZED });

    const enc = await this.data.findWebhookSecretEnc(Number(repo.id));
    let secret: string | null = null;
    try {
      secret = enc ? decryptSecret(enc) : null;
    } catch {
      secret = null;
    }
    if (!secret || !verifyGithubSignature(raw, secret, signature)) {
      throw new UnauthorizedException({ ...UNAUTHORIZED });
    }

    if (!HANDLED.has(event)) return { linked: 0, ignored: true };

    const candidates = this.candidates(event, body);
    const scope = Number(repo.clientSystemId);
    const cache = new Map<string, { ticketId: number | null; workItemId: number | null } | null>();
    let linked = 0;

    for (const c of candidates) {
      for (const code of extractCodes(c.text)) {
        if (!cache.has(code)) cache.set(code, await this.target(code, scope));
        const target = cache.get(code);
        if (!target) continue;
        await this.data.upsertLink({
          devRepoId: Number(repo.id),
          ...target,
          kind: c.kind,
          ref: c.ref,
          title: c.title,
          url: c.url,
          authorLogin: c.authorLogin,
          state: c.state,
          source: 'WEBHOOK',
          occurredAt: c.occurredAt,
        });
        linked++;
      }
    }

    if (linked > 0) {
      this.logger.log(`${fullName}: ${event} → ${linked} vínculo(s)`);
      this.realtime?.notifyChanged();
    }
    return { linked };
  }

  /** El ticket o RQ del código, solo si es de la asignación del repo. */
  private async target(code: string, clientSystemId: number) {
    if (code.startsWith('KB-')) {
      const t = await this.data.findTicketByCode(code);
      return t && Number(t.systemId) === clientSystemId ? { ticketId: Number(t.id), workItemId: null } : null;
    }
    const w = await this.data.findWorkItemByCode(code);
    return w && w.clientSystemId != null && Number(w.clientSystemId) === clientSystemId
      ? { ticketId: null, workItemId: Number(w.id) }
      : null;
  }

  private candidates(event: string, body: Json): Candidate[] {
    const now = new Date();
    const repoUrl = typeof body?.repository?.html_url === 'string' ? body.repository.html_url : null;

    if (event === 'create') {
      if (body?.ref_type !== 'branch' || typeof body?.ref !== 'string') return [];
      return [branch(body.ref, repoUrl, now)];
    }

    if (event === 'push') {
      if (body?.deleted || typeof body?.ref !== 'string' || !body.ref.startsWith('refs/heads/')) return [];
      const name = body.ref.slice('refs/heads/'.length);
      const out: Candidate[] = [branch(name, repoUrl, now)];
      const commits: Json[] = Array.isArray(body.commits) ? body.commits.slice(0, 100) : [];
      for (const c of commits) {
        if (typeof c?.id !== 'string') continue;
        const message = String(c.message ?? '');
        out.push({
          kind: 'COMMIT',
          ref: c.id,
          title: message.split('\n')[0].trim() || null,
          url: typeof c.url === 'string' ? c.url : null,
          authorLogin: c.author?.username ?? c.author?.name ?? null,
          state: null,
          occurredAt: date(c.timestamp, now),
          // Un commit en la rama de un ticket es de ese ticket aunque su mensaje no lo nombre.
          text: `${message}\n${name}`,
        });
      }
      return out;
    }

    // pull_request
    const pr = body?.pull_request;
    if (!pr || pr.number == null) return [];
    return [
      {
        kind: 'PR',
        ref: String(pr.number),
        title: typeof pr.title === 'string' ? pr.title : null,
        url: typeof pr.html_url === 'string' ? pr.html_url : null,
        authorLogin: pr.user?.login ?? null,
        state: pr.merged ? 'merged' : String(pr.state ?? 'open'),
        occurredAt: date(pr.updated_at, now),
        text: `${pr.title ?? ''}\n${pr.head?.ref ?? ''}`,
      },
    ];
  }
}

function branch(name: string, repoUrl: string | null, now: Date): Candidate {
  return {
    kind: 'BRANCH',
    ref: name,
    title: null,
    url: repoUrl ? `${repoUrl}/tree/${name}` : null,
    authorLogin: null,
    state: null,
    occurredAt: now,
    text: name,
  };
}

function date(v: unknown, fallback: Date): Date {
  const d = typeof v === 'string' ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : fallback;
}
