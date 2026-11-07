/**
 * ¿Es el error de MySQL por borrar una fila a la que otra tabla apunta con
 * una clave foránea RESTRICT (1451, `ER_ROW_IS_REFERENCED_2`)?
 *
 * TypeORM envuelve el error del driver en `QueryFailedError` y copia `errno`
 * y `code`, así que se mira en el propio objeto. Los servicios lo usan para
 * convertir ese caso en un 409 legible en vez de dejar que salga como 500.
 */
export function isForeignKeyRestrict(e: unknown): boolean {
  const err = e as { errno?: number; code?: string } | null;
  return err?.errno === 1451 || err?.code === 'ER_ROW_IS_REFERENCED_2' || err?.code === 'ER_ROW_IS_REFERENCED';
}

/**
 * ¿Es `ER_DUP_ENTRY` (1062)? Dos peticiones simultáneas pasaron la
 * comprobación previa y la clave única de la base decidió cuál gana.
 */
export function isDuplicateEntry(e: unknown): boolean {
  const err = e as { errno?: number; code?: string } | null;
  return err?.errno === 1062 || err?.code === 'ER_DUP_ENTRY';
}
