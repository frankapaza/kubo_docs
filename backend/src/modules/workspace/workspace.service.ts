import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkspaceSetting } from './entities/workspace-setting.entity';
import { UpdateWorkspaceSettingsDto } from './dto/update-workspace.dto';
import { decryptSecret, encryptSecret } from '../../common/crypto/aes-gcm.util';

/**
 * Nombres de método de RFC 8601 §2.7.1 (el registro IANA "Email
 * Authentication Methods"). `assertValidImapAuthServerId` los usa para
 * detectar el rodeo de Microsoft 365 -- ver su docblock.
 */
const AUTH_METHOD_NAMES = [
  'auth',
  'compauth',
  'dkim',
  'dkim-adsp',
  'dkim-atps',
  'domainkeys',
  'dmarc',
  'iprev',
  'rrvs',
  'sender-id',
  'smime',
  'spf',
  'vbr',
];

/**
 * Rechaza un identificador de servidor que en realidad es un rodeo contra el
 * ancla (`judgeAuthentication`, `domain/intake-rules.ts`), no un nombre de
 * servidor.
 *
 * Microsoft 365 no escribe ningún `authserv-id` en su
 * `Authentication-Results` -- la cabecera empieza directamente por el primer
 * resultado (`spf=pass ...`). Con `judgeAuthentication` fallando cerrado, eso
 * bloquea el 100% del correo de ese proveedor: un problema de disponibilidad,
 * no de seguridad, pero real. El rodeo que se le ocurre a quien configura
 * esto es poner como identificador el propio nombre del método que sí ve al
 * principio -- `spf` o `dkim` -- para que "algo" coincida. Verificado: con
 * ese ajuste, una cabecera fabricada por un atacante para su propio dominio
 * (que siempre trae `spf=pass` o `dkim=pass`, honesto para SU dominio) pasa
 * exactamente igual. El ajuste no arregla Microsoft 365: reabre el vector
 * completo que `SIN_SERVIDOR_PROPIO` existe para detectar.
 *
 * Dos formas de colar un método de autenticación en vez de un `authserv-id`:
 *
 * - **Con `=`**: escribir `spf=pass` tal cual como identificador. Cualquier
 *   cabecera -- fabricada o real -- trae ese texto literal en cuanto SPF se
 *   evalúa, así que compararla contra esto no distingue nada.
 * - **Sin `=`**: si el propio servidor separa clave y valor con espacios
 *   (`spf = pass ...`), `extractServerId` (`domain/intake-rules.ts`) toma
 *   solo el primer token de la cabecera al partir por espacios -- `spf`,
 *   sin el `=` -- así que un identificador igual a `spf` a secas cuela lo
 *   mismo sin que el ajuste contenga ningún `=`.
 *
 * Ninguna de las dos identifica un servidor: comparten el mismo defecto, con
 * o sin el signo.
 */
export function assertValidImapAuthServerId(value: string): void {
  if (value.includes('=')) {
    throw new BadRequestException({
      code: 'BAD_INPUT',
      message:
        'El identificador del servidor de correo no puede contener "=": eso es un ' +
        'resultado de autenticación (por ejemplo "spf=pass"), no el nombre de un ' +
        'servidor -- y aceptarlo dejaría pasar cualquier cabecera fabricada por un ' +
        'atacante para su propio dominio, que también trae ese mismo texto.',
    });
  }
  if (AUTH_METHOD_NAMES.includes(value.toLowerCase())) {
    throw new BadRequestException({
      code: 'BAD_INPUT',
      message:
        `"${value}" es el nombre de un método de autenticación (como spf o dkim), no ` +
        'el de un servidor de correo -- usarlo como identificador tampoco distingue un ' +
        'correo legítimo de uno fabricado. Usa el hostname que tu propio servidor ' +
        'escribe como primer segmento de la cabecera Authentication-Results.',
    });
  }
}

/** Config SMTP resuelta (con el password descifrado en memoria) */
export interface ResolvedSmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

/**
 * Config IMAP resuelta (con el password descifrado en memoria), Task 8.
 * `folder` siempre trae un valor -- ver `getImapConfig` para el porqué del
 * valor por omisión y por qué no vive en la migración.
 */
export interface ResolvedImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  folder: string;
}

/** Carpeta IMAP por omisión cuando se configuró el buzón pero no la carpeta. */
const DEFAULT_IMAP_FOLDER = 'INBOX';

/**
 * Singleton: siempre trabajamos con la fila id=1.
 */
