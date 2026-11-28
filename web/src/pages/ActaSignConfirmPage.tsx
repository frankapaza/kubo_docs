import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { actaSignPublicApi } from '../api/signatures.api';
import { KuboLogo } from '../components/ui/Icon';
import SignaturePad, { SignaturePadHandle } from '../components/SignaturePad';

/**
 * Confirmación de firma de acta desde el enlace del correo (sin sesión). La persona lee
 * el acta y confirma; el enlace es de un solo uso y vence a los 7 días.
 */
export default function ActaSignConfirmPage() {
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['acta-sign', token], queryFn: () => actaSignPublicApi.preview(token), retry: false });
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pad = useRef<SignaturePadHandle>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const png = q.data?.needsDrawing ? pad.current?.toDataUrl() ?? null : undefined;
      if (q.data?.needsDrawing && !png) {
        setError('Dibuja tu firma en el recuadro antes de confirmar.');
        return;
      }
      const r = await actaSignPublicApi.confirm(token, png ?? undefined);
      setDone(new Date(r.confirmedAt).toLocaleString('es-PE', { timeZone: 'America/Lima' }));
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      setError(msg ?? 'No se pudo confirmar. Intenta de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  const failMsg = (q.error as { response?: { data?: { message?: string } } } | null)?.response?.data?.message;

  return (
    <div className="min-h-screen bg-kubo-surface px-4 py-8">
      <div className="mx-auto max-w-2xl flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <KuboLogo size={32} />
          <span className="font-semibold text-slate-900">Kubo Platform</span>
        </div>

        {q.isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
        {q.isError && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {failMsg ?? 'El enlace no es válido o ya se usó.'}
          </div>
        )}

        {q.data && (
          <>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Confirmar el acta</h1>
              <p className="text-sm text-slate-600 mt-1">
                {q.data.signerName}, revisa el acta de <strong>{q.data.meetingTitle}</strong> y confirma si estás de acuerdo.
              </p>
            </div>
            <article className="rounded-xl border border-slate-200 bg-white p-5 text-sm leading-relaxed text-slate-800 whitespace-pre-wrap max-h-[60vh] overflow-y-auto">
              {q.data.actaMarkdown}
            </article>

            {done || q.data.status === 'CONFIRMADA' ? (
              <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                Confirmación registrada{done ? ` (${done})` : ''}. Gracias.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {q.data.needsDrawing && (
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold text-slate-800">Tu firma</span>
                    <SignaturePad ref={pad} />
                  </div>
                )}
                {error && <div role="alert" className="text-sm text-red-700">{error}</div>}
                <button type="button" onClick={confirm} disabled={busy} className="h-12 rounded-xl bg-[#053777] text-white font-semibold disabled:opacity-60">
                  {busy ? 'Confirmando…' : q.data.needsDrawing ? 'Firmar y confirmar el acta' : 'Confirmo que estoy de acuerdo con el acta'}
                </button>
                <p className="text-xs text-slate-500">Si no estás de acuerdo, no confirmes y responde al correo para indicar qué cambiar.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
