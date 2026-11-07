import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { ClientsRepository } from '../../clients/clients.repository';
import { TicketsRealtimeGateway } from '../../tickets/tickets-realtime.gateway';
import { resolveEventTime } from '../domain/event-time';
import { IngestBatch, IngestEvent, MAX_EVENTS_PER_BATCH, parseIngestBatch } from '../domain/ingest-batch';
import { LiveLogLine } from '../domain/live-tail';
import { isErrorLevel, LogLevel, meetsMinLevel } from '../domain/log-level';
import { ErrorEventInput, ErrorGroupsService, OccurrenceContext } from '../error-groups.service';
import { InstallationsService, ResolvedInstallation } from '../installations.service';
import { LokiClient, LokiLabels, LokiStream } from '../loki/loki.client';
import { IngestRateLimiter } from './ingest-rate-limiter';
import { RecentBatches } from './recent-batches';

/** Propiedad con la que un aplicativo compartido dice de qué cliente es el evento. */
export const RUC_PROPERTY = 'kubo:ruc';
/** Como valida el alta de clientes: 11 dígitos. Lo demás ni se consulta. */
const RUC_FORMAT = /^\d{11}$/;
/** Logger de la línea que avisa de lo que el appender tiró por cola llena. */
const DISCARD_LOGGER = 'Kubo.Log4Net';

/**
 * 429 que lleva los segundos de espera, para que el controlador ponga la
 * cabecera `Retry-After` (el appender la respeta).
 */
