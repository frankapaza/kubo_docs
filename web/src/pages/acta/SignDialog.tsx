import { useRef, useState } from 'react';

import { signaturesApi } from '../../api/signatures.api';
import SignaturePad, { SignaturePadHandle } from '../../components/SignaturePad';
import { toast } from '../../ui/Toast';

type Mode = 'DRAW' | 'EMAIL' | 'BOTH' | 'REMOTE';

const MODES: Array<{ id: Mode; label: string; hint: string }> = [
  { id: 'DRAW', label: 'Dibujar en pantalla', hint: 'Firma con el dedo o el Apple Pencil, aquí mismo.' },
  { id: 'EMAIL', label: 'Confirmar por correo', hint: 'Le llega un enlace; la firma vale cuando confirma.' },
  { id: 'BOTH', label: 'Ambos', hint: 'Dibuja aquí y además confirma por correo.' },
  { id: 'REMOTE', label: 'Enlace para firmar a distancia', hint: 'Reunión por Meet: dibuja y confirma desde su dispositivo.' },
];

export interface SignDialogParticipant {
  id: number;
  fullName: string;
  email: string | null;
  documentNumber: string | null;
}

/**
 * Firma de un asistente: elige cómo firmar (dibujar, correo o ambos). Sin participante,
 * pide nombre y DNI y lo agrega a la reunión como asistente.
 */
export default function SignDialog({
  actaId,
  participant,
  onClose,
  onDone,
}: {
  actaId: number;
  participant: SignDialogParticipant | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<Mode>('DRAW');
  const [name, setName] = useState('');
  const [dni, setDni] = useState('');
  const [role, setRole] = useState('');
  const [email, setEmail] = useState(participant?.email ?? '');
  const [busy, setBusy] = useState(false);
  const pad = useRef<SignaturePadHandle>(null);

  const needsDraw = mode === 'DRAW' || mode === 'BOTH';
  const needsEmail = mode !== 'DRAW';

  const submit = async () => {
    const signer = participant
      ? { participantId: participant.id }
      : { signerName: name.trim(), signerDocument: dni.trim(), signerRole: role.trim() || undefined };
    if (!participant && (!name.trim() || !dni.trim())) {
      toast.error('Escribe el nombre y el DNI de quien firma.');
      return;
    }
    const png = needsDraw ? pad.current?.toDataUrl() ?? null : null;
    if (needsDraw && !png) {
      toast.error('Falta la firma en el recuadro.');
      return;
    }
    if (needsEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error('Escribe un correo válido para la confirmación.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'DRAW') {
        await signaturesApi.signInPerson(actaId, { ...signer, signaturePng: png! });
        toast.success('Firma registrada.');
      } else {
        await signaturesApi.signByEmail(actaId, { ...signer, mode, signerEmail: email.trim(), signaturePng: png ?? undefined });
        toast.success(`Enviamos el enlace de confirmación a ${email.trim()}.`);
      }
      onDone();
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      toast.error(Array.isArray(msg) ? msg[0] : msg ?? 'No se pudo registrar la firma.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Firmar acta" className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
      <div className="w-full sm:max-w-xl bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-5 flex flex-col gap-4 max-h-[95vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{participant ? `Firma de ${participant.fullName}` : 'Agregar asistente y firmar'}</h2>
            <p className="text-sm text-slate-500">Elige cómo firma esta persona.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="h-10 w-10 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">✕</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Cómo firma">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              onClick={() => setMode(m.id)}
              className={`text-left rounded-xl border px-3 py-2.5 min-h-[64px] ${mode === m.id ? 'border-[#053777] bg-[#eef3fb]' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
            >
              <span className="block text-sm font-semibold text-slate-900">{m.label}</span>
              <span className="block text-xs text-slate-500 mt-0.5">{m.hint}</span>
            </button>
          ))}
        </div>

        {!participant && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="text-sm sm:col-span-2">Nombre completo<input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={180} /></label>
            <label className="text-sm">DNI<input className="input mt-1" value={dni} onChange={(e) => setDni(e.target.value)} maxLength={40} inputMode="numeric" /></label>
            <label className="text-sm sm:col-span-3">Cargo o área (opcional)<input className="input mt-1" value={role} onChange={(e) => setRole(e.target.value)} maxLength={80} /></label>
          </div>
        )}

        {needsEmail && (
          <label className="text-sm">Correo para la confirmación
            <input className="input mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={180} placeholder="persona@empresa.pe" />
          </label>
        )}

        {needsDraw && <SignaturePad ref={pad} />}

        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="h-11 px-4 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700">Cancelar</button>
          <button type="button" onClick={submit} disabled={busy} className="h-11 px-5 rounded-lg bg-[#053777] text-white text-sm font-semibold disabled:opacity-60">
            {busy ? 'Guardando…' : mode === 'DRAW' ? 'Registrar firma' : mode === 'BOTH' ? 'Registrar y enviar enlace' : 'Enviar enlace'}
          </button>
        </div>
      </div>
    </div>
  );
}
