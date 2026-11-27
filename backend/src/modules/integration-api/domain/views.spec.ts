import { toRequerimientoApiView, toTicketApiView } from './views';

const baseTicket: any = {
  id: '15', code: 'KB-0015', subject: 'No carga', descriptionMd: null, rawText: 'texto interno del equipo',
  origin: 'NOTE', createdByClientUserId: null, status: 'EN_ATENCION', priority: 'P2', systemId: '4',
  createdAt: new Date('2026-11-20T10:00:00Z'), updatedAt: new Date('2026-11-21T10:00:00Z'),
  resolvedAt: null, closedAt: null, slaResponseDueAt: new Date('2026-11-20T12:00:00Z'), slaResolutionDueAt: null,
  slaAtRisk: 1, assigneeUserId: 99, rootCause: 'interno',
};

describe('toTicketApiView', () => {
  it('lista blanca: campos en español, ids numéricos, SLA y prioridad; nada interno', () => {
    const v = toTicketApiView(baseTicket, new Map([[4, 'ERP']]));
    expect(v).toEqual({
      id: 15, codigo: 'KB-0015', asunto: 'No carga', descripcion: null, estado: 'EN_ATENCION', prioridad: 'P2',
      sistemaId: 4, sistema: 'ERP', creadoEn: '2026-11-20T10:00:00.000Z', actualizadoEn: '2026-11-21T10:00:00.000Z',
      resueltoEn: null, cerradoEn: null, venceRespuesta: '2026-11-20T12:00:00.000Z', venceResolucion: null, slaEnRiesgo: true,
    });
    expect(JSON.stringify(v)).not.toMatch(/interno|assignee|rootCause|99/);
  });

  it('la descripción sigue la regla del portal: el texto crudo solo si lo escribió el cliente en el portal', () => {
    expect(toTicketApiView({ ...baseTicket, origin: 'PORTAL', createdByClientUserId: 7, rawText: 'mi problema' }, new Map()).descripcion).toBe('mi problema');
    expect(toTicketApiView({ ...baseTicket, descriptionMd: 'elaborada' }, new Map()).descripcion).toBe('elaborada');
  });
});

describe('toRequerimientoApiView', () => {
  const w: any = {
    id: 3, code: 'RQ-0003', title: 'Reporte', descriptionMd: 'x', status: 'SOLICITADO', priority: 'MEDIA', clientSystemId: null,
    dueDate: null, closedAt: null, createdAt: new Date('2026-11-17T10:00:00Z'), updatedAt: new Date('2026-11-17T10:00:00Z'),
    requestType: 'CAMBIO', assigneeUserId: 5, labels: ['interno'],
  };
  it('antes de aceptarse no hay prioridad; estado con el nombre del portal y su código', () => {
    const v = toRequerimientoApiView(w);
    expect(v).toMatchObject({ estado: 'Solicitado', estadoCodigo: 'SOLICITADO', prioridad: null, motivoRechazo: null, preguntaPendiente: null, tipo: 'CAMBIO' });
    expect(JSON.stringify(v)).not.toMatch(/interno|assignee/);
  });
  it('aceptado: prioridad y fecha comprometida; el detalle aporta el motivo de rechazo del portal', () => {
    expect(toRequerimientoApiView({ ...w, status: 'EN_PROCESO', dueDate: '2026-12-15' })).toMatchObject({ prioridad: 'MEDIA', fechaComprometida: '2026-12-15', estado: 'En desarrollo' });
    const portal: any = { rejectionReason: 'Fuera de alcance', pendingQuestion: null };
    expect(toRequerimientoApiView({ ...w, status: 'RECHAZADO' }, portal).motivoRechazo).toBe('Fuera de alcance');
  });
});