export class IngestRateLimitedException extends HttpException {
  constructor(readonly retryAfterSec: number) {
    super(
      {
        code: 'TOO_MANY_REQUESTS',
        message: `Demasiados lotes para esta instalación; reintente en ${retryAfterSec} s.`,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

function tooManyEvents(raw: unknown): boolean {
  const eventos = (raw as { eventos?: unknown } | null)?.eventos;
  return typeof raw === 'object' && raw !== null && Array.isArray(eventos) && eventos.length > MAX_EVENTS_PER_BATCH;
}

/** Un evento que pasó el nivel mínimo, con hora y cliente ya decididos. */
interface AcceptedEvent {
  ev: IngestEvent;
  at: Date;
  tsOriginal: string | null;
  clientId: number | null;
}

@Injectable()
export class IngestService {
  private readonly log = new Logger(IngestService.name);

  constructor(
    private readonly loki: LokiClient,
    private readonly installations: InstallationsService,
    private readonly errors: ErrorGroupsService,
    private readonly clients: ClientsRepository,
    private readonly gateway: TicketsRealtimeGateway,
    private readonly limiter: IngestRateLimiter,
    private readonly recent: RecentBatches,
  ) {}

  /**
   * Procesa un lote del appender.
   *
   * El orden importa: el límite de ritmo va primero (un bucle no debe
   * costar ni el análisis del cuerpo); Loki va antes que MySQL, pero un Loki
   * caído NO impide registrar los errores (la spec: «se procesan igual»), y
   * el 503 se lanza al final, cuando ya está hecho todo lo que se puede
   * hacer. Así el reintento del appender solo tiene que reintentar Loki.
   */
  async ingest(
    inst: ResolvedInstallation,
    raw: unknown,
    receivedAt: Date = new Date(),
  ): Promise<{ aceptados: number; descartadosPorNivel: number }> {
    const now = receivedAt.getTime();

    const rate = this.limiter.take(inst.id, now);
    if (!rate.ok) throw new IngestRateLimitedException(rate.retryAfterSec);

    // Más de 1000 eventos es «demasiado grande» (413, el appender lo tira y
    // no lo reintenta), no un cuerpo mal formado: se mira antes que el 400.
    if (tooManyEvents(raw)) {
      throw new PayloadTooLargeException({
        code: 'PAYLOAD_TOO_LARGE',
        message: `Un lote admite como máximo ${MAX_EVENTS_PER_BATCH} eventos.`,
      });
    }

    const parsed = parseIngestBatch(raw);
    if (!parsed.ok) {
      // 400: el appender lo tira (reintentar el mismo cuerpo no lo arregla).
      throw new BadRequestException({ code: 'LOTE_INVALIDO', message: parsed.message });
    }
    const batch = parsed.batch;

    // Review Focus 1: se reserva el lote AHORA, de forma síncrona y antes de
    // cualquier await. Si se mirara después (tras el push a Loki o mientras
    // recordOccurrences espera un bloqueo de fila), un reintento del appender
    // —que corta a los 5 s— llegaría con el primero aún en vuelo, vería el lote
    // «no visto» y sumaría las mismas ocurrencias otra vez.
    const claim = batch.loteId === null ? 'new' : this.recent.claim(inst.id, batch.loteId, now);
    let settled = claim !== 'new';
    const reservation = {
      confirm: () => {
        if (!settled && batch.loteId !== null) this.recent.remember(inst.id, batch.loteId, now);
        settled = true;
      },
      release: () => {
        if (!settled && batch.loteId !== null) this.recent.forget(inst.id, batch.loteId);
        settled = true;
      },
    };
    try {
      return await this.process(inst, batch, receivedAt, claim, reservation);
    } finally {
      // Cualquier salida que no confirmó el lote lo libera: un fallo inesperado
      // no puede dejarlo reservado y hacer que el reintento se salte los errores.
      reservation.release();
    }
  }

  private async process(
    inst: ResolvedInstallation,
    batch: IngestBatch,
    receivedAt: Date,
    claim: 'new' | 'pending' | 'done',
    reservation: { confirm: () => void; release: () => void },
  ): Promise<{ aceptados: number; descartadosPorNivel: number }> {
    const kept = batch.eventos.filter((e) => meetsMinLevel(e.nivel, inst.minLevel));
    const descartadosPorNivel = batch.eventos.length - kept.length;

    const rucs = await this.resolveRucs(inst, kept);
    const accepted: AcceptedEvent[] = kept.map((ev) => {
      const { at, original } = resolveEventTime(ev.ts, receivedAt);
      return { ev, at, tsOriginal: original, clientId: this.clientOf(inst, ev, rucs) };
    });

    // ---- Loki
    const pushed = await this.loki.push(this.buildStreams(inst, batch, accepted, receivedAt));
    let lokiDown = false;
    if (!pushed.ok) {
      if (pushed.retryable) {
        lokiDown = true;
        this.log.warn(`Loki no disponible para la instalación ${inst.id} (${pushed.status ?? 'red'}): ${pushed.message}`);
      } else {
        // Review Focus 2: un 4xx de Loki es definitivo; responder 503 haría que
        // el appender reintentara el mismo lote para siempre. Se deja constancia
        // y se sigue.
        this.log.error(`Loki rechazó el lote de la instalación ${inst.id} (${pushed.status}): ${pushed.message}`);
      }
    }

    // ---- Errores y vivo, una sola vez por lote (Review Focus 1)
    let errorsFailed = false;
    // Un duplicado con el original aún en vuelo no registra nada, pero responde
    // 503: si el original acaba fallando, el appender (que ya no lo espera)
    // tiene que volver a mandarlo para que los errores no se pierdan. El
    // siguiente reintento encontrará el lote confirmado (202) o liberado.
    const inFlightDuplicate = claim === 'pending';
    if (claim === 'new') {
      try {
        const errorEvents = accepted.filter((a) => isErrorLevel(a.ev.nivel)).map((a) => this.toErrorEvent(inst, a));
        if (errorEvents.length > 0) {
          const ctx: OccurrenceContext = {
            installationId: inst.id,
            aplicativo: batch.aplicativo,
            servidor: batch.servidor,
            receivedAt,
          };
          await this.errors.recordOccurrences(ctx, errorEvents);
        }
        // Se confirma SOLO si los errores quedaron registrados.
        reservation.confirm();
      } catch (e) {
        errorsFailed = true;
        // Fallaron: se libera para que el reintento vuelva a registrarlos.
        // Preferimos contar dos veces algún grupo que ya entró
        // (recordOccurrences confirma cada huella por separado) a perder
        // errores para siempre.
        reservation.release();
        this.log.error(`No se pudieron registrar los errores de la instalación ${inst.id}: ${(e as Error)?.message ?? e}`);
      }
      // El gateway ya se protege de sus propios fallos; aun así el vivo es un
      // extra y nunca debe tumbar la recepción.
      try {
        this.gateway.publishLogLines(accepted.map((a) => this.toLiveLine(inst, batch, a)));
      } catch (e) {
        this.log.warn(`No se pudo publicar en vivo: ${(e as Error)?.message ?? e}`);
      }
    }

    // ---- Origen y «visto por última vez»
    // Fallar aquí no justifica que el appender reenvíe el lote: es un dato de
    // pantalla y se refresca con el siguiente.
    try {
      await this.installations.touchSource(inst.id, batch.aplicativo, batch.servidor, batch.appenderVersion, receivedAt);
    } catch (e) {
      this.log.warn(`No se pudo actualizar el origen de la instalación ${inst.id}: ${(e as Error)?.message ?? e}`);
    }

    if (lokiDown || errorsFailed || inFlightDuplicate) {
      throw new ServiceUnavailableException({
        code: 'INGEST_UNAVAILABLE',
        message: 'El almacenamiento de logs no está disponible; reintente el mismo lote.',
      });
    }
    return { aceptados: accepted.length, descartadosPorNivel };
  }

  /**
   * RUC → id de cliente, consultando cada RUC distinto UNA vez por lote.
   *
   * Solo en instalaciones internas: en las de cliente el cliente sale de la
   * clave y un aplicativo no puede declararse de otro (spec, «Instalaciones»).
   * Un RUC sin el formato del alta ni se consulta; uno que no existe se queda
   * en `null` y el evento sigue como interno: el log nunca se pierde.
   */
  private async resolveRucs(inst: ResolvedInstallation, events: IngestEvent[]): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    if (inst.kind !== 'INTERNA') return out;
    for (const e of events) {
      const ruc = e.propiedades[RUC_PROPERTY]?.trim();
      if (!ruc || out.has(ruc)) continue;
      if (!RUC_FORMAT.test(ruc)) {
        out.set(ruc, null);
        continue;
      }
      try {
        const c = await this.clients.findByRuc(ruc);
        out.set(ruc, c ? Number(c.id) : null);
      } catch (e2) {
        // Sin cliente antes que perder el lote por una consulta auxiliar.
        this.log.warn(`No se pudo resolver un RUC: ${(e2 as Error)?.message ?? e2}`);
        out.set(ruc, null);
      }
    }
    return out;
  }

  private clientOf(inst: ResolvedInstallation, ev: IngestEvent, rucs: Map<string, number | null>): number | null {
    if (inst.kind !== 'INTERNA') return inst.clientId;
    const ruc = ev.propiedades[RUC_PROPERTY]?.trim();
    return ruc ? (rucs.get(ruc) ?? null) : null;
  }

  private labelsOf(inst: ResolvedInstallation, batch: IngestBatch, clientId: number | null, nivel: LogLevel): LokiLabels {
    return {
      instalacion: String(inst.id),
      cliente: clientId === null ? 'interno' : String(clientId),
      sistema: inst.systemId === null ? 'ninguno' : String(inst.systemId),
      aplicativo: batch.aplicativo,
      servidor: batch.servidor,
      nivel,
    };
  }

  /**
   * Exactamente UN stream por conjunto de etiquetas: el cliente de Loki
   * resuelve los ns repetidos dentro de cada stream, así que partir un mismo
   * conjunto en dos streams dejaría colisiones sin resolver.
   */
  private buildStreams(
    inst: ResolvedInstallation,
    batch: IngestBatch,
    accepted: AcceptedEvent[],
    receivedAt: Date,
  ): LokiStream[] {
    const byKey = new Map<string, LokiStream>();
    const add = (labels: LokiLabels, at: Date, line: string) => {
      const key = JSON.stringify([labels.instalacion, labels.cliente, labels.sistema, labels.aplicativo, labels.servidor, labels.nivel]);
      let s = byKey.get(key);
      if (!s) {
        s = { labels, entries: [] };
        byKey.set(key, s);
      }
      s.entries.push({ at, line });
    };

    for (const a of accepted) {
      const line: Record<string, unknown> = {
        logger: a.ev.logger,
        mensaje: a.ev.mensaje,
        excepcion: a.ev.excepcion,
        hilo: a.ev.hilo,
        propiedades: a.ev.propiedades,
      };
      // Review Focus 2: la hora se sustituyó; quien lea la línea debe saberlo.
      if (a.tsOriginal !== null) line.tsOriginal = a.tsOriginal;
      add(this.labelsOf(inst, batch, a.clientId, a.ev.nivel), a.at, JSON.stringify(line));
    }

    // Lo que el appender tiró por cola llena se dice en Loki, no en silencio.
    // Va aunque WARN quede por debajo del nivel mínimo: es una pérdida de datos
    // del propio canal, no un log del aplicativo, y es justo lo que hay que ver.
    if (batch.descartados > 0) {
      add(
        this.labelsOf(inst, batch, inst.kind === 'INTERNA' ? null : inst.clientId, 'WARN'),
        receivedAt,
        JSON.stringify({
          logger: DISCARD_LOGGER,
          mensaje: `El appender descartó ${batch.descartados} eventos por cola llena desde el envío anterior.`,
          excepcion: null,
          hilo: null,
          propiedades: {},
        }),
      );
    }
    return [...byKey.values()];
  }

  private toErrorEvent(inst: ResolvedInstallation, a: AcceptedEvent): ErrorEventInput {
    return {
      at: a.at,
      clientId: a.clientId,
      systemId: inst.systemId,
      nivel: a.ev.nivel,
      logger: a.ev.logger,
      mensaje: a.ev.mensaje,
      excepcion: a.ev.excepcion,
      hilo: a.ev.hilo,
      propiedades: a.ev.propiedades,
    };
  }

  private toLiveLine(inst: ResolvedInstallation, batch: IngestBatch, a: AcceptedEvent): LiveLogLine {
    return {
      ts: a.at.toISOString(),
      nivel: a.ev.nivel,
      instalacionId: inst.id,
      clienteId: a.clientId,
      sistemaId: inst.systemId,
      aplicativo: batch.aplicativo,
      servidor: batch.servidor,
      logger: a.ev.logger,
      mensaje: a.ev.mensaje,
      excepcion: a.ev.excepcion,
      hilo: a.ev.hilo,
    };
  }
}
