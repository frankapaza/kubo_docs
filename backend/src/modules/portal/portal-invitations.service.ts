import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { IsNull, Repository } from 'typeorm';

import { ClientUsersRepository } from './client-users.repository';
import { isDuplicateEntryError } from './client-users.service';
import { ClientUserInvitationsRepository } from './client-user-invitations.repository';
import { ClientUserInvitation } from './entities/client-user-invitation.entity';
import { ClientUser } from './entities/client-user.entity';
import { InvitePortalUserDto, PortalInvitationView } from './dto/portal-user.dto';
import { AcceptInvitationDto, InvitationPreviewView } from './dto/accept-invitation.dto';
import {
  fingerprintInvitationSecret,
  generateInvitationSecret,
  invitationExpiryFrom,
  isInvitationExpired,
  isWellFormedInvitationSecret,
} from './domain/invitation-secret';
import { assertSessionScope, toIso } from './session-scope';
import { normalizeEmailAddress } from './email-address';
import { sameId } from '../../common/ids';
import { ClientsService } from '../clients/clients.service';
import { EmailService } from '../email/email.service';
import { resolveClientRazonSocial } from './client-name';
import { buildInvitationEmail, buildInvitationUrl, resolveFrontendUrl } from './invitation-email';

/**
 * Mismo coste que el resto del portal (`ClientUsersService.BCRYPT_ROUNDS` y el
 * hash señuelo de `PortalAuthService`). No se inventa uno nuevo: un alta con
 * otro coste reabriría el canal de tiempos que ese señuelo existe para cerrar.
 */
const BCRYPT_ROUNDS = 10;

/**
 * Único cuerpo para CUALQUIER fallo al aceptar: no existe, caducada, ya usada,
 * revocada, quien invitó está desactivado, la empresa dejó de ser cliente, o
 * esa dirección ya es de un usuario que NO admite reinvitación (ver
 * `admiteReinvitacion`: el personal la dio de alta desde el panel mientras la
 * invitación seguía viva —el alta del panel no revoca invitaciones—, o es un
 * usuario activo, o es un administrador, o es de otra empresa).
 *
 * No se distinguen porque la diferencia solo le sirve a quien está probando
 * enlaces. Es la superficie más expuesta del producto —abierta a internet y sin
 * autenticar— y lo que da a cambio es una credencial.
 */
export const INVITATION_INVALID_MESSAGE =
  'El enlace no es válido o ha caducado. Pide a quien te invitó que te mande uno nuevo.';

/**
 * Único texto para cualquier motivo por el que no se puede invitar a una
 * dirección: ya es de un usuario de esta empresa, ya es de un usuario de otra,
 * o ya tiene una invitación viva en otra.
 *
 * Decisión 7 de la spec: distinguirlos convertiría el portal en un comprobador
 * de quiénes son nuestros clientes. La consecuencia conocida y aceptada es que
 * un administrador que se equivoque tecleando no sabrá exactamente por qué
 * falla — por eso el texto le dice qué hacer.
 */
export const INVITE_REJECTED_MESSAGE =
  'No se puede invitar a esa dirección. Revisa que esté bien escrita, ' +
  'o escríbenos si crees que debería poder entrar.';

/**
 * Si a esa dirección —que YA es de un usuario de cliente— se le puede volver a
 * invitar. Decisión 12 de la spec.
 *
 * Tres condiciones, y las tres:
 *
 *  1. **Desactivado.** A quien tiene acceso no se le reinvita: ya entra. Y una
 *     invitación aceptada por alguien activo le reescribiría la contraseña,
 *     que es justo lo que un compañero no debe poder hacerle.
 *  2. **No administrador.** Un administrador desactivado sigue necesitando a
 *     la casa, por coherencia con las decisiones 2 y 9 —el administrador de
 *     cliente no nombra administradores ni les quita el acceso—: si no puede
 *     quitárselo, tampoco puede devolvérselo por la puerta de la invitación.
 *  3. **De la propia empresa.** La frontera de siempre. El correo es único
 *     para TODO el sistema (`uq_client_users_email`), así que sin esta
 *     condición una empresa podría reactivar —y ponerle contraseña— a un
 *     usuario de otra.
 *
 * Quien la usa NO puede dejar que la respuesta delate cuál de las tres falló:
 * todos los caminos de rechazo salen por el cuerpo genérico de siempre
 * (`INVITE_REJECTED_MESSAGE` al invitar, `INVITATION_INVALID_MESSAGE` al
 * aceptar y en la vista previa).
 *
 * `isActive`/`isAdmin` llegan como `0`/`1` desde la fila cruda, no como
 * booleanos: por eso se leen como verdad y no con `=== false`. Y `sameId`, no
 * `===`, porque TypeORM devuelve `client_id` como cadena.
 */
