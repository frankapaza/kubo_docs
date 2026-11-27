import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TicketsRepository } from '../tickets/tickets.repository';
import { AvailabilityIngestService, SyncResponse } from './availability-ingest.service';
import { MonitorIncident } from './entities/monitor-incident.entity';
import { MonitorProbe } from './entities/monitor-probe.entity';
import { ticketCodesForIncidents } from './incident-ticket-codes';

/**
 * `sync` de la sonda de la oficina con el código del ticket. Solo vive en
 * AvailabilityModule: el worker (kubo-01) no tiene TicketsModule y usa
 * `AvailabilityIngestService` a secas. El repositorio de tickets es obligatorio:
 * si falta, la aplicación no arranca (en vez de entregar `ticketCode` null).
 */
@Injectable()
export class AvailabilitySyncService {
  constructor(
    private readonly ingest: AvailabilityIngestService,
    @InjectRepository(MonitorIncident) private readonly incidents: Repository<MonitorIncident>,
    private readonly tickets: TicketsRepository,
  ) {}

  async sync(probe: MonitorProbe, configVersion: string | null): Promise<SyncResponse> {
    const res = await this.ingest.sync(probe, configVersion);
    const ids = [...new Set(res.state.map((r) => r.incidentId).filter((i): i is number => i !== null))];
    if (ids.length === 0) return res;
    const open = await this.incidents.find({ where: { id: In(ids) } });
    const codes = await ticketCodesForIncidents(this.incidents, this.tickets, open);
    for (const r of res.state) r.ticketCode = r.incidentId === null ? null : (codes.get(r.incidentId) ?? null);
    return res;
  }
}
