import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { signatureApi } from '../api/documents.api';
import { MarkdownPreview } from '../components/MarkdownPreview';

export default function SignaturePage() {
  const { token } = useParams<{ token: string }>();
  const [confirmed, setConfirmed] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['sign', token],
    queryFn: () => signatureApi.getByToken(token!),
    enabled: !!token,
    retry: false,
  });

  const confirm = useMutation({
    mutationFn: () => signatureApi.confirm(token!),
    onSuccess: () => setConfirmed(true),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <p className="text-slate-500 text-sm">Cargando documento…</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl shadow-md p-8 max-w-md w-full text-center">
          <div className="text-5xl mb-4">🔗</div>
          <h1 className="text-xl font-bold text-slate-800 mb-2">Link no válido</h1>
          <p className="text-slate-500 text-sm">
            Este enlace de firma no existe o ya no está disponible. Solicita uno nuevo.
          </p>
        </div>
      </div>
    );
  }

  if (data.expired) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl shadow-md p-8 max-w-md w-full text-center">
          <div className="text-5xl mb-4">⏰</div>
          <h1 className="text-xl font-bold text-slate-800 mb-2">Link expirado</h1>
          <p className="text-slate-500 text-sm">
            Este enlace de firma ya expiró. Contacta al emisor del documento para que te envíe uno
            nuevo.
          </p>
        </div>
      </div>
    );
  }

  if (confirmed || data.alreadySigned) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl shadow-md p-8 max-w-md w-full text-center">
          <div className="text-5xl mb-4">✅</div>
          <h1 className="text-xl font-bold text-slate-800 mb-2">Firma registrada</h1>
          <p className="text-slate-500 text-sm">
            Tu conformidad con el documento <strong>"{data.documentTitle}"</strong> ha sido
            registrada correctamente.
          </p>
          {data.signedAt && (
            <p className="text-xs text-slate-400 mt-2">
              Firmado el{' '}
              {new Date(data.signedAt).toLocaleString('es-PE', { dateStyle: 'long', timeStyle: 'short' })}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-200">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-lg font-bold">K</span>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Solicitud de firma electrónica
              </p>
              <h1 className="text-xl font-bold text-slate-900">{data.documentTitle}</h1>
              <p className="text-sm text-slate-500 mt-1">
                Estimado/a <strong>{data.signatoryName}</strong>, revisa el contenido del documento y
                confirma tu conformidad al final de la página.
              </p>
            </div>
          </div>
        </div>

        {/* Documento */}
        <div className="bg-white rounded-xl shadow-sm p-8 border border-slate-200">
          <MarkdownPreview source={data.documentMarkdown} />
        </div>

        {/* Acción de firma */}
        <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-200">
          <h2 className="text-base font-semibold text-slate-800 mb-1">Confirmar conformidad</h2>
          <p className="text-sm text-slate-500 mb-4">
            Al hacer clic en el botón confirmas que has leído y estás de acuerdo con el contenido
            del documento. Se registrará tu dirección IP como evidencia.
          </p>
          {confirm.isError && (
            <p className="text-sm text-red-500 mb-3">
              Ocurrió un error al registrar la firma. Intenta nuevamente.
            </p>
          )}
          <button
            onClick={() => confirm.mutate()}
            disabled={confirm.isPending}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold text-sm transition"
          >
            {confirm.isPending ? 'Registrando…' : '✍️ Confirmar y firmar documento'}
          </button>
        </div>

        <p className="text-center text-xs text-slate-400 pb-4">
          Kubo Soluciones — Plataforma de documentación
        </p>
      </div>
    </div>
  );
}