export function admiteReinvitacion(usuario: ClientUser, clientId: number): boolean {
  return !usuario.isActive && !usuario.isAdmin && sameId(usuario.clientId, clientId);
}

@Injectable()
export class PortalInvitationsService {
  private readonly logger = new Logger(PortalInvitationsService.name);

  constructor(
    private readonly invitations: ClientUserInvitationsRepository,
    private readonly clientUsers: ClientUsersRepository,
    private readonly email: EmailService,
    private readonly clients: ClientsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Crea la invitación y manda el correo. **El secreto no sale de aquí ni de
   * `deliver`**: nace en `inviteWithSecret`, viaja a `deliver` por argumento y
   * muere en el cuerpo del correo. No se guarda, no se registra en ningún log
   * y no se devuelve por HTTP.
   */
  async invite(
    clientId: number,
    invitedByClientUserId: number,
    dto: InvitePortalUserDto,
  ): Promise<PortalInvitationView> {
    const { invitation, secret } = await this.inviteWithSecret(clientId, invitedByClientUserId, dto);
    return this.deliver(invitation, secret);
  }

  /**
   * El alta de verdad. Devuelve la vista **y** el secreto en claro, que existe
   * solo en esta variable y en el correo que sale: no se guarda, no se registra
   * en ningún log y no se devuelve por HTTP.
   */
  async inviteWithSecret(
    clientId: number,
    invitedByClientUserId: number,
    dto: InvitePortalUserDto,
  ): Promise<{ view: PortalInvitationView; secret: string; invitation: ClientUserInvitation }> {
    // Los dos, y antes de tocar la base: un clientId falsy haría desaparecer
    // el filtro de empresa, y un clientUserId falsy dejaría la invitación sin
    // autor real.
    assertSessionScope(clientId, 'clientId', PortalInvitationsService.name);
    assertSessionScope(invitedByClientUserId, 'clientUserId', PortalInvitationsService.name);

    const ahora = new Date();

    // El correo es único en `client_users` para TODO el sistema (ver la clave
    // `uq_client_users_email` de la 013), así que esta comprobación es global
    // a propósito: si la dirección ya es de alguien, da igual de qué empresa.
    //
    // La ÚNICA excepción es la reinvitación de la decisión 12: un usuario
    // desactivado, no administrador y de esta misma empresa se puede volver a
    // invitar, y aceptar lo reactiva en vez de crear otra fila. Todo lo demás
    // —activo, administrador, o de otra empresa— sale por el mismo cuerpo
    // genérico de siempre, sin decir cuál de los tres fue.
    const yaEsUsuario = await this.clientUsers.findByEmail(dto.email);
    if (yaEsUsuario && !admiteReinvitacion(yaEsUsuario, clientId)) throw invitacionRechazada();

    const viva = await this.invitations.findLiveByEmail(dto.email, ahora);
    if (viva && !sameId(viva.clientId, clientId)) {
      // Viva en OTRA empresa: se rechaza y no se le toca la suya. Anularla
      // sería un efecto cruzado entre empresas, aunque no revele nada.
      throw invitacionRechazada();
    }

    const secret = generateInvitationSecret();
    // Viva en la propia: se reemplaza. Primero revocar y después crear —al
    // revés, durante un instante habría dos vivas y la revocación se llevaría
    // por delante la recién creada— y las dos EN LA MISMA TRANSACCIÓN: sin
    // ella, un fallo al crear después de revocar dejaría al invitado sin
    // ningún enlace vivo aunque la petición devolvió error. Ver
    // `replaceInvitation`.
    const invitation = await this.replaceInvitation({
      clientId,
      email: dto.email,
      fullName: dto.fullName.trim(),
      secretFingerprint: fingerprintInvitationSecret(secret),
      invitedByClientUserId,
      expiresAt: invitationExpiryFrom(ahora),
      revokeVivaAt: viva ? ahora : undefined,
    });

    // Campo a campo, y sin ningún campo de rol: no hay por dónde colar un
    // `isAdmin` que llegara en el cuerpo, porque este objeto no lo tiene.
    return { view: toInvitationView(invitation), secret, invitation };
  }

  async listPending(clientId: number): Promise<PortalInvitationView[]> {
    assertSessionScope(clientId, 'clientId', PortalInvitationsService.name);
    const filas = await this.invitations.listPendingByClient(clientId, new Date());
    return filas.map(toInvitationView);
  }

  /**
   * Vuelve a mandar una invitación pendiente, **con un secreto nuevo**.
   *
   * No se puede reenviar el anterior: solo tenemos su huella, y ese es
   * exactamente el punto de guardar solo la huella. Emitir uno nuevo y revocar
   * el viejo tiene además la propiedad correcta — un enlace que se filtró por
   * el camino deja de servir en cuanto alguien reenvía.
   */
  async resend(clientId: number, invitationId: number): Promise<PortalInvitationView> {
    assertSessionScope(clientId, 'clientId', PortalInvitationsService.name);

    const previa = await this.invitations.findPendingByIdForClient(invitationId, clientId);
    // Una invitación de otra empresa y una que no existe dan esta misma
    // respuesta: 404 y nunca 403.
    if (!previa) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Invitación no encontrada' });
    }

    const ahora = new Date();
    const secret = generateInvitationSecret();
    // Misma disciplina de atomicidad que `inviteWithSecret`: revocar y crear
    // en una única transacción.
    const invitation = await this.replaceInvitation({
      clientId,
      email: previa.email,
      fullName: previa.fullName,
      secretFingerprint: fingerprintInvitationSecret(secret),
      // Se conserva quién invitó originalmente. Atribuírselo a quien pulsa
      // «reenviar» sería reescribir un hecho pasado.
      invitedByClientUserId: Number(previa.invitedByClientUserId),
      expiresAt: invitationExpiryFrom(ahora),
      revokeVivaAt: ahora,
    });

    return this.deliver(invitation, secret);
  }

