#!/usr/bin/env node
/**
 * Copia al backend el paquete puro `packages/monitoring-core/src`, que es la
 * única fuente de verdad de la lógica de sondeo (agenda, comprobaciones,
 * seguimiento de estado). La sonda (Delivery 2) y el backend deben ejecutar
 * exactamente el mismo código.
 *
 * Por qué una copia y no un `import` directo: el contexto de build de la
 * imagen del backend es `backend/`, sin acceso a `packages/`. La copia generada
 * se versiona y este script la mantiene al día:
 *
 *   node scripts/sync-monitoring-core.mjs            -> reescribe la copia
 *   node scripts/sync-monitoring-core.mjs --check    -> sale con 1 si difiere
 *
 * `--skip-if-missing` sale con 0 si no existe la fuente (build de la imagen).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(HERE, '..');
const SOURCE = resolve(BACKEND_ROOT, '../packages/monitoring-core/src');
const TARGET = resolve(BACKEND_ROOT, 'src/modules/availability/core');

const HEADER =
  '// GENERADO — no editar; fuente: packages/monitoring-core/src\n' +
  '// Regenerar con: node scripts/sync-monitoring-core.mjs\n\n';

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const skipIfMissing = args.has('--skip-if-missing');

if (!existsSync(SOURCE)) {
  if (skipIfMissing) {
    console.warn(`[monitoring-core] No se encuentra ${SOURCE}; se da por buena la copia ya generada.`);
    process.exit(0);
  }
  fail(`No se encuentra la fuente de verdad: ${SOURCE}`);
}

const files = listTs(SOURCE).sort();
if (files.length === 0) fail(`No hay ficheros .ts en ${SOURCE}.`);

/** @type {Map<string, string>} ruta relativa -> contenido generado */
const expected = new Map(
  files.map((rel) => [rel, HEADER + normalize(readFileSync(join(SOURCE, rel), 'utf8'))]),
);

if (checkOnly) {
  const problems = [];
  for (const [rel, content] of expected) {
    const target = join(TARGET, rel);
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (current === null) problems.push(`falta ${rel}`);
    else if (normalize(current) !== normalize(content)) problems.push(`difiere ${rel}`);
  }
  if (existsSync(TARGET)) {
    for (const rel of listTs(TARGET)) {
      if (!expected.has(rel)) problems.push(`sobra ${rel}`);
    }
  }
  if (problems.length > 0) {
    fail(
      `La copia de monitoring-core no coincide con la fuente (${problems.join(', ')}).\n` +
        'Ejecuta `node scripts/sync-monitoring-core.mjs` y revisa el resultado antes de compilar.',
    );
  }
  console.log('[monitoring-core] Copia al día con la fuente.');
  process.exit(0);
}

rmSync(TARGET, { recursive: true, force: true });
for (const [rel, content] of expected) {
  const target = join(TARGET, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
}
console.log(`[monitoring-core] Escritos ${expected.size} ficheros en ${TARGET}.`);

// ---------------------------------------------------------------------------

/** Rutas relativas (con `/`) de los .ts bajo `root`, recursivo. */
function listTs(root, prefix = '') {
  const out = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listTs(root, rel));
    else if (entry.name.endsWith('.ts')) out.push(rel);
  }
  return out;
}

/** Fin de línea LF y sin blancos finales: en Windows git puede convertir a CRLF. */
function normalize(text) {
  return text.replace(/\r\n/g, '\n').trimEnd() + '\n';
}

function fail(message) {
  console.error(`[monitoring-core] ${message}`);
  process.exit(1);
}
