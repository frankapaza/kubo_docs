import { useEffect, useRef, useState } from 'react';

import {
  clientUsersBulkApi,
  type BulkReviewResult,
  type BulkRowVerdict,
  type BulkSendOutcome,
  type BulkSendResult,
} from '../../api/client-users-bulk.api';
import { Button } from '../../components/ui/Button';
import { toast } from '../../ui/Toast';
import { toErrorList } from './error-list';

interface Props {
  open: boolean;
  /** Cliente elegido en la página; `null` mientras no haya ninguno. */
  clientId: number | null;
  clientName: string;
  onCancel: () => void;
  /**
   * Se llama justo después del envío, con el diálogo todavía abierto: la
   * página refresca el listado en segundo plano mientras el diálogo enseña el
   * informe. No lo cierra: eso lo decide quien lo lee.
   */
  onSent: () => void;
}

const VERDICT_LABEL: Record<BulkRowVerdict, string> = {
  SE_INVITARA: 'Se invitará',
  SE_REINVITARA: 'Enlace nuevo',
  RECHAZADA: 'No se invitará',
};

const VERDICT_CLASS: Record<BulkRowVerdict, string> = {
  SE_INVITARA: 'text-emerald-700',
  SE_REINVITARA: 'text-amber-700',
  RECHAZADA: 'text-red-700',
};

const OUTCOME_LABEL: Record<BulkSendOutcome, string> = {
  INVITADA: 'Invitada',
  INVITADA_SIN_CORREO: 'Invitada, sin correo',
  OMITIDA: 'Omitida',
  FALLO: 'Falló',
};

const OUTCOME_CLASS: Record<BulkSendOutcome, string> = {
  INVITADA: 'text-emerald-700',
  INVITADA_SIN_CORREO: 'text-amber-700',
  OMITIDA: 'text-slate-500',
  FALLO: 'text-red-700',
};

/**
 * Una fila del informe copiable. Los motivos son los del servidor, **tal cual**:
 * están redactados para poder mandarse al cliente y corregir su hoja. Aquí solo
 * se les pone al lado el número de fila, el nombre y el correo.
 */
function reportLine(
  line: number,
  fullName: string,
  email: string,
  label: string,
  reason: string | null,
): string {
  const quien = [fullName, email].filter((s) => s !== '').join(' · ') || '(fila vacía)';
  return `Fila ${line} — ${quien} — ${label}${reason ? `: ${reason}` : ''}`;
}

function reviewReport(clientName: string, r: BulkReviewResult): string {
  return [
    `Revisión de la carga masiva — ${clientName}`,
    `Se invitará a ${r.totals.willInvite + r.totals.willReinvite}; quedan fuera ${r.totals.rejected}.`,
    '',
    ...r.rows.map((f) => reportLine(f.line, f.fullName, f.email, VERDICT_LABEL[f.verdict], f.reason)),
  ].join('\n');
}

function sendReport(clientName: string, r: BulkSendResult): string {
  return [
    `Resultado de la carga masiva — ${clientName}`,
    `Invitadas ${r.totals.invited}; sin correo ${r.totals.invitedWithoutEmail}; omitidas ${r.totals.skipped}; fallidas ${r.totals.failed}.`,
    '',
    ...r.rows.map((f) => reportLine(f.line, f.fullName, f.email, OUTCOME_LABEL[f.outcome], f.reason)),
  ].join('\n');
}

async function copyReport(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Informe copiado al portapapeles');
  } catch (e) {
    console.error('[BulkInviteDialog] No se pudo copiar al portapapeles.', e);
    toast.error('No se pudo copiar el informe. Selecciónalo y cópialo a mano.');
  }
}