  /**
   * Revoca la invitación viva de esa dirección **dentro de esta empresa** (si
   * `revokeVivaAt` viene informado) y crea la nueva, **en una única
   * transacción**: o quedan las dos escrituras, o ninguna.
   *
   * Sin esto eran dos escrituras sueltas con el repositorio inyectado. Si la
   * creación fallaba después de revocar, el invitado se quedaba sin ningún
   * enlace vivo aunque la petición hubiera devuelto error — y no hay ninguna
   * restricción en base que impida dos invitaciones vivas al mismo correo: la
   * invariante «un correo, una invitación viva» descansa entera en este
   * leer-y-escribir.
   *
   * `manager.getRepository(...)`, **jamás el repositorio inyectado**: fuera de
   * la transacción se ejecutaría igual, pero sin ninguna posibilidad de
   * deshacerse si el paso siguiente falla. Mismo criterio que `accept`.
   */
  private async replaceInvitation(params: {
    clientId: number;
    email: string;
    fullName: string;
    secretFingerprint: string;
    invitedByClientUserId: number;
    expiresAt: Date;
    /** Presente si hay que revocar la viva de esta empresa antes de crear. */
    revokeVivaAt?: Date;
  }): Promise<ClientUserInvitation> {
    return this.invitations.runInTransaction(async (manager) => {
      const invRepo = manager.getRepository(ClientUserInvitation);
      const email = normalizeEmailAddress(params.email);

      if (params.revokeVivaAt) {
        await invRepo.update(
          { email, clientId: params.clientId, usedAt: IsNull(), revokedAt: IsNull() },
          { revokedAt: params.revokeVivaAt },
        );
      }

      return invRepo.save(
        invRepo.create({
          clientId: params.clientId,
          email,
          fullName: params.fullName,
          // La huella, jamás el secreto.
          secretFingerprint: params.secretFingerprint,
          invitedByClientUserId: params.invitedByClientUserId,
          expiresAt: params.expiresAt,
        }),
      );
    });
  }

