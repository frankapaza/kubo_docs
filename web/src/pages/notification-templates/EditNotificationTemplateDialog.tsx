import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  AUDIENCE_LABELS,
  notificationTemplatesApi,
  triggerKeyLabel,
  type NotificationTemplate,
} from '../../api/notification-templates.api';
import { Button } from '../../components/ui/Button';
import { CheckIcon, EyeIcon, SendIcon, XIcon } from '../../components/ui/Icon';
import { toast } from '../../ui/Toast';
import { toErrorList } from './error-list';

interface Props {
  open: boolean;
  template: NotificationTemplate | null;
  onCancel: () => void;
}

type ActiveField = 'subject' | 'body';

/**
 * Edita una plantilla de aviso: asunto, cuerpo y activo/inactivo, con
 * catálogo de variables (el que trae la propia plantilla, nunca uno propio),
 * vista previa aislada en `iframe` y envío de una prueba al correo de quien
 * edita.
 *
 * No se cierra solo al guardar -- a diferencia de `EditClientUserDialog` --
 * porque el flujo natural aquí es "guardar, luego previsualizar o mandarse
 * una prueba" sin tener que reabrir el diálogo: `preview` y `sendTest` actúan
 * siempre sobre la última versión GUARDADA (el backend no acepta cuerpo en
 * esas dos rutas), así que hace falta poder guardar y probar en la misma
 * sesión.
 */