export default function BulkInviteDialog({ open, clientId, clientName, onCancel, onSent }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [review, setReview] = useState<BulkReviewResult | null>(null);
  const [result, setResult] = useState<BulkSendResult | null>(null);
  const [busy, setBusy] = useState(false);
  // Lista y no cadena: un 400 puede traer varios motivos a la vez.
  const [errors, setErrors] = useState<string[]>([]);

  /** Corta el camino tardío tras desmontar. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * Freno **síncrono** al doble clic en «Enviar», marcado antes de cualquier
   * `await`. `busy` es estado y no se ha comprometido cuando llega el segundo
   * clic. Confirmar dos veces manda correos de más y mata el enlace del
   * primero. Mismo patrón que `InvitePortalUserDialog`.
   */
  const sending = useRef(false);
  /** Ídem para la revisión: dos subidas a la vez dejarían ganar a la que llegue última. */
  const reviewing = useRef(false);

  // Se resetea en cada apertura y se mantiene montado para no perder el
  // listener de Escape entre aperturas: mismo patrón que NewClientUserDialog.
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setReview(null);
    setResult(null);
    setBusy(false);
    setErrors([]);
    sending.current = false;
    reviewing.current = false;
  }, [open]);

  // No se cierra mientras algo va en vuelo: cerrar durante el envío ocultaría
  // el informe de unos correos que sí van a salir.
  const dismiss = () => {
    if (busy) return;
    onCancel();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // `busy` y `onCancel` son los que mira `dismiss`.
  }, [open, busy, onCancel]);

  if (!open) return null;

  const descargar = async () => {
    setErrors([]);
    try {
      await clientUsersBulkApi.downloadTemplate();
    } catch (e) {
      if (alive.current) setErrors(toErrorList(e));
    }
  };

  const revisar = async () => {
    if (reviewing.current || sending.current) return;
    if (!file || clientId === null) return;
    reviewing.current = true;
    setBusy(true);
    setErrors([]);
    try {
      const r = await clientUsersBulkApi.review(clientId, file);
      if (alive.current) setReview(r);
    } catch (e) {
      if (alive.current) {
        setReview(null);
        setErrors(toErrorList(e));
      }
    } finally {
      reviewing.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const enviar = async () => {
    // La guarda, antes que nada y sin ningún `await` por delante.
    if (sending.current || reviewing.current) return;
    if (!review || review.revision === '') return;
    sending.current = true;
    setBusy(true);
    setErrors([]);
    try {
      // Verbatim los dos, tal como llegaron. Reconstruirlos rompería la firma.
      const r = await clientUsersBulkApi.send(review.clientId, review.revision, review.mac);
      if (!alive.current) return;
      setResult(r);
      setReview(null);
      onSent();
      toast.success(`${r.totals.invited} invitaciones enviadas`);
    } catch (e: any) {
      if (!alive.current) return;
      const list = toErrorList(e);
      // Sin respuesta del servidor no se sabe si salieron o no: no se deja al
      // operador creer que no, porque reintentar mandaría correos de más.
      if (!e?.response) {
        list.push(
          'No se sabe si los correos llegaron a salir. Antes de repetir, mira el listado de usuarios.',
        );
      }
      setErrors(list);
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const invitables = review ? review.totals.willInvite + review.totals.willReinvite : 0;
  const hayQueConfirmar = !!review && review.revision !== '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-invite-title"
      onClick={dismiss}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
      style={{ paddingTop: '6vh' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-pop"
      >
        <div className="space-y-5">
          <div>
            <h2 id="bulk-invite-title" className="text-lg font-semibold text-slate-900">
              Carga masiva de usuarios
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              <span className="font-medium text-slate-700">{clientName}</span>. Se crean{' '}
              <strong>invitaciones</strong>, no contraseñas: cada persona elige la suya desde el
              enlace que recibe. La carga no crea administradores; a quien deba serlo se le
              asciende después con «Editar», y solo cuando ya haya aceptado.
            </p>
          </div>

          {errors.length > 0 && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {errors.length === 1 ? (
                errors[0]
              ) : (
                <ul className="list-disc space-y-1 pl-5">
                  {errors.map((message, i) => (
                    <li key={i}>{message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Pasos 1 y 2: plantilla y archivo. Siguen visibles durante la
              revisión, para poder corregir y volver a subir sin cerrar. */}
          {!result && (
            <div className="space-y-3 rounded-lg border border-slate-200 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="secondary" size="sm" onClick={descargar}>
                  Descargar plantilla
                </Button>
                <span className="text-xs text-slate-500">
                  Viene vacía a propósito; las instrucciones están en su segunda hoja.
                </span>
              </div>
              <input
                type="file"
                className="block w-full text-sm"
                disabled={busy}
                // Sugerencia para el selector de archivos, nada más: quien
                // decide qué es el archivo es el servidor, por sus bytes.
                accept=".xlsx,.csv,.txt"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setReview(null);
                  setErrors([]);
                }}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={revisar}
                  disabled={!file || busy || clientId === null}
                  loading={busy && !review}
                >
                  {busy && !review ? 'Revisando…' : review ? 'Volver a revisar' : 'Revisar el archivo'}
                </Button>
                <span className="text-xs text-slate-500">
                  Revisar <strong>no manda ningún correo</strong>: solo te enseña qué pasaría con
                  cada fila. Todavía estás a tiempo de cambiar el archivo.
                </span>
              </div>
            </div>
          )}

          {review && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="text-sm text-slate-700">
                  De {review.rows.length} filas, se invitará a <strong>{invitables}</strong>
                  {review.totals.rejected > 0 && (
                    <>
                      {' '}
                      y quedarán fuera <strong>{review.totals.rejected}</strong>
                    </>
                  )}
                  . <strong>Todavía no se ha mandado ningún correo.</strong>
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => copyReport(reviewReport(clientName, review))}
                >
                  Copiar el informe
                </Button>
              </div>

              {review.totals.willReinvite > 0 && (
                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                  {review.totals.willReinvite} de estas personas ya tienen una invitación
                  pendiente. Recibirán un <strong>enlace nuevo</strong>, y el que ya se les mandó{' '}
                  <strong>dejará de funcionar</strong>.
                </p>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold text-slate-500 uppercase border-b border-slate-100">
                      <th className="py-2 pr-3">Fila</th>
                      <th className="py-2 pr-3">Nombre</th>
                      <th className="py-2 pr-3">Correo</th>
                      <th className="py-2">Qué pasará</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {review.rows.map((f) => (
                      <tr key={f.line} className="align-top">
                        <td className="py-2 pr-3 text-slate-400">{f.line}</td>
                        <td className="py-2 pr-3 break-words">{f.fullName || '—'}</td>
                        <td className="py-2 pr-3 text-slate-600 break-all">{f.email || '—'}</td>
                        <td className={`py-2 ${VERDICT_CLASS[f.verdict]}`}>
                          {VERDICT_LABEL[f.verdict]}
                          {f.reason && (
                            <span className="block text-xs text-slate-500 break-words">{f.reason}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!hayQueConfirmar && (
                <p className="text-sm text-slate-500">
                  No hay ninguna fila que se pueda invitar. Corrige el archivo y vuelve a subirlo.
                </p>
              )}
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="text-sm text-slate-700">
                  Invitadas <strong>{result.totals.invited}</strong>. Invitadas pero sin correo{' '}
                  <strong>{result.totals.invitedWithoutEmail}</strong>. Omitidas{' '}
                  <strong>{result.totals.skipped}</strong>. Fallidas{' '}
                  <strong>{result.totals.failed}</strong>.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => copyReport(sendReport(clientName, result))}
                >
                  Copiar el informe
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold text-slate-500 uppercase border-b border-slate-100">
                      <th className="py-2 pr-3">Fila</th>
                      <th className="py-2 pr-3">Nombre</th>
                      <th className="py-2 pr-3">Correo</th>
                      <th className="py-2">Resultado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.rows.map((f) => (
                      <tr key={f.line} className="align-top">
                        <td className="py-2 pr-3 text-slate-400">{f.line}</td>
                        <td className="py-2 pr-3 break-words">{f.fullName || '—'}</td>
                        <td className="py-2 pr-3 text-slate-600 break-all">{f.email || '—'}</td>
                        <td className={`py-2 ${OUTCOME_CLASS[f.outcome]}`}>
                          {OUTCOME_LABEL[f.outcome]}
                          {f.reason && (
                            <span className="block text-xs text-slate-500 break-words">{f.reason}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Paso 3: confirmar. Aparte y con su propio recuadro, para que no se
              confunda con «Revisar»: este es el que manda los correos. */}
          {hayQueConfirmar && review && !result && (
            <div className="space-y-3 rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
              <p className="text-sm text-amber-900">
                <strong>Aquí sí salen los correos</strong>, y no se pueden recoger. Esta revisión
                vale solo hasta las <strong>{review.expiresAtLabel}</strong> (hora de Lima); pasada
                esa hora habrá que volver a subir el archivo.
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="secondary" onClick={dismiss} disabled={busy}>
                  Cancelar
                </Button>
                <Button type="button" variant="primary" onClick={enviar} disabled={busy} loading={busy}>
                  {busy
                    ? 'Enviando…'
                    : `Enviar ${invitables} ${invitables === 1 ? 'invitación' : 'invitaciones'} ahora`}
                </Button>
              </div>
            </div>
          )}

          {(!hayQueConfirmar || result) && (
            <div className="flex justify-end">
              <Button type="button" variant="secondary" onClick={dismiss} disabled={busy}>
                {result ? 'Cerrar' : 'Cancelar'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