  /**
   * Convierte una invitación en un usuario. **Una sola transacción**: o quedan
   * el usuario creado y la invitación consumida, o no queda nada.
   *
   * No inicia sesión: devuelve el correo con el que la persona tiene que
   * entrar, y la pantalla la manda al login. Es el paso 6 del recorrido de la
   * spec, y evita que esta ruta pública emita tokens.
   */
  async accept(dto: AcceptInvitationDto): Promise<{ email: string }> {
    // ANTES de tocar nada: si las dos contraseñas no coinciden, eso se dice y
    // punto. Comprobarlo después del enlace convertiría el par
    // "error de validación" / "cuerpo genérico" en un oráculo de si el enlace
    // vale.
    if (dto.password !== dto.passwordConfirmation) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Las dos contraseñas no coinciden.',
      });
    }

    // La forma del secreto, con la MISMA regla que la vista previa (ver
    // `isWellFormedInvitationSecret`) y con el cuerpo genérico de siempre: una
    // cadena que ni siquiera tiene la forma de un secreto no puede casar con
    // ninguna huella, así que responder distinto solo abriría otro oráculo.
    // Va DESPUÉS de la confirmación de contraseña, para no alterar el orden
    // que impide usar ese par de respuestas como oráculo del enlace.
    if (!isWellFormedInvitationSecret(dto.secret)) throw enlaceNoValido();

    const huella = fingerprintInvitationSecret(dto.secret);
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const ahora = new Date();

    return this.invitations.runInTransaction(async (manager) => {
      const invRepo = manager.getRepository(ClientUserInvitation);
      const userRepo = manager.getRepository(ClientUser);

      // Se busca POR HUELLA, nunca por el secreto: el secreto no está en la
      // base y no puede estarlo. El bloqueo de escritura es lo que cierra la
      // carrera de dos aceptaciones simultáneas del mismo enlace.
      const inv = await invRepo.findOne({
        where: { secretFingerprint: huella },
        lock: { mode: 'pessimistic_write' },
      });

      if (!inv) throw enlaceNoValido();
      if (inv.usedAt || inv.revokedAt) throw enlaceNoValido();
      // Contra un instante absoluto, nunca contra una fecha civil derivada de
      // la zona del proceso: producción corre en UTC y el desarrollo en Lima.
      if (isInvitationExpired(inv.expiresAt, ahora)) throw enlaceNoValido();

      // Se invalida sola si quien invitó quedó desactivado, o si la empresa
      // dejó de ser cliente. Se comprueba AQUÍ, al aceptar, no por un proceso
      // aparte que podría no haber corrido todavía.
      const invitador = await this.clientUsers.findById(Number(inv.invitedByClientUserId));
      if (!invitador || !invitador.isActive) throw enlaceNoValido();

      // Solo el "no existe" degrada a enlace no válido. Cualquier otro fallo
      // —la base caída, por ejemplo— sigue subiendo: silenciarlo lo disfrazaría
      // de "invitación mala" y perdería el 500 que de verdad es. Mismo criterio
      // que `resolveClientRazonSocial` en `client-name.ts`.
      const empresa = await this.clients.findByIdOrFail(Number(inv.clientId)).catch((err) => {
        if (err instanceof NotFoundException) return null;
        throw err;
      });
      // `FORMER_CLIENT` es lo que este producto llama "empresa desactivada"
      // (decisión 1 de la spec): `clients` no tiene `is_active`, tiene
      // `status` (ver `client.entity.ts`). Un prospecto (`PROSPECT`) NO es
      // una empresa desactivada: puede aceptar su invitación igual que un
      // cliente activo.
      if (!empresa || empresa.status === 'FORMER_CLIENT') throw enlaceNoValido();

      // SÉPTIMO motivo de invalidez. El alta de un usuario de cliente desde
      // el panel (`ClientUsersService.create`) NO revoca las invitaciones
      // vivas de esa dirección, así que la invitación sobrevive a que el
      // correo ya tenga dueño. Sin esta comprobación, aceptar chocaba contra
      // `uq_client_users_email` y salía un 500 distinguible del 400 uniforme
      // —un oráculo—, además de dejar esa invitación inaceptable para siempre,
      // porque el choque se repite en cada intento.
      //
      // La excepción es la reinvitación de la decisión 12, y se decide con la
      // MISMA función que la usó al invitar: un desactivado, no administrador
      // y de la empresa de la invitación no invalida el enlace — se reactiva
      // más abajo. Cualquier otro caso sigue siendo el séptimo motivo, con el
      // cuerpo único de siempre.
      const yaEsUsuario = await this.clientUsers.findByEmail(inv.email);
      const reactivable = yaEsUsuario && admiteReinvitacion(yaEsUsuario, Number(inv.clientId));
      if (yaEsUsuario && !reactivable) throw enlaceNoValido();

      // La comprobación de arriba cubre el caso normal; el `saveOrInvalid` de
      // más abajo es la red de la carrera, igual que en
      // `ClientUsersService.create`: dos altas de la misma dirección —una por
      // el panel, otra por aquí— pueden pasar las dos por la lectura antes de
      // que cualquiera escriba.
      const nuevo = userRepo.create({
        // Todo sale de la invitación. Nada del cuerpo.
        clientId: Number(inv.clientId),
        email: inv.email,
        passwordHash,
        fullName: inv.fullName,
        // Literal, no un valor calculado ni leído de ningún sitio: desde el
        // portal no se puede nombrar a un administrador, y este `0` es el
        // sitio donde eso se hace verdad.
        isAdmin: 0,
        isActive: 1,
        // Autoría honesta: no hubo personal, hubo un administrador de cliente.
        createdBy: null,
        createdByClientUserId: Number(inv.invitedByClientUserId),
      });

      /*
       * Decisión 12 de la spec: reactivar, NO crear otra fila. Crear chocaría
       * contra `uq_client_users_email` —el correo es único para todo el
       * sistema— y, aunque no chocara, partiría en dos la historia de esa
       * persona: sus tickets y sus mensajes cuelgan de la fila que ya existe,
       * que es exactamente lo que la decisión 4 («desactivar, no borrar»)
       * existe para conservar.
       *
       * Se escribe con el `userRepo` de la transacción, nunca con el
       * repositorio inyectado: si el marcado de la invitación fallara después,
       * la reactivación tiene que deshacerse con él. Mismo criterio que el
       * alta.
       *
       * Qué se toca y qué no:
       *  - contraseña y nombre, los de esta invitación: la persona vuelve con
       *    la contraseña que acaba de elegir y con el nombre con el que la han
       *    invitado ahora (puede haberse casado, o estar mal escrito el de
       *    entonces).
       *  - `isActive` a 1, que es el sentido entero de la operación.
       *  - `isAdmin` NO se toca, y no hace falta: `admiteReinvitacion` ya ha
       *    exigido que sea 0. Escribirlo aquí sería un segundo sitio donde
       *    decidir el rol desde el portal.
       *  - la autoría —`createdBy` / `createdByClientUserId`— tampoco: quién
       *    creó a esta persona es un hecho pasado, y reactivar no es crear.
       *    Reescribirlo sería la misma mentira que la decisión 8 prohíbe.
       */
      const usuario = reactivable
        ? await reactivar(userRepo, yaEsUsuario, { passwordHash, fullName: inv.fullName })
        : await saveOrInvalid(() => userRepo.save(nuevo));

      // El `usedAt: IsNull()` del WHERE es la otra mitad del uso único: si otra
      // petición se adelantó, este UPDATE no afecta a ninguna fila y hay que
      // reventar para que el usuario recién creado no sobreviva al commit.
      const marcado = await invRepo.update(
        { id: inv.id, usedAt: IsNull() },
        { usedAt: ahora, acceptedClientUserId: Number(usuario.id) },
      );
      if (marcado.affected !== 1) throw enlaceNoValido();

      return { email: inv.email };
    });
  }

  /**
   * Lo que ve la pantalla de aceptar ANTES de pedir contraseña. Decisión 10
   * de la spec: la página saluda, no es un formulario a ciegas.
   *
   * **No consume la invitación ni la modifica de ninguna forma**: es una
   * lectura simple por huella, sin transacción y sin bloqueo — a propósito,
   * porque bloquear aquí competiría sin ninguna necesidad con la transacción
   * de `accept`, dado que esta ruta nunca escribe.
   *
   * Los mismos SIETE motivos que invalidan el enlace al aceptar (no existe,
   * caducada, ya usada, revocada, quien invitó está desactivado, la empresa
   * dejó de ser cliente, la dirección ya es de un usuario) dan aquí
   * EXACTAMENTE el mismo cuerpo que `accept`: reutiliza `enlaceNoValido()`
   * para no arriesgar una redacción distinta que delate cuál de los siete
   * ocurrió.
   *
   * Los siete, y no seis: si esta ruta saludara ante un motivo que `accept`
   * rechaza, la diferencia entre las dos respuestas delataría ese motivo
   * igual de bien que un texto distinto.
   */
  async preview(secret: string): Promise<InvitationPreviewView> {
    // La misma disciplina que aceptar para el mismo valor, y con el mismo
    // cuerpo. Aquí el secreto llega por la RUTA, así que no hay DTO ni
    // `ValidationPipe` que lo mire: sin esta línea, la vista previa era la
    // única de las dos que no comprobaba nada de la forma del secreto.
    if (!isWellFormedInvitationSecret(secret)) throw enlaceNoValido();

    const huella = fingerprintInvitationSecret(secret);
    const inv = await this.invitations.findByFingerprint(huella);

    if (!inv) throw enlaceNoValido();
    if (inv.usedAt || inv.revokedAt) throw enlaceNoValido();
    if (isInvitationExpired(inv.expiresAt, new Date())) throw enlaceNoValido();

    const invitador = await this.clientUsers.findById(Number(inv.invitedByClientUserId));
    if (!invitador || !invitador.isActive) throw enlaceNoValido();

    // `FORMER_CLIENT` es lo único que este producto llama "empresa
    // desactivada" (decisión 1 de la spec): un prospecto (`PROSPECT`) puede
    // tener una invitación válida igual que un cliente activo.
    const empresa = await this.clients.findByIdOrFail(Number(inv.clientId)).catch((err) => {
      if (err instanceof NotFoundException) return null;
      throw err;
    });
    if (!empresa || empresa.status === 'FORMER_CLIENT') throw enlaceNoValido();

    // El séptimo, el mismo que `accept` y con la MISMA excepción: la dirección
    // ya tiene dueño porque el personal la dio de alta desde el panel mientras
    // la invitación seguía viva —salvo que sea una reinvitación válida
    // (decisión 12), que aceptar sí admite—. Saludar aquí y fallar al aceptar,
    // o al revés, sería justo la divergencia que el cuerpo único existe para
    // negar: por eso la condición se decide con `admiteReinvitacion`, la misma
    // función que usa aceptar, y no con una copia de sus tres reglas.
    const yaEsUsuario = await this.clientUsers.findByEmail(inv.email);
    if (yaEsUsuario && !admiteReinvitacion(yaEsUsuario, Number(inv.clientId))) {
      throw enlaceNoValido();
    }

    return {
      fullName: inv.fullName,
      // La razón social sale de la empresa que ya se leyó unas líneas arriba,
      // no de una segunda consulta con `resolveClientRazonSocial`: el dato ya
      // está en la mano, y volver a pedirlo solo añadía un viaje a la base en
      // una ruta pública sin autenticar.
      clientName: empresa.razonSocial,
    };
  }

  /**
   * Manda el correo y deja constancia del intento.
   *
   * **El fallo del envío no tumba la petición.** Decisión 6 de la spec: la
   * invitación queda creada aunque el correo falle, y la pantalla ofrece
   * reenviar. Propagar aquí el error dejaría al administrador creyendo que no
   * se creó nada cuando sí se creó, y le haría invitar otra vez —revocando la
   * que sí existía— en un bucle sin salida.
   */
  private async deliver(
    invitation: ClientUserInvitation,
    secret: string,
  ): Promise<PortalInvitationView> {
    const acceptUrl = buildInvitationUrl(resolveFrontendUrl(this.config), secret);
    const clientName = await resolveClientRazonSocial(this.clients, Number(invitation.clientId));
    const { subject, html, text } = buildInvitationEmail({
      fullName: invitation.fullName,
      clientName,
      acceptUrl,
      expiresAt: invitation.expiresAt,
    });

    const ahora = new Date();
    try {
      await this.email.send({ to: invitation.email, subject, html, text });
      await this.invitations.markSent(Number(invitation.id), ahora, null);
      return toInvitationView({ ...invitation, lastSentAt: ahora, sendError: null });
    } catch (err) {
      // `describeSendError` y no `(err as Error).message`: un transporte que
      // rechazara con algo que no es un `Error` —una cadena, un `undefined`—
      // haría reventar el propio catch al leer `.message` de eso, y ese fallo
      // no lo recoge nadie: la petición saldría con un 500, que es lo
      // contrario exacto de lo que promete el comentario de arriba. Hoy
      // nodemailer siempre rechaza con `Error`, pero nada en este código lo
      // fija, y lo que sostiene la promesa tiene que ser el código.
      const detalle = describeSendError(err);
      const motivo = detalle.slice(0, 500);
      // Al log entero, a la base recortado, y a la respuesta NUNCA: el detalle
      // de por qué rechazó el servidor SMTP es diagnóstico interno. El secreto
      // tampoco entra aquí: `motivo` sale del error del transporte, jamás de
      // `acceptUrl`.
      this.logger.error(`No se pudo enviar la invitación ${String(invitation.id)}: ${detalle}`);
      await this.invitations.markSent(Number(invitation.id), ahora, motivo);
      return toInvitationView({ ...invitation, lastSentAt: ahora, sendError: motivo });
    }
  }
}

