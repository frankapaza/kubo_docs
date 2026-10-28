import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { ClientsService } from "../clients/clients.service";
import { ClientUsersRepository } from "./client-users.repository";
import { ClientUserInvitationsRepository } from "./client-user-invitations.repository";
import { PortalInvitationsService } from "./portal-invitations.service";
import { normalizeEmailAddress } from "./email-address";
import { sameId } from "../../common/ids";
import { ConfirmBulkInviteDto } from "./dto/bulk-users.dto";
import { invitationFingerprintsMatch as reviewMacMatches } from "./domain/invitation-secret";
import { buildBulkTemplate, readUploadedGrid } from "./bulk-users-workbook";
import {
  RawBulkRow,
  archivoRechazado,
  gridToRows,
} from "./domain/bulk-user-file";
import {
  REVIEW_VERSION,
  ReviewRow,
  deriveReviewKey,
  decodeReview,
  encodeReview,
  isReviewExpired,
  reviewExpiryLabel,
  reviewMac,
} from "./domain/bulk-users-review";

/**
 * La carga masiva de usuarios de cliente, desde el panel de la casa.
 *
 * Dos pasos, y el primero **no escribe nada ni manda ningún correo**
 * (decisión 3 de la spec): con 22 mensajes saliendo hacia personas reales,
 * descubrir el error a mitad no tiene arreglo.
 *
 * **Aquí se dice el motivo de cada rechazo**, al revés que en el portal
 * (decisión 7 de R4). No es una incoherencia: la regla de fondo es «no le
 * digas a nadie algo que no pudiera obtener ya por otro camino», y quien llega
 * aquí es personal de la casa con rol ADMIN, que ya puede leerse la lista
 * entera de empresas y de sus usuarios. La valla que lo sostiene es que estos
 * textos **viven solo aquí** y no se exportan hacia ninguna superficie del
 * portal. Ver la decisión 10 de la spec.
 *
 * **Una excepción dentro de esa misma regla:** cuando el motivo es que el
 * correo ya es de otra empresa, el texto lo dice **sin nombrarla**. Este
 * informe concreto sale del panel —se copia y se manda por correo al cliente
 * para que corrija su hoja— y ese correo lo lee alguien de fuera, al que la
 * lista de empresas sí le está vedada. Quien necesite saber cuál es la busca
 * en el panel.
 */

/** Los mismos límites que `InvitePortalUserDto`, no unos nuevos. */
export const MAX_FULL_NAME_LENGTH = 180;
export const MAX_EMAIL_LENGTH = 180;

/**
 * Comprobación de forma de correo, deliberadamente laxa: algo, una arroba,
 * algo con un punto. No se intenta reimplementar la RFC 5322 —nadie la
 * implementa entera y las aproximaciones estrictas rechazan direcciones
 * válidas—, y no hace falta: lo que decide de verdad si una dirección existe
 * es que el correo llegue.
 */
const CARACTER_DE_CONTROL = /\p{Cc}/u;

/**
 * Los invisibles de ancho cero: espacio (U+200B), no-unión y unión (U+200C y
 * U+200D), unión de palabras (U+2060) y el espacio sin salto de ancho cero
 * (U+FEFF, que es además la marca de orden de bytes cuando va al principio).
 *
 * Se tratan como espacio en blanco y se quitan del nombre, igual que se
 * colapsan los saltos de línea. No son `\p{Cc}`: son de formato, y por eso se
 * colaban por la guarda de caracteres de control.
 */
const ANCHO_CERO = /[\u200b-\u200d\u2060\ufeff]/g;

/** Lo más que se repite de una celda rechazada en el informe. */
const MAX_ECHO_LENGTH = 200;

function truncarEco(texto: string): string {
  return texto.length > MAX_ECHO_LENGTH
    ? `${texto.slice(0, MAX_ECHO_LENGTH)}…`
    : texto;
}

