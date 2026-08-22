import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientUser } from './entities/client-user.entity';
import { withEncodedDomain } from '../inbound-email/domain/message-headers';

/**
 * Recorta, pone en minúsculas y codifica el dominio de un correo -- la misma
 * normalización, en el mismo orden, en los dos lados de cualquier
 * comparación por email. Función libre y no un método porque `findByEmail` y
 * `normalizeEmail` (más abajo) la comparten letra por letra.
 *
 * **Tanda de cierre: el dominio también se reescribe a su forma codificada
 * (`withEncodedDomain`, `inbound-email/domain/message-headers.ts`), no solo
 * el email entero a minúscula.** Antes de esto, `InboundEmailService` ya
 * normalizaba el `From` de un correo entrante a punycode antes de buscar al
 * cliente (`withNormalizedFrom`), pero ESTE repositorio -- el que de verdad
 * ejecuta la búsqueda, y al que también llega tráfico de otros orígenes
 * (login del portal, alta desde el panel) -- no lo hacía por su cuenta: la
 * garantía dependía de que ese único llamador recordara normalizar antes de
 * invocar. Un cliente dado de alta con un dominio internacionalizado escrito
 * en caracteres nacionales (`ana@пример.com`, tal como alguien lo copiaría de
 * un correo real) quedaba guardado así, sin más; cuando ese mismo cliente
 * escribía luego un correo, el remitente llegaba ya en su forma codificada
 * (`ana@xn--e1afmkfd.com`, la que en la práctica escribe cualquier MTA) y la
 * búsqueda nunca coincidía -- el cruce de dominios (que sí compara las dos
 * formas ya normalizadas) dejaba pasar al cliente, pero la búsqueda del
 * usuario, con sus propias reglas, seguía sin reconocerlo: en vez de
 * descartarse en silencio, ahora recibía la respuesta de "no te conocemos".
 * Normalizar aquí, en las dos direcciones (`create`/`update` al escribir,
 * `findByEmail` al leer), cierra la asimetría de forma estructural -- no
 * depende de que ningún llamador, presente o futuro, se acuerde de hacerlo
 * antes.
 */
function normalizeEmail(data: Partial<ClientUser>): Partial<ClientUser> {
  if (data.email === undefined) return data;
  return { ...data, email: withEncodedDomain(data.email.trim().toLowerCase()) };
}

@Injectable()
export class ClientUsersRepository {
  constructor(@InjectRepository(ClientUser) private readonly repo: Repository<ClientUser>) {}

  findByEmail(email: string): Promise<ClientUser | null> {
    return this.repo.findOne({ where: { email: withEncodedDomain(email.trim().toLowerCase()) } });
  }

  findById(id: number): Promise<ClientUser | null> {
    return this.repo.findOne({ where: { id } });
  }

  listByClient(clientId: number): Promise<ClientUser[]> {
    return this.repo.find({ where: { clientId }, order: { fullName: 'ASC' } });
  }

  create(data: Partial<ClientUser>): Promise<ClientUser> {
    return this.repo.save(this.repo.create(normalizeEmail(data)));
  }

  async update(id: number, data: Partial<ClientUser>): Promise<ClientUser | null> {
    await this.repo.update(id, normalizeEmail(data));
    return this.findById(id);
  }

  async touchLastLogin(id: number): Promise<void> {
    await this.repo.update(id, { lastLoginAt: new Date() });
  }
}
