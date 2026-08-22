import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { withEncodedDomain } from '../inbound-email/domain/message-headers';

/**
 * Recorta, pone en minúsculas y codifica el dominio de un correo -- la misma
 * normalización, en el mismo orden, que aplica `findByEmail` más abajo.
 * Función libre y no un método por el mismo motivo que
 * `ClientUsersRepository`: que la comparen letra por letra.
 *
 * **Corrección posterior a la tanda de cierre: el alta de personal guardaba
 * el correo tal cual, sin normalizar.** `ClientUsersRepository` sí se
 * corrigió en su momento (`create`/`update` normalizan antes de guardar),
 * pero este repositorio -- el que de verdad da de alta al personal -- se
 * quedó fuera: `findByEmail` ya normaliza el dominio a su forma codificada,
 * pero `create` guardaba el email exactamente como lo escribió quien lo dio
 * de alta. Un miembro del personal con un dominio internacionalizado
 * (`ana@пример.com`) quedaba guardado así, y su siguiente inicio de sesión
 * -- que sí normaliza para buscar -- nunca lo encontraba: fallaba siempre,
 * sin ningún error que lo explicara. Normalizar aquí, en las dos
 * direcciones (`create`/`update` al escribir, `findByEmail` al leer), cierra
 * la asimetría de forma estructural.
 */
function normalizeEmail(data: Partial<User>): Partial<User> {
  if (data.email === undefined) return data;
  return { ...data, email: withEncodedDomain(data.email.trim().toLowerCase()) };
}

@Injectable()
export class UsersRepository {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
  ) {}

  findById(id: number): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  listAll(): Promise<User[]> {
    return this.repo.find({ order: { id: 'ASC' } });
  }

  /**
   * Se recorta y se pasa a minúsculas antes de comparar, igual que
   * `ClientUsersRepository.findByEmail`: sin esto, que una búsqueda insensible
   * a mayúsculas encuentre al usuario correcto depende de la *collation* de la
   * columna en MySQL, y no del código -- un detalle de infraestructura que
   * nadie revisa cuando cambia. La ingesta de correo (`InboundEmailService`)
   * es quien más se apoya en esto: el remitente de un correo llega tal cual lo
   * escribió su cliente de correo, no como el usuario lo tecleó al registrarse.
   *
   * **Tanda de cierre: el dominio también se reescribe a su forma codificada**
   * (`withEncodedDomain`), mismo motivo y misma corrección que
   * `ClientUsersRepository.findByEmail` -- ver el comentario de esa función
   * para el escenario completo (un miembro del personal en un dominio
   * internacionalizado que el cruce de dominios ya deja pasar, pero que esta
   * búsqueda, sin normalizar, seguía sin reconocer).
   */
  findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({ where: { email: withEncodedDomain(email.trim().toLowerCase()) } });
  }

  create(data: Partial<User>): Promise<User> {
    return this.repo.save(this.repo.create(normalizeEmail(data)));
  }

  update(id: number, data: Partial<User>): Promise<void> {
    return this.repo.update(id, normalizeEmail(data)).then(() => undefined);
  }
}