/**
 * Ejecuta la escritura del usuario y traduce SOLO el choque contra
 * `uq_client_users_email` al cuerpo uniforme de enlace no válido.
 *
 * Cualquier otro fallo de escritura —la base caída, una columna que no
 * encaja— sigue subiendo tal cual: degradarlo lo disfrazaría de "invitación
 * mala" y perdería el 500 que de verdad es. Mismo criterio que
 * `ClientUsersService.create`, y se reutiliza su `isDuplicateEntryError` en
 * vez de escribir una segunda detección del mismo código de driver.
 */
/**
 * Devuelve el acceso a un usuario desactivado con la contraseña y el nombre de
 * esta invitación. Decisión 12 de la spec.
 *
 * `update` por id y no `save` de la entidad entera: `save` con la fila leída
 * reescribiría de paso todas las demás columnas tal como estaban al leerlas
 * —incluida `isAdmin`—, y ese es justo el sitio por donde se cuela un rol
 * decidido desde el portal. Aquí se nombran las tres columnas que cambian y
 * ninguna más.
 *
 * Devuelve el id de la fila que ya existía: es el que se anota como
 * `accepted_client_user_id` en la invitación, para que quede escrito quién
 * consumió el enlace.
 */
async function reactivar(
  userRepo: Repository<ClientUser>,
  usuario: ClientUser,
  datos: { passwordHash: string; fullName: string },
): Promise<{ id: number }> {
  const id = Number(usuario.id);
  await userRepo.update(id, {
    passwordHash: datos.passwordHash,
    fullName: datos.fullName,
    isActive: 1,
  });
  return { id };
}

