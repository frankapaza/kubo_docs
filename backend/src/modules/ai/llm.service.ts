import { BadGatewayException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AIProvidersRepository } from './ai-providers.repository';
import { AIProvider, AIProviderKind } from './entities/ai-provider.entity';
import { decryptSecret } from '../../common/crypto/aes-gcm.util';
import { ActaDraftJson, ChatMessage, LLMCallConfig, LLMContext } from './llm.types';
import { getSystemPromptForMeetingType } from './meeting-prompts';

const DEFAULT_BASE_URL: Record<AIProviderKind, string> = {
  OPENAI: 'https://api.openai.com/v1',
  DEEPSEEK: 'https://api.deepseek.com/v1',
  GEMINI: 'https://generativelanguage.googleapis.com/v1beta',
  GROQ: 'https://api.groq.com/openai/v1',
};

@Injectable()
export class LLMService {
  private readonly logger = new Logger(LLMService.name);

  constructor(private readonly providers: AIProvidersRepository) {}

  async getActiveOrFail(): Promise<AIProvider> {
    const active = await this.providers.findActive();
    if (!active) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message:
          'No hay un proveedor de IA activo. Configúralo en Administración → IA.',
      });
    }
    return active;
  }

  async generateActaDraft(ctx: LLMContext): Promise<ActaDraftJson> {
    const provider = await this.getActiveOrFail();
    const config: LLMCallConfig = {
      apiKey: decryptSecret(provider.apiKeyEncrypted),
      model: provider.model,
      baseUrl: provider.baseUrl ?? DEFAULT_BASE_URL[provider.provider],
      temperature: Number(provider.temperature),
    };
    switch (provider.provider) {
      case 'OPENAI':
      case 'DEEPSEEK':
      case 'GROQ':
        return this.callOpenAICompatible(config, ctx);
      case 'GEMINI':
        return this.callGemini(config, ctx);
      default:
        throw new BadGatewayException({
          code: 'BAD_GATEWAY',
          message: `Proveedor ${provider.provider} no implementado`,
        });
    }
  }

  async chat(systemPrompt: string, messages: ChatMessage[]): Promise<string> {
    const provider = await this.getActiveOrFail();
    const config: LLMCallConfig = {
      apiKey: decryptSecret(provider.apiKeyEncrypted),
      model: provider.model,
      baseUrl: provider.baseUrl ?? DEFAULT_BASE_URL[provider.provider],
      temperature: Number(provider.temperature),
    };
    switch (provider.provider) {
      case 'OPENAI':
      case 'DEEPSEEK':
      case 'GROQ':
        return this.chatOpenAICompatible(config, systemPrompt, messages);
      case 'GEMINI':
        return this.chatGemini(config, systemPrompt, messages);
      default:
        throw new BadGatewayException({
          code: 'BAD_GATEWAY',
          message: `Proveedor ${provider.provider} no implementado`,
        });
    }
  }

  async testConnection(provider: AIProvider): Promise<{ ok: true; sample: string }> {
    const config: LLMCallConfig = {
      apiKey: decryptSecret(provider.apiKeyEncrypted),
      model: provider.model,
      baseUrl: provider.baseUrl ?? DEFAULT_BASE_URL[provider.provider],
      temperature: 0.1,
    };
    if (provider.provider === 'GEMINI') {
      const text = await this.pingGemini(config);
      return { ok: true, sample: text };
    }
    const text = await this.pingOpenAICompatible(config);
    return { ok: true, sample: text };
  }

  // =====================================================================
  //  OpenAI / DeepSeek / Groq (API compatible con OpenAI)
  // =====================================================================

  private async callOpenAICompatible(cfg: LLMCallConfig, ctx: LLMContext): Promise<ActaDraftJson> {
    const url = `${cfg.baseUrl}/chat/completions`;
    const body = {
      model: cfg.model,
      temperature: cfg.temperature,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: getSystemPromptForMeetingType(ctx.meetingType) },
        { role: 'user', content: this.userPrompt(ctx) },
      ],
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`LLM error ${res.status}: ${text.slice(0, 400)}`);
      throw new BadGatewayException({
        code: 'LLM_ERROR',
        message: `El proveedor respondió ${res.status}`,
      });
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new BadGatewayException({
        code: 'LLM_ERROR',
        message: 'Respuesta vacía del proveedor de IA',
      });
    }
    return this.parseDraft(content);
  }

  private async chatOpenAICompatible(
    cfg: LLMCallConfig,
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string> {
    const url = `${cfg.baseUrl}/chat/completions`;
    const body = {
      model: cfg.model,
      temperature: cfg.temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`LLM chat error ${res.status}: ${text.slice(0, 400)}`);
      throw new BadGatewayException({ code: 'LLM_ERROR', message: `El proveedor respondió ${res.status}` });
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new BadGatewayException({ code: 'LLM_ERROR', message: 'Respuesta vacía del proveedor de IA' });
    return content;
  }

  private async chatGemini(
    cfg: LLMCallConfig,
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string> {
    const url = `${cfg.baseUrl}/models/${cfg.model}:generateContent?key=${cfg.apiKey}`;
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const body = {
      systemInstruction: { role: 'user', parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { temperature: cfg.temperature },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`Gemini chat error ${res.status}: ${text.slice(0, 400)}`);
      throw new BadGatewayException({ code: 'LLM_ERROR', message: `El proveedor respondió ${res.status}` });
    }
    const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) throw new BadGatewayException({ code: 'LLM_ERROR', message: 'Respuesta vacía de Gemini' });
    return content;
  }

  private async pingOpenAICompatible(cfg: LLMCallConfig): Promise<string> {
    const url = `${cfg.baseUrl}/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        messages: [
          { role: 'system', content: 'Responde con una sola palabra: PONG' },
          { role: 'user', content: 'ping' },
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BadGatewayException({
        code: 'LLM_ERROR',
        message: `Error ${res.status}: ${text.slice(0, 200)}`,
      });
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? '(sin contenido)';
  }

  // =====================================================================
  //  Gemini (Google AI Studio)
  // =====================================================================

  private async callGemini(cfg: LLMCallConfig, ctx: LLMContext): Promise<ActaDraftJson> {
    const url = `${cfg.baseUrl}/models/${cfg.model}:generateContent?key=${cfg.apiKey}`;
    const body = {
      systemInstruction: { role: 'system', parts: [{ text: getSystemPromptForMeetingType(ctx.meetingType) }] },
      contents: [{ role: 'user', parts: [{ text: this.userPrompt(ctx) }] }],
      generationConfig: {
        temperature: cfg.temperature,
        responseMimeType: 'application/json',
      },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`Gemini error ${res.status}: ${text.slice(0, 400)}`);
      throw new BadGatewayException({
        code: 'LLM_ERROR',
        message: `El proveedor respondió ${res.status}`,
      });
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      throw new BadGatewayException({
        code: 'LLM_ERROR',
        message: 'Respuesta vacía de Gemini',
      });
    }
    return this.parseDraft(content);
  }

  private async pingGemini(cfg: LLMCallConfig): Promise<string> {
    const url = `${cfg.baseUrl}/models/${cfg.model}:generateContent?key=${cfg.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
        generationConfig: { temperature: 0 },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BadGatewayException({
        code: 'LLM_ERROR',
        message: `Error ${res.status}: ${text.slice(0, 200)}`,
      });
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '(sin contenido)';
  }

  // =====================================================================
  //  Prompts + parse
  // =====================================================================

  private userPrompt(ctx: LLMContext): string {
    const participantes = ctx.participants
      .map(
        (p) => `- ${p.fullName}${p.role ? ` (${p.role})` : ''}${p.attended ? ' [asistió]' : ''}`,
      )
      .join('\n');
    const agenda = ctx.agenda
      .map((a, i) => `${i + 1}. ${a.title}${a.description ? ` — ${a.description}` : ''}`)
      .join('\n');
    return [
      `Proyecto: ${ctx.projectName}`,
      `Reunión: ${ctx.meetingTitle}`,
      `Fecha y hora: ${ctx.scheduledAt}`,
      ctx.location ? `Ubicación: ${ctx.location}` : null,
      '',
      'Asistentes registrados:',
      participantes || '(ninguno)',
      '',
      'Agenda propuesta:',
      agenda || '(sin agenda previa)',
      '',
      'Transcripción de la reunión:',
      '"""',
      ctx.transcription || '(sin transcripción)',
      '"""',
      '',
      'Genera el acta en el formato JSON indicado.',
    ]
      .filter((l) => l !== null)
      .join('\n');
  }

  private parseDraft(raw: string): ActaDraftJson {
    const trimmed = raw.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new BadGatewayException({
        code: 'LLM_ERROR',
        message: 'El proveedor de IA devolvió un JSON inválido',
      });
    }
    const p = (parsed ?? {}) as Partial<ActaDraftJson>;
    return {
      resumen: typeof p.resumen === 'string' ? p.resumen : '',
      agenda: Array.isArray(p.agenda) ? p.agenda.filter((x) => typeof x === 'string') : [],
      desarrollo: typeof p.desarrollo === 'string' ? p.desarrollo : '',
      acuerdos: Array.isArray(p.acuerdos) ? p.acuerdos.filter((x) => typeof x === 'string') : [],
      tareas: Array.isArray(p.tareas)
        ? p.tareas
            .map((t) => {
              const o = (t ?? {}) as Partial<ActaDraftJson['tareas'][number]>;
              return {
                responsable: typeof o.responsable === 'string' ? o.responsable : '',
                descripcion: typeof o.descripcion === 'string' ? o.descripcion : '',
                fechaLimite: typeof o.fechaLimite === 'string' ? o.fechaLimite : null,
              };
            })
            .filter((t) => t.descripcion.length > 0)
        : [],
    };
  }
}