const FORMA_DE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type BulkRowVerdict = "SE_INVITARA" | "SE_REINVITARA" | "RECHAZADA";

export interface BulkReviewRow {
  /** Fila del archivo, contando la cabecera. Es lo que hace accionable el informe. */
  line: number;
  fullName: string;
  email: string;
  verdict: BulkRowVerdict;
  /** El motivo, escrito. `null` solo cuando no hay nada que explicar. */
  reason: string | null;
}

export interface BulkReviewResult {
  clientId: number;
  clientName: string;
  rows: BulkReviewRow[];
  totals: { willInvite: number; willReinvite: number; rejected: number };
  /** Bloque opaco con lo aprobado. Cadena vacía si no hay nada que confirmar. */
  revision: string;
  /** Su firma. Cadena vacía si no hay bloque. */
  mac: string;
  /** Hasta cuándo vale, en hora de Lima. Cadena vacía si no hay bloque. */
  expiresAtLabel: string;
}

export type BulkSendOutcome =
  | "INVITADA"
  | "INVITADA_SIN_CORREO"
  | "OMITIDA"
  | "FALLO";

export interface BulkSendRow {
  line: number;
  fullName: string;
  email: string;
  outcome: BulkSendOutcome;
  reason: string | null;
}

export interface BulkSendResult {
  /** La empresa a la que se invitó. Va también aquí para que `audit_log` la guarde. */
  clientId: number;
  rows: BulkSendRow[];
  totals: {
    invited: number;
    invitedWithoutEmail: number;
    skipped: number;
    failed: number;
  };
}

/**
 * Único cuerpo para cualquier motivo por el que una revisión no vale: firma
 * que no casa, forma mala, versión vieja, caducada.
 *
 * No se distinguen porque al operador le sirven todos para lo mismo —volver a
 * subir el archivo— y porque distinguirlos daría pistas sobre la firma sin
 * ayudar a nadie.
 */
export const REVISION_NO_VALIDA_MESSAGE =
  "Esa revisión ya no vale. Vuelve a subir el archivo y revísalo otra vez antes de enviar.";

export const YA_SE_ESTA_ENVIANDO_MESSAGE =
  "Esa revisión ya se está enviando. Espera a que termine antes de volver a confirmarla.";

/** Holgura al comparar con `createdAt`: la columna puede venir truncada al segundo. */
const HOLGURA_DE_CREACION_MS = 1000;

@Injectable()
export class ClientUsersBulkService {
  private readonly logger = new Logger(ClientUsersBulkService.name);

  /**
   * Las revisiones que se están enviando ahora mismo en ESTE proceso, por su
   * firma. Corta la doble pulsación. No cubre dos procesos a la vez: ahí la
   * defensa es la comprobación contra la base de `enviarUna`, que solo deja
   * una ventana de milisegundos entre leer y escribir.
   */
  private readonly enCurso = new Set<string>();

  constructor(
    private readonly clientUsers: ClientUsersRepository,
    private readonly invitations: ClientUserInvitationsRepository,
    private readonly clients: ClientsService,
    private readonly portalInvitations: PortalInvitationsService,
    private readonly config: ConfigService,
  ) {}

  /** La plantilla que se descarga. Ver `buildBulkTemplate`: sin ninguna fecha. */
  template(): Promise<Buffer> {
    return buildBulkTemplate();
  }

