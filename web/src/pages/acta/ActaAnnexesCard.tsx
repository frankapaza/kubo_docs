import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ActaAnnex, actaAnnexesApi } from '../../api/acta-annexes.api';
import { useAuthedImage } from '../../lib/useAuthedImage';
import { toast } from '../../ui/Toast';

function Photo({ annex }: { annex: ActaAnnex }) {
  const url = useAuthedImage(annex.hasImage ? actaAnnexesApi.imagePath(annex.id) : null);
  if (!annex.hasImage) return null;
  return url ? (
    <img src={url} alt={annex.caption ?? `Anexo ${annex.position}`} className="w-full sm:w-56 h-40 object-cover rounded-lg border border-slate-200" />
  ) : (
    <div className="w-full sm:w-56 h-40 rounded-lg bg-slate-100 animate-pulse" aria-hidden="true" />
  );
}

/**
 * Evidencias del acta (spec 2026-11-28): varias fotos y/o textos que van al final del
 * PDF como «Anexos», solo si hay alguna. En iPad, «Tomar foto» abre la cámara.
 */
export default function ActaAnnexesCard({ actaId, readOnly }: { actaId: number; readOnly: boolean }) {
  const qc = useQueryClient();
  const key = ['acta-annexes', actaId];
  const { data: annexes = [] } = useQuery({ queryKey: key, queryFn: () => actaAnnexesApi.list(actaId) });
  const [busy, setBusy] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      await refresh();
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      toast.error(Array.isArray(msg) ? msg[0] : msg ?? 'No se pudo guardar la evidencia.');
    } finally {
      setBusy(false);
    }
  };

  const onFiles = (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    void run(async () => {
      for (const f of list) await actaAnnexesApi.create(actaId, { photo: f });
    }, list.length === 1 ? 'Foto agregada. Escribe qué muestra.' : `${list.length} fotos agregadas.`);
  };

  const move = (a: ActaAnnex, delta: number) => {
    const other = annexes.find((x) => x.position === a.position + delta);
    if (!other) return;
    void run(async () => {
      await actaAnnexesApi.update(a.id, { position: other.position });
      await actaAnnexesApi.update(other.id, { position: a.position });
    });
  };

  return (
    <section aria-label="Evidencias" className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h2 className="font-semibold text-slate-900">Evidencias</h2>
          <p className="text-xs text-slate-500">Fotos y textos al final del PDF como «Anexos», solo si agregas alguno.</p>
        </div>
        {!readOnly && (
          <>
            <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
            <input ref={gallery} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
            <button type="button" disabled={busy} onClick={() => camera.current?.click()} className="h-11 px-4 rounded-lg bg-[#053777] text-white text-sm font-semibold disabled:opacity-60">Tomar foto</button>
            <button type="button" disabled={busy} onClick={() => gallery.current?.click()} className="h-11 px-4 rounded-lg border border-slate-300 bg-white text-sm font-semibold">Elegir fotos</button>
            <button type="button" disabled={busy} onClick={() => run(() => actaAnnexesApi.create(actaId, { caption: 'Escribe aquí la evidencia.' }))} className="h-11 px-4 rounded-lg border border-slate-300 bg-white text-sm font-semibold">Solo texto</button>
          </>
        )}
      </div>

      {annexes.length === 0 ? (
        <p className="text-sm text-slate-400 italic">Sin evidencias: el PDF termina en las firmas.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {annexes.map((a, i) => (
            <li key={a.id} className="flex flex-col sm:flex-row gap-3 rounded-lg border border-slate-200 p-3">
              <Photo annex={a} />
              <div className="flex-1 min-w-0 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#053777]">Anexo {i + 1}</span>
                  <span className="text-xs text-slate-500">{a.hasImage ? 'Foto con texto' : 'Texto'}</span>
                  {!readOnly && (
                    <span className="ml-auto flex gap-1">
                      <button type="button" aria-label="Subir" disabled={busy || i === 0} onClick={() => move(a, -1)} className="h-9 w-9 rounded-md border border-slate-200 disabled:opacity-40">↑</button>
                      <button type="button" aria-label="Bajar" disabled={busy || i === annexes.length - 1} onClick={() => move(a, 1)} className="h-9 w-9 rounded-md border border-slate-200 disabled:opacity-40">↓</button>
                      <button type="button" disabled={busy} onClick={() => run(() => actaAnnexesApi.remove(a.id), 'Evidencia quitada.')} className="h-9 px-3 rounded-md border border-red-200 text-red-700 text-xs">Quitar</button>
                    </span>
                  )}
                </div>
                <textarea
                  aria-label={`Texto del anexo ${i + 1}`}
                  defaultValue={a.caption ?? ''}
                  readOnly={readOnly}
                  rows={3}
                  className="input"
                  onBlur={(e) => {
                    const v = e.target.value;
                    if (v !== (a.caption ?? '')) void run(() => actaAnnexesApi.update(a.id, { caption: v }));
                  }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