export default function EditNotificationTemplateDialog({ open, template, onCancel }: Props) {
  const qc = useQueryClient();

  const [subject, setSubject] = useState('');
  const [bodyMd, setBodyMd] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [activeField, setActiveField] = useState<ActiveField>('body');

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const save = useMutation({
    mutationFn: () => {
      if (!template) throw new Error('Sin plantilla seleccionada');
      return notificationTemplatesApi.update(template.id, { subject, bodyMd, isActive });
    },
    onSuccess: (updated) => {
      // Se actualiza la caché de la lista directamente con lo que devuelve el
      // PATCH, en vez de invalidar y esperar un refetch: así no hay carrera
      // entre "el guardado ya terminó" y "la lista ya se refrescó", y el
      // formulario se queda exactamente con lo que el backend confirmó.
      qc.setQueryData<NotificationTemplate[]>(['notification-templates'], (old) =>
        old ? old.map((t) => (t.id === updated.id ? updated : t)) : old,
      );
      setErrors([]);
      toast.success('Plantilla guardada');
    },
    onError: (e: unknown) => {
      // Fallo de escritura: se muestra dentro del propio diálogo, con el
      // texto que manda el backend tal cual -- distingue variable "del otro
      // público" de variable "que no existe", y aquí no se aplana a un
      // genérico "no se pudo guardar".
      setErrors(toErrorList(e));
    },
  });

  const preview = useMutation({
    mutationFn: () => {
      if (!template) throw new Error('Sin plantilla seleccionada');
      return notificationTemplatesApi.preview(template.id);
    },
    onError: (e: unknown) => toast.error(toErrorList(e)[0]),
  });

  const sendTest = useMutation({
    mutationFn: () => {
      if (!template) throw new Error('Sin plantilla seleccionada');
      return notificationTemplatesApi.sendTest(template.id);
    },
    onSuccess: (data) => toast.success(`Correo de prueba enviado a ${data.to}`),
    // El 429 del límite (3 por minuto) trae el mensaje en español ya armado
    // por `ApiThrottlerGuard` -- se muestra tal cual, no un error genérico.
    onError: (e: unknown) => toast.error(toErrorList(e)[0]),
  });

  // Repone el formulario cada vez que se abre el diálogo o cambia la
  // plantilla elegida -- no en cada re-render, para no pisar lo que el
  // usuario está escribiendo si la lista de fondo se refresca sola.
  useEffect(() => {
    if (!open || !template) return;
    setSubject(template.subject);
    setBodyMd(template.bodyMd);
    setIsActive(template.isActive);
    setErrors([]);
    setActiveField('body');
    preview.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template?.id]);

  // Cerrar con Escape, salvo que haya un guardado en vuelo: cerrar a medio
  // guardar no cancela la petición (ya salió), pero sí perdería de vista si
  // terminó bien o mal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !save.isPending) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onCancel, save.isPending]);

  if (!open || !template) return null;

  const insertVariable = (name: string) => {
    const token = `{{${name}}}`;
    if (activeField === 'subject') {
      const el = subjectRef.current;
      const start = el?.selectionStart ?? subject.length;
      const end = el?.selectionEnd ?? subject.length;
      const next = subject.slice(0, start) + token + subject.slice(end);
      setSubject(next);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(start + token.length, start + token.length);
      });
    } else {
      const el = bodyRef.current;
      const start = el?.selectionStart ?? bodyMd.length;
      const end = el?.selectionEnd ?? bodyMd.length;
      const next = bodyMd.slice(0, start) + token + bodyMd.slice(end);
      setBodyMd(next);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(start + token.length, start + token.length);
      });
    }
  };

  const closeIfIdle = () => {
    if (!save.isPending) onCancel();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-notification-template-title"
      onClick={closeIfIdle}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
      style={{ paddingTop: '4vh' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-pop"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="edit-notification-template-title" className="text-lg font-semibold text-slate-900">
              {triggerKeyLabel(template.triggerKey)}
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Aviso para <span className="font-medium text-slate-700">{AUDIENCE_LABELS[template.audience]}</span>
              {' — '}el público no se puede cambiar desde aquí.
            </p>
          </div>
          <button
            type="button"
            onClick={closeIfIdle}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            title="Cerrar"
          >
            <XIcon size={18} />
          </button>
        </div>

        {errors.length > 0 && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {errors.length === 1 ? (
              errors[0]
            ) : (
              <ul className="list-disc space-y-1 pl-5">
                {errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-4 space-y-4">
          <div>
            <label className="label" htmlFor="notif-template-subject">
              Asunto
            </label>
            <input
              id="notif-template-subject"
              ref={subjectRef}
              className="input"
              value={subject}
              onFocus={() => setActiveField('subject')}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div>
            <label className="label" htmlFor="notif-template-body">
              Cuerpo del correo
            </label>
            <textarea
              id="notif-template-body"
              ref={bodyRef}
              className="input font-mono text-xs h-48 resize-y"
              value={bodyMd}
              onFocus={() => setActiveField('body')}
              onChange={(e) => setBodyMd(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-400">
              El texto sale tal cual en el correo, sin sanear: se puede escribir HTML (un enlace, una
              negrita con <code className="bg-slate-100 px-1 rounded">**negrita**</code>).
            </p>
          </div>

          <div>
            <p className="label mb-1.5">
              Variables disponibles para {AUDIENCE_LABELS[template.audience].toLowerCase()}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {template.variables.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertVariable(v)}
                  className="font-mono text-xs px-2 py-1 rounded-md border border-slate-200 bg-slate-50 text-slate-700 hover:border-kubo-primary hover:text-kubo-primary transition"
                  title={`Insertar en ${activeField === 'subject' ? 'el asunto' : 'el cuerpo'}`}
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Se insertan en el campo con el que trabajaste último ({activeField === 'subject' ? 'asunto' : 'cuerpo'}).
            </p>
          </div>

          <label
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
              isActive ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/50'
            }`}
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <div className="text-sm">
              <p className="font-medium text-slate-800">Plantilla activa</p>
              <p className="text-xs text-slate-600 mt-0.5">
                {isActive
                  ? 'Este aviso se manda con normalidad cuando ocurra el evento correspondiente.'
                  : 'Desactivada: este aviso deja de enviarse por completo, sin tocar código. Es la forma de apagar un correo sin borrar la plantilla.'}
              </p>
            </div>
          </label>
        </div>

        <div className="mt-5 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<EyeIcon size={14} />}
              onClick={() => preview.mutate()}
              loading={preview.isPending}
            >
              Vista previa
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<SendIcon size={14} />}
              onClick={() => sendTest.mutate()}
              loading={sendTest.isPending}
            >
              Enviarme una prueba
            </Button>
            <span className="text-xs text-slate-400">
              Usan la última versión guardada, no lo que esté sin guardar aquí arriba. El envío de
              prueba está limitado a 3 por minuto.
            </span>
          </div>

          {preview.data && (
            <div className="mt-3 rounded-lg border border-slate-200 overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <span className="font-semibold text-slate-700">Asunto: </span>
                {preview.data.subject}
              </div>
              {/*
                `preview.data.html` NO está saneado (ver el comentario de
                `email-compose.ts` en el backend): una plantilla la escribe un
                ADMIN y puede llevar HTML crudo. Por eso va en un `iframe` con
                `sandbox=""` (sin scripts, sin same-origin, sin formularios) y
                nunca con `dangerouslySetInnerHTML` en este documento: así ese
                HTML corre aislado, no con los permisos del panel ni la sesión
                de quien lo está mirando.
              */}
              <iframe
                title="Vista previa del correo"
                sandbox=""
                srcDoc={preview.data.html}
                className="w-full h-64 bg-white"
              />
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={save.isPending}>
            Cerrar
          </Button>
          <Button
            type="button"
            variant="primary"
            icon={<CheckIcon size={14} />}
            onClick={() => save.mutate()}
            disabled={save.isPending}
            loading={save.isPending}
          >
            {save.isPending ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </div>
      </div>
    </div>
  );
}