  /**
   * Analiza el archivo y dice, fila a fila, qué pasaría. **No escribe nada.**
   *
   * Devuelve además un bloque firmado con las filas aprobadas: es lo que hace
   * que la confirmación no pueda mandar otra cosa (decisión 15 de la spec).
   */
  async review(clientId: number, buffer: Buffer): Promise<BulkReviewResult> {
    const empresa = await this.empresaQuePuedeRecibirInvitaciones(clientId);
    const crudas = gridToRows(await readUploadedGrid(buffer));

    const vistos = new Map<string, number>();
    const rows: BulkReviewRow[] = [];

    for (const cruda of crudas) {
      rows.push(await this.evaluar(cruda, clientId, vistos));
    }

    const aprobadas: ReviewRow[] = rows
      .filter((f) => f.verdict !== "RECHAZADA")
      .map((f) => ({ line: f.line, fullName: f.fullName, email: f.email }));

    const totals = {
      willInvite: rows.filter((f) => f.verdict === "SE_INVITARA").length,
      willReinvite: rows.filter((f) => f.verdict === "SE_REINVITARA").length,
      rejected: rows.filter((f) => f.verdict === "RECHAZADA").length,
    };

    // Sin ninguna fila aprobada no se firma nada: un bloque vacío sería un
    // vale para confirmar la nada, y la pantalla tiene que empujar a corregir
    // el archivo, no a pulsar «enviar».
    if (aprobadas.length === 0) {
      return {
        clientId,
        clientName: empresa.razonSocial,
        rows,
        totals,
        revision: "",
        mac: "",
        expiresAtLabel: "",
      };
    }

    const issuedAt = Date.now();
    const revision = encodeReview({
      v: REVIEW_VERSION,
      clientId,
      issuedAt,
      rows: aprobadas,
    });

    return {
      clientId,
      clientName: empresa.razonSocial,
      rows,
      totals,
      revision,
      mac: reviewMac(this.reviewKey(), revision),
      expiresAtLabel: reviewExpiryLabel(issuedAt),
    };
  }

  /**
   * Crea las invitaciones de una revisión ya confirmada y manda los correos.
   *
   *  1. La firma se verifica **antes de decodificar nada**, sobre la cadena
   *     tal cual llegó; después la caducidad. La empresa sale del bloque
   *     firmado: el cuerpo no la trae, así que no hay una distinta que casar.
   *  2. **Cada fila se vuelve a evaluar contra la base** con la MISMA función
   *     que la revisión: la firma prueba que la lista no se tocó, no que siga
   *     siendo válida.
   *  3. **Cada fila es su propio try/catch.** Una que revienta no deshace las
   *     anteriores ni impide las siguientes, y la invitación queda creada
   *     aunque el correo falle (reenviar es el reintento).
   *  4. **Repetir la confirmación no duplica.** Contra la doble pulsación en el
   *     mismo proceso, `enCurso`; contra el reintento posterior, `enviarUna`
   *     omite a quien ya tiene una invitación viva nacida después de la
   *     revisión. Que el bloque caduque a los 30 minutos acota el problema
   *     pero no lo resuelve: dentro de esa media hora se puede confirmar dos
   *     veces.
   *
   * Los envíos van en serie: muchas conexiones SMTP simultáneas es la forma
   * más rápida de que el proveedor nos marque.
   */
  async send(
    staffUserId: number,
    clientId: number,
    dto: ConfirmBulkInviteDto,
  ): Promise<BulkSendResult> {
    if (
      typeof dto?.revision !== "string" ||
      typeof dto?.mac !== "string" ||
      !reviewMacMatches(reviewMac(this.reviewKey(), dto.revision), dto.mac)
    ) {
      throw revisionNoValida();
    }

    const payload = decodeReview(dto.revision);
    if (!payload) throw revisionNoValida();
    if (isReviewExpired(payload.issuedAt, new Date())) throw revisionNoValida();

    // La empresa de la URL tiene que ser la del bloque firmado. No es una
    // defensa (el bloque es auténtico y el operador puede con todas): es que la
    // petición diga la verdad sobre para quién fue. Va DESPUÉS de la firma, así
    // que quien llega aquí tenía un bloque auténtico y este motivo no es un oráculo.
    if (!sameId(payload.clientId, clientId)) {
      throw new BadRequestException({
        code: "REVISION_DE_OTRA_EMPRESA",
        message:
          "Esta revisión se hizo para otra empresa distinta de la que se está confirmando. " +
          "No se ha enviado nada: vuelve a subir el archivo desde la empresa correcta.",
      });
    }

    if (this.enCurso.has(dto.mac)) {
      throw new ConflictException({
        code: "REVISION_EN_CURSO",
        message: YA_SE_ESTA_ENVIANDO_MESSAGE,
      });
    }
    this.enCurso.add(dto.mac);
    try {
      // Pudo pasar a ex-cliente entre los dos pasos: entonces no sale ni un correo.
      await this.empresaQuePuedeRecibirInvitaciones(payload.clientId);

      const vistos = new Map<string, number>();
      const rows: BulkSendRow[] = [];
      for (const fila of payload.rows) {
        rows.push(
          await this.enviarUna(
            staffUserId,
            payload.clientId,
            payload.issuedAt,
            fila,
            vistos,
          ),
        );
      }

      return {
        clientId: payload.clientId,
        rows,
        totals: {
          invited: rows.filter((f) => f.outcome === "INVITADA").length,
          invitedWithoutEmail: rows.filter(
            (f) => f.outcome === "INVITADA_SIN_CORREO",
          ).length,
          skipped: rows.filter((f) => f.outcome === "OMITIDA").length,
          failed: rows.filter((f) => f.outcome === "FALLO").length,
        },
      };
    } finally {
      this.enCurso.delete(dto.mac);
    }
  }

