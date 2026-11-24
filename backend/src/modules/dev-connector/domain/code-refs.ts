/** `KB-0210`, `rq-0045`… como palabra completa: `XKB-0001` o `KB-0001X` no cuentan. */
const CODE_REF = /(?<![A-Za-z0-9])(KB|RQ)-\d{4,}(?![A-Za-z0-9])/gi;

/** Los códigos que nombra un texto (rama, commit, título de PR), únicos y en mayúsculas. */
export function extractCodes(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const m of text.matchAll(CODE_REF)) found.add(m[0].toUpperCase());
  return [...found];
}