async function saveOrInvalid<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (isDuplicateEntryError(err)) throw enlaceNoValido();
    throw err;
  }
}

/**
 * El motivo del fallo de envío, en texto, venga lo que venga del transporte.
 *
 * No se asume que sea un `Error`: este valor se lee DENTRO del catch que
 * existe para que el fallo del correo no tumbe la petición, y una excepción
 * ahí no la recoge nadie.
 */
function describeSendError(err: unknown): string {
  if (err instanceof Error && typeof err.message === 'string') return err.message;
  return String(err);
}

function invitacionRechazada(): BadRequestException {
  return new BadRequestException({
    code: 'INVITACION_RECHAZADA',
    message: INVITE_REJECTED_MESSAGE,
  });
}

function enlaceNoValido(): BadRequestException {
  return new BadRequestException({
    code: 'INVITACION_NO_VALIDA',
    message: INVITATION_INVALID_MESSAGE,
  });
}

/**
 * Lista blanca campo a campo. `secretFingerprint` no aparece, y no puede
 * aparecer por descuido porque no hay ningún spread de la entidad.
 */
export function toInvitationView(i: ClientUserInvitation): PortalInvitationView {
  return {
    id: Number(i.id),
    fullName: i.fullName,
    email: i.email,
    expiresAt: toIso(i.expiresAt)!,
    lastSentAt: toIso(i.lastSentAt),
    // Por el hecho, no por la ausencia: hay fallo si hay TEXTO de error, no si
    // falta `lastSentAt` (que solo significa "todavía no se intentó").
    deliveryFailed: !!i.sendError,
    createdAt: toIso(i.createdAt)!,
  };
}