  /** Una fila: revalidar, invitar, y no dejar que su fallo salpique a las demás. */
  private async enviarUna(
    staffUserId: number,
    clientId: number,
    issuedAt: number,
    fila: ReviewRow,
    vistos: Map<string, number>,
  ): Promise<BulkSendRow> {
    const base = { line: fila.line, fullName: fila.fullName, email: fila.email };

    try {
      const ahora = await this.evaluar(fila, clientId, vistos);
      if (ahora.verdict === "RECHAZADA") {
        return { ...base, outcome: "OMITIDA", reason: ahora.reason };
      }

      // Una invitación viva nacida DESPUÉS de la revisión no es la que la
      // revisión vio: es de esta misma confirmación repetida (o de alguien
      // que se adelantó), y reemplazarla mandaría un segundo correo y mataría
      // el enlace del primero.
      if (ahora.verdict === "SE_REINVITARA") {
        const viva = await this.invitations.findLiveByEmail(
          ahora.email,
          new Date(),
        );
        const nacida = viva?.createdAt ? new Date(viva.createdAt).getTime() : NaN;
        if (
          Number.isFinite(nacida) &&
          nacida >= issuedAt - HOLGURA_DE_CREACION_MS
        ) {
          return {
            ...base,
            outcome: "OMITIDA",
            reason:
              "Ya se le mandó una invitación después de revisar el archivo (puede que esta " +
              "confirmación ya se hubiera hecho), así que no se le manda otra.",
          };
        }
      }

      const view = await this.portalInvitations.invite(
        clientId,
        { kind: "STAFF", userId: staffUserId },
        { email: fila.email, fullName: fila.fullName },
      );

      // `deliver` ya se traga el fallo de envío y deja la invitación creada:
      // aquí solo se traduce a algo que el operador pueda accionar.
      return view.deliveryFailed
        ? {
            ...base,
            outcome: "INVITADA_SIN_CORREO",
            reason:
              "La invitación quedó creada pero el correo no salió. Vuelve a subir esta fila " +
              "para mandarle un enlace nuevo.",
          }
        : { ...base, outcome: "INVITADA", reason: null };
    } catch (err) {
      // Al log, a la respuesta nunca: el motivo técnico es diagnóstico interno.
      this.logger.error(
        `Carga masiva: falló la fila ${fila.line} (${fila.email}): ${(err as Error)?.message}`,
      );
      return {
        ...base,
        outcome: "FALLO",
        reason: "No se pudo crear su invitación. Vuelve a subir esta fila.",
      };
    }
  }

