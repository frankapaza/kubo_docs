import { useState } from 'react';

import { availabilityApi, ImportPreview } from '../../api/availability.api';
import { toast } from '../../ui/Toast';
import { apiMessage, btn, btnPrimary, tableWrap, td, th } from './availability-ui';

/** Cabecera de la plantilla, con `;` (Excel en es-PE). */
export const TEMPLATE_HEADER = 'cliente;servidor;host;rol;proveedor;region;servicio;protocolo;destino;puerto;criticidad;umbral_ms;sistema';

const STATUS_TEXT = { NEW: 'Nueva', DUPLICATE: 'Duplicada', INVALID: 'Inválida' } as const;
const STATUS_COLOR = { NEW: '#1b6e3c', DUPLICATE: '#6d7577', INVALID: '#b3261e' } as const;

/** Lee el archivo como texto UTF-8 y quita el BOM si lo trae. */
async function readText(file: File): Promise<string> {
  const text = await file.text();
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Importación CSV del inventario: elegir archivo, vista previa por fila y confirmar. Solo ADMIN. */
export default function ImportCsvPanel({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [csv, setCsv] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | undefined) => {
    setPreview(null);
    setCsv(null);
    if (!file) return;
    setBusy(true);
    try {
      const text = await readText(file);
      setCsv(text);
      setPreview(await availabilityApi.importPreview(text));
    } catch (e) {
      toast.error(apiMessage(e, 'No se pudo leer el CSV.'));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!csv) return;
    setBusy(true);
    try {
      const r = await availabilityApi.importCommit(csv);
      toast.success(`Importado: ${r.createdServers} servidores y ${r.createdServices} servicios nuevos (${r.skipped} filas saltadas).`);
      onDone();
      onClose();
    } catch (e) {
      toast.error(apiMessage(e, 'No se pudo importar; no se creó nada.'));
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob(['﻿' + TEMPLATE_HEADER + '\r\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla-inventario.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section style={{ border: '1px solid #e6e9ea', borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Importar inventario desde CSV</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" style={btn} onClick={downloadTemplate}>Descargar plantilla</button>
          <button type="button" style={btn} onClick={onClose}>Cerrar</button>
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#6d7577' }}>
        Columnas obligatorias: cliente, servidor, host, servicio, protocolo y destino. Separador «;» o «,». Máximo 256 KB.
      </div>
      <input type="file" accept=".csv,text/csv" aria-label="Archivo CSV" disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />

      {preview && (
        <>
          <div style={{ fontSize: 13 }}>
            {preview.summary.new} nuevas, {preview.summary.duplicate} duplicadas (se saltan), {preview.summary.invalid} inválidas (se saltan).
          </div>
          <div style={tableWrap}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={th}>Línea</th><th style={th}>Estado</th><th style={th}>Servidor</th><th style={th}>Servicio</th><th style={th}>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line} style={{ borderTop: '1px solid #e6e9ea' }}>
                    <td style={td}>{r.line}</td>
                    <td style={{ ...td, color: STATUS_COLOR[r.status], fontWeight: 600 }}>{STATUS_TEXT[r.status]}</td>
                    <td style={td}>{r.data ? `${r.data.server.name} (${r.data.server.host})${r.serverAction === 'CREATE' ? ' · nuevo' : ''}` : '—'}</td>
                    <td style={td}>{r.data ? `${r.data.service.name} · ${r.data.service.protocol} ${r.data.service.target}${r.data.service.port ? `:${r.data.service.port}` : ''}` : '—'}</td>
                    <td style={td}>{r.errors.join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <button type="button" style={btnPrimary} disabled={busy || preview.summary.new === 0} onClick={commit}>
              Importar {preview.summary.new} filas nuevas
            </button>
          </div>
        </>
      )}
    </section>
  );
}
