import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { ClientsService } from "../clients/clients.service";
import { ClientUsersRepository } from "./client-users.repository";
import { ClientUserInvitationsRepository } from "./client-user-invitations.repository";
import {
  PortalInvitationsService,
  admiteReinvitacion,
} from "./portal-invitations.service";
import { normalizeEmailAddress } from "./email-address";
import { sameId } from "../../common/ids";
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
  encodeReview,
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

@Injectable()
export class ClientUsersBulkService {
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
        "Esa empresa dejó de ser cliente, así que sus invitaciones no funcionarían. " +
          "Cámbiale el estado antes de dar de alta a su gente.",
      );
    }
    return empresa;
  }

  /**
   * El veredicto de una fila. **La misma función la usan la revisión y el
   * envío** (Task 7): si el envío tuviera su propia copia, las dos podrían
   * discrepar y se invitaría a alguien que la pantalla dijo que no.
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
    const fullName = cruda.fullName.replace(/\s+/g, " ").trim();
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
      return rechazo(`El nombre pasa de ${MAX_FULL_NAME_LENGTH} caracteres.`);
    }
    if (email === "") return rechazo("Falta el correo.");
    if (email.length > MAX_EMAIL_LENGTH) {
      return rechazo(`El correo pasa de ${MAX_EMAIL_LENGTH} caracteres.`);
    }
    if (!FORMA_DE_CORREO.test(email))
      return rechazo("El correo no está bien escrito.");

    const yaVistoEn = vistos.get(email);
    if (yaVistoEn !== undefined) {
      return rechazo(
        `Ese correo ya aparece en la fila ${yaVistoEn} de este archivo.`,
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
        return rechazo("Ese correo ya es de un usuario de otra empresa.");
      }
      if (yaEsUsuario.isAdmin) {
        return rechazo(
          "Es administrador de esta empresa. La carga masiva no toca administradores; " +
            "usa la edición del panel.",
        );
      }
      if (yaEsUsuario.isActive) {
        return rechazo(
          "Ya es usuario activo de esta empresa; su contraseña no se toca.",
        );
      }
      // Desactivado, no administrador y de esta empresa: reinvitación de la
      // decisión 12 de R4. Se decide con `admiteReinvitacion`, la MISMA
      // función que usan invitar y aceptar, no con una copia de sus tres
      // reglas — dos copias terminan divergiendo y la que se olvide es la que
      // deja reactivar a quien no debía.
      if (!admiteReinvitacion(yaEsUsuario, clientId)) {
        return rechazo("Ese correo no se puede invitar desde aquí.");
      }
      return {
        ...base,
        verdict: "SE_INVITARA",
        reason:
          "Está desactivado en esta empresa: al aceptar recuperará su acceso y su historial.",
      };
    }

    const viva = await this.invitations.findLiveByEmail(email, new Date());
    if (viva) {
      if (!sameId(viva.clientId, clientId)) {
        // No se toca la ajena: sería un efecto cruzado entre empresas por la
        // puerta de atrás. Misma regla que R4.
        return rechazo(
          "Ese correo tiene una invitación pendiente en otra empresa. No se puede invitar " +
            "hasta que caduque.",
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