  /**
   * La clave del MAC. Se deriva en cada uso y no se guarda en un campo: es
   * barato, y así no hay ninguna copia del material de clave viva en el
   * proceso más tiempo del necesario.
   */
  private reviewKey(): Buffer {
    return deriveReviewKey(this.config.get<string>("JWT_ACCESS_SECRET") || "");
  }

  /**
   * La empresa, si puede recibir invitaciones.
   *
   * **`FORMER_CLIENT` tumba el archivo entero, antes de mirar ninguna fila.**
   * Una invitación a una empresa que dejó de ser cliente nace muerta —`accept`
   * la rechaza— así que mandar 22 correos con enlaces que no van a funcionar
   * es peor que no dejar hacerlo. Un `PROSPECT` sí puede, exactamente como en
   * R4: `clients` no tiene columna de activo, tiene `status`.
   */
  private async empresaQuePuedeRecibirInvitaciones(clientId: number) {
    const empresa = await this.clients.findByIdOrFail(clientId);
    if (empresa.status === "FORMER_CLIENT") {
      throw archivoRechazado(
        "Esta empresa dejó de ser cliente, así que sus invitaciones no funcionarían y no se " +
          "ha enviado nada. Hay que reactivarla antes de volver a subir el archivo.",
      );
    }
    return empresa;
  }

