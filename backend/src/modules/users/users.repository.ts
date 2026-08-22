import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { withEncodedDomain } from '../inbound-email/domain/message-headers';

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
    return this.repo.save(this.repo.create(data));
  }

  update(id: number, data: Partial<User>): Promise<void> {
    return this.repo.update(id, data).then(() => undefined);
  }
}
