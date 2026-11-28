import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Los correos arman solo su contenido; el documento completo (logo, pie) lo pone
 * `wrapEmailLayout` en `EmailService.send`. Un `<!DOCTYPE>` en otro constructor
 * acabaría anidado dentro del marco (spec 2026-11-28-correos-html). Los colores
 * morados de antes tampoco vuelven.
 */
const MODULES = join(__dirname, '..');
const EMAIL_BUILDERS = [
  'documents/documents.service.ts',
  'document-signatories/document-signatories.service.ts',
  'portal/invitation-email.ts',
  'requirement-detail/requirement-detail.service.ts',
  'availability/agent-silence.watch.ts',
  'availability/probe-silence.watch.ts',
  'inbound-email/inbound-email.service.ts',
  'notifications/domain/email-compose.ts',
];

describe('constructores de correo: solo contenido, colores Kubo', () => {
  it.each(EMAIL_BUILDERS)('%s no arma un documento propio ni usa el morado anterior', (rel) => {
    const src = readFileSync(join(MODULES, rel), 'utf8');
    expect(src).not.toMatch(/<!DOCTYPE/i);
    expect(src).not.toMatch(/#4F46E5|#6366F1/i);
  });

  it.each([
    ['portal/invitation-email.ts', "emailButton(input.acceptUrl, 'Elegir mi contraseña')"],
    ['requirement-detail/requirement-detail.service.ts', "label: 'Completar en el portal'"],
    ['availability/agent-silence.watch.ts', "emailButton(link, 'Ver servidores')"],
    ['availability/probe-silence.watch.ts', "emailButton(link, 'Ver sondas')"],
    ['document-signatories/document-signatories.service.ts', "emailButton(signUrl, 'Revisar y firmar documento')"],
  ])('%s lleva su enlace principal como botón', (rel, uso) => {
    expect(readFileSync(join(MODULES, rel), 'utf8')).toContain(uso);
  });

  it('solo el marco común arma documentos completos', () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.endsWith('email-layout.ts') && /return `<!DOCTYPE html>/.test(readFileSync(p, 'utf8'))) found.push(p);
      }
    };
    walk(MODULES);
    expect(found.map((p) => p.split('\\').join('/').split('/modules/')[1])).toEqual([]);
  });
});
