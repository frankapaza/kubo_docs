import { requerimientoCsvHeader, requerimientoCsvRow, resumenCsvRows, ticketCsvHeader, ticketCsvRow, toCsvBody } from './csv-views';

const t: any = {
  id: 15, codigo: 'KB-0015', asunto: '=SUMA(1)', descripcion: null, estado: 'EN_ATENCION', prioridad: 'P2', sistemaId: 4,
  sistema: 'ERP', creadoEn: '2026-11-20T10:00:00.000Z', actualizadoEn: '2026-11-21T10:00:00.000Z', resueltoEn: null,
  cerradoEn: null, venceRespuesta: null, venceResolucion: null, slaEnRiesgo: true,
};

describe('csv-views', () => {
  it('cabecera de tickets = campos de la vista JSON, en el mismo orden', () => {
    expect(ticketCsvHeader).toEqual(Object.keys(t));
  });
  it('fila: null vacío, booleano si/no, números como texto', () => {
    const row = ticketCsvRow(t);
    expect(row[ticketCsvHeader.indexOf('descripcion')]).toBe('');
    expect(row[ticketCsvHeader.indexOf('slaEnRiesgo')]).toBe('si');
    expect(row[0]).toBe('15');
  });
  it('el cuerpo lleva BOM, separador ; y neutraliza fórmulas', () => {
    const body = toCsvBody(ticketCsvHeader, [ticketCsvRow(t)]);
    expect(body.startsWith('﻿"id";"codigo"')).toBe(true);
    expect(body).toContain(`"'=SUMA(1)"`);
    expect(body.endsWith('\r\n')).toBe(true);
  });
  it('requerimientos: cabecera con estado y estadoCodigo', () => {
    const w: any = { id: 3, codigo: 'RQ-3', titulo: 't', descripcion: null, estado: 'Solicitado', estadoCodigo: 'SOLICITADO', prioridad: null, sistemaId: null, fechaComprometida: null, cerradoEn: null, creadoEn: 'x', actualizadoEn: 'y', motivoRechazo: null, preguntaPendiente: null, tipo: null };
    expect(requerimientoCsvHeader).toEqual(Object.keys(w));
    expect(requerimientoCsvRow(w)[5]).toBe('SOLICITADO');
  });
  it('resumen en tabla larga: abiertos y una fila por métrica y mes', () => {
    const rows = resumenCsvRows({
      abiertos: { porEstado: { NUEVO: 2 }, porPrioridad: { P1: 1 } },
      meses: [{
        mes: '2026-10',
        tickets: { recibidos: 5, resueltosEnMes: 3, pendientes: 2, cumplimientoRespuestaPct: 80, cumplimientoResolucionPct: null, resolucionMediaHoras: 4.5, resolucionMedianaHoras: 3 },
        requerimientos: { solicitados: 1, aceptados: 1, entregados: 0, rechazados: 0, cumplimientoCompromisoPct: null },
      }],
    });
    expect(rows).toContainEqual(['tickets_abiertos', 'estado:NUEVO', '', '2']);
    expect(rows).toContainEqual(['tickets_abiertos', 'prioridad:P1', '', '1']);
    expect(rows).toContainEqual(['tickets.recibidos', '', '2026-10', '5']);
    expect(rows).toContainEqual(['tickets.cumplimientoResolucionPct', '', '2026-10', '']);
    expect(rows).toContainEqual(['requerimientos.solicitados', '', '2026-10', '1']);
  });
});
