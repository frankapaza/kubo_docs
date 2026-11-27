import { useRef, useState } from 'react';

import { portalApi } from '../../api/portal.api';

/** Lo mismo que acepta el servidor (se decide por los bytes; aquí solo se avisa antes). */
const ACCEPT = '.pdf,.docx,.png,.jpg,.jpeg,.webp,.gif';
const OK_EXT = /\.(pdf|docx|png|jpe?g|webp|gif)$/i;
export const MAX_FILE_MB = 15;
const MAX_FILES = 10;

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Sube los archivos uno por uno a un requerimiento ya creado. Devuelve los que
 * fallaron con su motivo, para avisar sin perder los que sí entraron.
 */
export async function uploadRequirementFiles(
  requirementId: number,
  files: File[],
): Promise<Array<{ name: string; reason: string }>> {
  const failed: Array<{ name: string; reason: string }> = [];
  for (const f of files) {
    try {
      await portalApi.uploadRequirementAttachment(requirementId, f);
    } catch (e: any) {
      failed.push({ name: f.name, reason: e?.response?.data?.message ?? 'no se pudo subir' });
    }
  }
  return failed;
}

interface Props {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  id: string;
}

/**
 * Elegir o arrastrar capturas, Word o PDF. Solo arma la lista: la subida se
 * hace después, cuando el requerimiento ya existe (`uploadRequirementFiles`).
 */
export default function RequirementFilePicker({ files, onChange, disabled, id }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const add = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    const skipped: string[] = [];
    for (const f of Array.from(list)) {
      if (!OK_EXT.test(f.name)) skipped.push(`${f.name} (tipo no admitido)`);
      else if (f.size > MAX_FILE_MB * 1024 * 1024) skipped.push(`${f.name} (supera ${MAX_FILE_MB} MB)`);
      else if (next.length >= MAX_FILES) skipped.push(`${f.name} (máximo ${MAX_FILES} a la vez)`);
      else if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    setWarning(skipped.length ? `No se agregaron: ${skipped.join(', ')}.` : null);
    onChange(next);
  };

  return (
    <div>
      <span className="label">Capturas o documentos (opcional)</span>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!disabled) add(e.dataTransfer.files);
        }}
        className={`rounded-lg border-2 border-dashed px-4 py-4 text-center text-sm transition ${
          drag ? 'border-kubo-primary bg-kubo-primary-light' : 'border-slate-300 bg-slate-50'
        }`}
      >
        <p className="text-slate-600">
          Arrastra aquí capturas de pantalla, Word o PDF, o{' '}
          <button
            type="button"
            className="font-semibold text-kubo-primary underline disabled:opacity-50"
            onClick={() => input.current?.click()}
            disabled={disabled}
          >
            elígelos
          </button>
          .
        </p>
        <p className="mt-1 text-xs text-slate-500">PDF, Word (.docx) o imágenes · hasta {MAX_FILE_MB} MB cada uno</p>
        <input
          ref={input}
          id={id}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          disabled={disabled}
          onChange={(e) => {
            add(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {warning && <p className="mt-1 text-xs text-amber-700">{warning}</p>}
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${f.size}`}
              className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm"
            >
              <span className="truncate text-slate-700">
                {f.name} <span className="text-xs text-slate-400">· {formatSize(f.size)}</span>
              </span>
              <button
                type="button"
                className="text-xs text-slate-500 hover:text-red-600"
                disabled={disabled}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                aria-label={`Quitar ${f.name}`}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
