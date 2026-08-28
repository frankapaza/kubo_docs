import { withEncodedDomain } from '../inbound-email/domain/message-headers';

/**
 * Recorta, pone en minúsculas y codifica el dominio de un correo.
 *
 * **La misma normalización, en el mismo orden, en los dos lados de cualquier
 * comparación por correo.** Vivía dentro de `client-users.repository.ts` como
 * función privada, y salió aquí cuando un segundo repositorio
 * (`client-user-invitations.repository.ts`) pasó a normalizar también: dos
 * copias serían dos reglas de identidad distintas, y la que alguien olvide
 * actualizar es la que deja entrar un duplicado con mayúsculas o un dominio
 * internacionalizado sin codificar. Mismo argumento que hace `sameId` en
 * `common/ids.ts` para la comparación de identificadores.
 *
 * El porqué de `withEncodedDomain` está entero en el docblock que dejó
 * `client-users.repository.ts`: un cliente dado de alta con `ana@пример.com`
 * nunca coincidía con el `ana@xn--e1afmkfd.com` que escribe cualquier MTA.
 */
export function normalizeEmailAddress(email: string): string {
  return withEncodedDomain(email.trim().toLowerCase());
}