  /**
   * El veredicto de una fila. Está pensada para que la use también el envío
   * (Task 7): si el envío tuviera su propia copia, las dos podrían discrepar y
   * se invitaría a alguien que la pantalla dijo que no.
   *
   * **Los motivos están escritos para quien recibe el informe**, que es el
   * cliente y no tiene panel: dicen qué pasa con la fila y qué hacer con ella
   * en la hoja, sin vocabulario interno.
   *
   * `vistos` acumula los correos ya normalizados de este mismo archivo, con la
   * fila donde apareció cada uno. Se compara con el correo **normalizado**
   * porque `Ana@X.com` y `ana@x.com` son la misma persona, y dos filas para la
   * misma persona son un error del archivo, no dos invitaciones.
   */
  private async evaluar(
    cruda: RawBulkRow,
    clientId: number,
    vistos: Map<string, number>,
  ): Promise<BulkReviewRow> {
    // Colapsar espacio en blanco (saltos de línea y tabuladores incluidos) no
    // esconde información; tragarse un carácter de control sí, así que ese se
    // rechaza en vez de limpiarse.
    //
    // Los de ANCHO CERO se quitan antes de colapsar. No son de control —son de
    // formato, así que `\p{Cc}` no los ve— pero dentro del nombre de una
    // persona no son información de ninguna clase: nadie se llama con un
    // separador invisible dentro. Llegan de pegar desde una web o un PDF, y
    // dejarlos pasar es guardar dos personas distintas que se leen igual,
    // «Ana Pérez» y «Ana Pérez», con el correo como única pista de que son la
    // misma. Se quitan, no se sustituyen por un espacio: son invisibles, así
    // que quitarlos es lo que deja escrito lo que el operador ve.
    const fullName = cruda.fullName
      .replace(ANCHO_CERO, "")
      .replace(/\s+/g, " ")
      .trim();
    const email = cruda.email === "" ? "" : normalizeEmailAddress(cruda.email);
    const base = { line: cruda.line, fullName, email };
    const rechazo = (reason: string): BulkReviewRow => ({
      ...base,
      // El eco de lo rechazado se trunca: un archivo roto puede traer celdas enormes.
      fullName: truncarEco(fullName),
      email: truncarEco(email),
      verdict: "RECHAZADA",
      reason,
    });

    // El lector marca así la fila con celdas de más y la conserva: se explica con
    // SU texto, no con el del correo que quedó mal por el desplazamiento. Va
    // antes de todo y no registra el correo: tras el desplazamiento no es fiable.
    if (cruda.problem) return rechazo(cruda.problem);

    if (fullName === "") return rechazo("Falta el nombre.");
    if (CARACTER_DE_CONTROL.test(fullName)) {
      return rechazo(
        "El nombre lleva un carácter de control invisible (suele venir de pegar desde otro " +
          "programa). Bórralo y vuelve a escribir el nombre.",
      );
    }
    if (fullName.length > MAX_FULL_NAME_LENGTH) {
      return rechazo(`El nombre pasa de ${MAX_FULL_NAME_LENGTH} caracteres. Acórtalo.`);
    }
    if (email === "") return rechazo("Falta el correo.");
    if (email.length > MAX_EMAIL_LENGTH) {
      return rechazo(`El correo pasa de ${MAX_EMAIL_LENGTH} caracteres. Revisa que esté bien escrito.`);
    }
    if (!FORMA_DE_CORREO.test(email))
      return rechazo("El correo no está bien escrito. Corrígelo en la hoja.");

    const yaVistoEn = vistos.get(email);
    if (yaVistoEn !== undefined) {
      return rechazo(
        `Ese correo ya aparece en la fila ${yaVistoEn} de este archivo. Deja solo una de las dos filas.`,
      );
    }
    vistos.set(email, cruda.line);

    const yaEsUsuario = await this.clientUsers.findByEmail(email);
    if (yaEsUsuario) {
      if (!sameId(yaEsUsuario.clientId, clientId)) {
        // Se dice QUE es de otra empresa, nunca CUÁL. Es la excepción de la
        // decisión 10: este informe sale del panel hacia un correo al cliente,
        // y ese correo no lo lee ningún ADMIN. Quien necesite el nombre lo
        // busca en el panel, que es donde esa consulta queda auditada.
        return rechazo(
          "Ese correo ya es de un usuario de otra empresa, así que no se puede invitar aquí. " +
            "Usa otro correo o quita la fila.",
        );
      }
      if (yaEsUsuario.isAdmin) {
        return rechazo(
          "Es administrador de esta empresa. La carga masiva no modifica a los " +
            "administradores: quita la fila.",
        );
      }
      if (yaEsUsuario.isActive) {
        return rechazo(
          "Ya es usuario activo de esta empresa; no hace falta invitarlo y su contraseña no se toca. Quita la fila.",
        );
      }
      // Desactivado, no administrador y de esta empresa: reinvitación de la
      // decisión 12 de R4. Las tres condiciones de `admiteReinvitacion` ya se
      // comprobaron arriba, una a una; llamar a la función aquí sería una
      // comprobación que nunca puede fallar. Si esa regla cambia en el servicio
      // de invitaciones, hay que cambiarla aquí también.
      return {
        ...base,
        verdict: "SE_INVITARA",
        reason:
          "Su acceso a esta empresa está desactivado: se le enviará una invitación y, al aceptarla, recuperará su acceso y su historial.",
      };
    }

    const viva = await this.invitations.findLiveByEmail(email, new Date());
    if (viva) {
      if (!sameId(viva.clientId, clientId)) {
        // No se toca la ajena: sería un efecto cruzado entre empresas por la
        // puerta de atrás. Misma regla que R4.
        return rechazo(
          "Ese correo tiene una invitación pendiente de otra empresa, así que no se puede " +
          "invitar ahora. Quita la fila; podrá invitarse cuando esa invitación caduque.",
        );
      }
      return {
        ...base,
        verdict: "SE_REINVITARA",
        reason:
          "Ya tiene una invitación pendiente: se le mandará un enlace nuevo y el anterior " +
          "dejará de funcionar.",
      };
    }

    return { ...base, verdict: "SE_INVITARA", reason: null };
  }
}

function revisionNoValida(): BadRequestException {
  return new BadRequestException({
    code: "REVISION_NO_VALIDA",
    message: REVISION_NO_VALIDA_MESSAGE,
  });
}