@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);
  constructor(
    @InjectRepository(WorkspaceSetting)
    private readonly repo: Repository<WorkspaceSetting>,
  ) {}

  async get(): Promise<WorkspaceSetting> {
    const row = await this.repo.findOne({ where: { id: 1 } });
    if (!row) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message:
          'Falta inicializar la configuración del emisor. Ejecuta add_workspace_settings.sql',
      });
    }
    return row;
  }

  async update(dto: UpdateWorkspaceSettingsDto): Promise<WorkspaceSetting> {
    const current = await this.get();
    const patch: Partial<WorkspaceSetting> = {};

    // Ver `assertValidImapAuthServerId`: un identificador con "=" o igual a
    // un método de autenticación no es un nombre de servidor, y aceptarlo
    // reabre el vector que SIN_SERVIDOR_PROPIO existe para detectar (no para
    // cerrar -- eso depende de la política SMTP del servidor de correo).
    // Cadena vacía (limpiar el ajuste) no pasa por aquí -- `null` no es un rodeo.
    if (dto.imapAuthServerId !== undefined && dto.imapAuthServerId.trim() !== '') {
      assertValidImapAuthServerId(dto.imapAuthServerId.trim());
    }

    // Mapeo 1:1 de campos simples, convirtiendo '' → null
    const simpleKeys: (keyof UpdateWorkspaceSettingsDto)[] = [
      'razonSocial',
      'ruc',
      'legalRepName',
      'legalRepDoc',
      'address',
      'phone',
      'email',
      'website',
      'logoUrl',
      'smtpHost',
      'smtpUser',
      'smtpFrom',
      'teamInboxEmail',
      'imapHost',
      'imapUser',
      'imapFolder',
      'imapAuthServerId',
    ];
    simpleKeys.forEach((key) => {
      const value = dto[key];
      if (value !== undefined) {
        (patch as Record<string, unknown>)[key] = value === '' ? null : value;
      }
    });

    // Número (session timeout / smtp port / retention days)
    if (dto.sessionTimeoutMinutes !== undefined) {
      patch.sessionTimeoutMinutes = dto.sessionTimeoutMinutes;
    }
    if (dto.smtpPort !== undefined) {
      patch.smtpPort = dto.smtpPort;
    }
    if (dto.imapPort !== undefined) {
      patch.imapPort = dto.imapPort;
    }
    if (dto.audioRetentionPolicy !== undefined) {
      patch.audioRetentionPolicy = dto.audioRetentionPolicy;
    }
    if (dto.audioRetentionDays !== undefined) {
      patch.audioRetentionDays = dto.audioRetentionDays;
    }

    // Boolean → tinyint
    if (dto.smtpSecure !== undefined) {
      patch.smtpSecure = dto.smtpSecure ? 1 : 0;
    }
    if (dto.imapSecure !== undefined) {
      patch.imapSecure = dto.imapSecure ? 1 : 0;
    }
    if (dto.imapEnabled !== undefined) {
      patch.imapEnabled = dto.imapEnabled ? 1 : 0;
    }

    // Password SMTP: encriptar si viene un valor; vacío explícito → limpiar
    if (dto.smtpPass !== undefined) {
      patch.smtpPassEncrypted = dto.smtpPass === '' ? null : encryptSecret(dto.smtpPass);
    }
    if (dto.imapPass !== undefined) {
      patch.imapPassEncrypted = dto.imapPass === '' ? null : encryptSecret(dto.imapPass);
    }

    await this.repo.update(current.id, patch);
    return this.get();
  }

  /**
   * Devuelve la config SMTP lista para usar (con password descifrado).
   * Retorna null si no está completa.
   */
  async getSmtpConfig(): Promise<ResolvedSmtpConfig | null> {
    const s = await this.get().catch(() => null);
    if (!s?.smtpHost || !s.smtpUser || !s.smtpPassEncrypted) return null;
    try {
      const pass = decryptSecret(s.smtpPassEncrypted);
      return {
        host: s.smtpHost,
        port: s.smtpPort ?? 587,
        secure: s.smtpSecure === 1,
        user: s.smtpUser,
        pass,
        from: s.smtpFrom ?? s.smtpUser,
      };
    } catch (e) {
      this.logger.warn(`No se pudo descifrar SMTP pass: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Config IMAP lista para usar (con password descifrado), o `null` si no
   * está completa -- mismo criterio que `getSmtpConfig`: host, usuario y
   * contraseña son los tres datos sin los que no hay nada que intentar.
   *
   * A propósito **no mira `imap_enabled`**: esta función responde "¿hay
   * suficiente para conectar?", no "¿debo conectar ahora?". Mezclar las dos
   * preguntas escondería la diferencia entre "apagado a propósito" (nadie se
   * queja, Task 8) y "encendido pero mal configurado" (sí hay que quejarse) --
   * quien enciende el buzón consulta esto directamente y decide qué decir en
   * cada caso.
   *
   * `folder` cae a `INBOX` cuando no se configuró ninguna: es el nombre que
   * todo servidor IMAP reserva para la bandeja principal (RFC 3501 §5.1), así
   * que es el valor que de verdad se usaría si nadie hubiera pensado en
   * configurarlo -- no una adivinanza. Vive aquí, en el código, y no en la
   * migración (columna `NULL` sin `DEFAULT`) para que `NULL` en la base siga
   * significando "nadie lo configuró" y no se confunda con esta elección.
   */
  async getImapConfig(): Promise<ResolvedImapConfig | null> {
    const s = await this.get().catch(() => null);
    if (!s?.imapHost || !s.imapUser || !s.imapPassEncrypted) return null;
    try {
      const pass = decryptSecret(s.imapPassEncrypted);
      return {
        host: s.imapHost,
        port: s.imapPort ?? 993,
        secure: s.imapSecure === 1,
        user: s.imapUser,
        pass,
        folder: s.imapFolder?.trim() || DEFAULT_IMAP_FOLDER,
      };
    } catch (e) {
      this.logger.warn(`No se pudo descifrar IMAP pass: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * El interruptor de la ingesta. `false` también si la fila de ajustes no
   * se puede leer -- fallo cerrado, y en la misma dirección que el valor por
   * omisión de la propia columna (`DEFAULT 0`): no saber si está encendida
   * nunca debe tratarse como que lo está.
   */
  async isImapIngestionEnabled(): Promise<boolean> {
    const s = await this.get().catch(() => null);
    return s?.imapEnabled === 1;
  }

  /**
   * El identificador del propio servidor de correo (`authserv-id`), o `null`
   * si nadie lo configuró todavía -- también `null` si la fila de ajustes no
   * se puede leer, mismo criterio de fallo cerrado que `isImapIngestionEnabled`.
   * `InboundEmailService` lo pasa a `judgeAuthentication`/`extractAuthenticatedDomain`
   * (`domain/intake-rules.ts`) en cada correo: `null` ahí significa
   * `SIN_SERVIDOR_PROPIO` siempre, nunca "da igual cuál sea" -- ver el
   * docblock de `judgeAuthentication`, sección "El ancla que faltaba".
   *
   * Recorta el valor, mismo criterio que `getTeamInboxEmail`: un espacio
   * suelto guardado desde el panel dejaría un identificador que nunca
   * coincidiría con el primer segmento real de la cabecera.
   */
  async getImapAuthServerId(): Promise<string | null> {
    const s = await this.get().catch(() => null);
    const serverId = s?.imapAuthServerId?.trim();
    return serverId ? serverId : null;
  }

  /**
   * Buzón del equipo, o `null` si no está configurado.
   *
   * Devuelve `null` también cuando la fila de ajustes no existe todavía: quien
   * llama tiene que tener un plan para el caso "no hay buzón" de todos modos
   * (cae al remitente SMTP), y hacer estallar un aviso por correo porque falte
   * la configuración del emisor sería desproporcionado.
   *
   * Recorta el valor: un espacio suelto guardado desde el panel dejaría una
   * dirección de destino inválida que solo se vería en el rebote.
   */
  async getTeamInboxEmail(): Promise<string | null> {
    const settings = await this.get().catch(() => null);
    const inbox = settings?.teamInboxEmail?.trim();
    return inbox ? inbox : null;
  }

  /**
   * Descarga el logo desde la URL configurada como Buffer (para PDFKit).
   * Solo acepta PNG/JPEG, máximo 2MB. Devuelve null si no hay logo o falla la descarga.
   */
  async getLogoBuffer(): Promise<Buffer | null> {
    const settings = await this.get().catch(() => null);
    if (!settings?.logoUrl) return null;
    try {
      const res = await fetch(settings.logoUrl);
      if (!res.ok) {
        this.logger.warn(`Logo fetch failed (${res.status}): ${settings.logoUrl}`);
        return null;
      }
      const contentType = res.headers.get('content-type') ?? '';
      if (!/^image\/(png|jpeg|jpg)/i.test(contentType)) {
        this.logger.warn(`Logo no es PNG/JPEG (content-type=${contentType}): ${settings.logoUrl}`);
        return null;
      }
      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer.byteLength > 2 * 1024 * 1024) {
        this.logger.warn(`Logo pesa más de 2MB (${arrayBuffer.byteLength} bytes)`);
        return null;
      }
      return Buffer.from(arrayBuffer);
    } catch (e) {
      this.logger.warn(`Logo fetch error: ${(e as Error).message}`);
      return null;
    }
  }
}
