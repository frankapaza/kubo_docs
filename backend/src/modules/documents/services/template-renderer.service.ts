import { Injectable } from '@nestjs/common';

/**
 * Aplica reemplazo simple de `{{variable_key}}` sobre un template Markdown.
 * Si una variable no tiene valor, se reemplaza por string vacío.
 * Los valores se trimean. Los `null`/`undefined` se tratan como vacíos.
 */
@Injectable()
export class TemplateRendererService {
  render(
    template: string,
    values: Record<string, string | number | null | undefined>,
  ): string {
    return template.replace(/{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g, (_match, key) => {
      const raw = values[key];
      if (raw === undefined || raw === null) return '';
      return String(raw).trim();
    });
  }
}
