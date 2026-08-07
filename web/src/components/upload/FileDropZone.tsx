import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import {
  ACCEPT_ATTRIBUTE,
  MAX_FILE_BYTES,
} from '../../api/attachment-rules.generated';
import { Button } from '../ui/Button';
import {
  ALLOWED_TYPES_SENTENCE,
  filesFromClipboard,
  humanMegabytes,
  humanSize,
  isPreviewableImage,
  screenFile,
  type PendingAttachment,
  type RejectedAttachment,
} from './attachment-screening';

/**
 * El selector de archivos que comparten el panel y el portal.
 *
 * Es uno solo a propósito: las dos superficies suben contra la misma criba del
 * servidor, y dos componentes gemelos son dos sitios donde arreglar el mismo
 * fallo (y uno que se olvida). Lo que cambia entre panel y portal --el cliente
 * de axios y, por tanto, la sesión-- no está aquí: este componente no sube
 * nada. Reúne los archivos y se los deja al formulario, que es quien sabe a qué
 * mensaje colgarlos una vez creado (el `messageId` va en la URL de la subida, y
 * no existe hasta que el mensaje se ha escrito).
 *
 * Las tres formas de aportar un archivo, las tres presentes:
 *
 * - **Arrastrar y soltar**, con un contador de profundidad para que el resalte
 *   no parpadee (ver `onDragEnter`).
 * - **Pegar con Ctrl+V**, poniéndole nombre con la fecha a las capturas, que
 *   llegan todas llamadas `image.png`.
 * - **Elegir con un botón**, que es lo que usa la mayoría. Un
 *   `<input type="file">` de verdad, disparado por un `<button>` de verdad:
 *   nunca un `<div>` con `onClick`, que no se puede enfocar con el teclado, no
 *   se anuncia como control y no responde a la barra espaciadora.
 *
 * Y un rechazo dice **por qué**, con el nombre del archivo delante: «Error» no
 * sirve de nada cuando alguien arrastró cinco y solo falló uno.
 */
export interface FileDropZoneProps {
  /** La lista, controlada por el formulario que envuelve a esto. */
  files: PendingAttachment[];
  onFilesChange: (files: PendingAttachment[]) => void;
  /** Verdadero mientras hay una petición en vuelo: no se toca la lista. */
  disabled?: boolean;
  /** Tope de archivos por mensaje. Es de interfaz, no del servidor. */
  maxFiles?: number;
  /**
   * Elemento adicional desde el que se acepta el Ctrl+V, típicamente el
   * `<textarea>` del mensaje: es donde el usuario tiene el cursor cuando pega
   * una captura, y ese elemento no está dentro de este componente.
   */
  pasteScope?: RefObject<HTMLElement | null>;
  /** Texto de ayuda propio de cada pantalla, si hace falta. */
  hint?: ReactNode;
  className?: string;
}

const DEFAULT_MAX_FILES = 10;

export function FileDropZone({
  files,
  onFilesChange,
  disabled = false,
  maxFiles = DEFAULT_MAX_FILES,
  pasteScope,
  hint,
  className = '',
}: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [rejections, setRejections] = useState<RejectedAttachment[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  const zoneRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Cuántos `dragenter` sin su `dragleave` llevamos.
   *
   * Sin esto, el resalte parpadea: arrastrar por encima de la zona dispara un
   * `dragleave` **cada vez que el puntero cruza al hijo de dentro** (el texto,
   * el botón, una miniatura), aunque el puntero no haya salido de la zona. Con
   * un booleano, cada uno de esos cruces la apaga y el siguiente `dragenter` la
   * vuelve a encender, varias veces por segundo. Contando entradas y salidas,
   * el resalte solo se apaga cuando de verdad se ha salido de todo.
   *
   * Va en un `ref` y no en el estado porque cambia varias veces por segundo
   * durante el arrastre y no debe provocar un renderizado por cada evento.
   */
  const dragDepth = useRef(0);

  // -------------------------------------------------------------------------
  // Vistas previas locales
  // -------------------------------------------------------------------------

  /**
   * Una URL de objeto por cada imagen todavía sin subir.
   *
   * La URL se saca **del propio `File`**, sin envolverlo en un `Blob` nuevo.
   * Envolverlo era copiar el fichero entero en memoria para acabar con el mismo
   * tipo que ya tenía: `PendingAttachment.mimeType` **es** `file.type`, porque
   * de ahí lo saca `screenFile` al comprobarlo contra la lista blanca. Con diez
   * ficheros de 10 MB eran 100 MB de copia, rehechos en cada cambio de la
   * lista, a cambio de nada. (De ahí que los `PendingAttachment` deban venir
   * siempre de `screenFile` y no construirse a mano.)
   *
   * La URL se usa solo como `src` de un `<img>`: nunca se navega a ella. Una
   * `blob:` hereda el origen de la aplicación y no arrastra ni
   * `Content-Disposition` ni `nosniff`, así que abrirla en una pestaña
   * ejecutaría en este dominio un archivo que sea a la vez imagen válida y
   * HTML válido.
   *
   * Se rehacen enteras en cada cambio de la lista en vez de llevar la cuenta de
   * cuáles sobreviven: la limpieza de este efecto revoca **todas** las que él
   * creó, así que no hay ninguna combinación de añadir y quitar que deje una
   * URL viva sin dueño. Son unos pocos archivos y crear una URL de objeto no
   * copia los bytes.
   */
  useEffect(() => {
    const created: Record<string, string> = {};
    for (const item of files) {
      if (!isPreviewableImage(item.mimeType)) continue;
      created[item.id] = URL.createObjectURL(item.file);
    }
    setPreviews(created);

    return () => {
      for (const url of Object.values(created)) URL.revokeObjectURL(url);
    };
  }, [files]);

  // -------------------------------------------------------------------------
  // Alta de archivos
  // -------------------------------------------------------------------------

  const addFiles = useCallback(
    (incoming: File[]) => {
      if (disabled || incoming.length === 0) return;

      const accepted: PendingAttachment[] = [];
      const refused: RejectedAttachment[] = [];
      let room = Math.max(0, maxFiles - files.length);

      for (const file of incoming) {
        const filename = file.name?.trim() || '(sin nombre)';

        // El tope de la interfaz se comprueba antes que nada: rechazar por
        // tipo un archivo que de todas formas no cabía sería contar dos
        // problemas cuando solo hay uno, y el que se puede arreglar es este.
        if (room === 0) {
          refused.push({
            id: `full-${filename}-${refused.length}-${Date.now()}`,
            filename,
            code: 'TOO_MANY_FILES',
            message: `No se añadió «${filename}»: solo se pueden adjuntar ${maxFiles} archivos por mensaje.`,
          });
          continue;
        }

        const result = screenFile(file);
        if (result.rejected) {
          refused.push(result.rejected);
          continue;
        }

        accepted.push(result.accepted);
        room -= 1;
      }

      // Los rechazos se acumulan: si alguien arrastra cinco y falla uno, ese
      // uno sigue en pantalla mientras los otros cuatro se ven en la lista.
      if (refused.length > 0) setRejections((current) => [...current, ...refused]);
      if (accepted.length > 0) onFilesChange([...files, ...accepted]);
    },
    [disabled, files, maxFiles, onFilesChange],
  );

  const removeFile = useCallback(
    (id: string) => {
      onFilesChange(files.filter((item) => item.id !== id));
    },
    [files, onFilesChange],
  );

  const dismissRejection = useCallback((id: string) => {
    setRejections((current) => current.filter((item) => item.id !== id));
  }, []);

  // -------------------------------------------------------------------------
  // Arrastrar y soltar
  // -------------------------------------------------------------------------

  /** ¿El arrastre trae archivos? Arrastrar texto seleccionado no debe encender nada. */
  const carriesFiles = (event: DragEvent<HTMLElement>) =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files');

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (disabled || !carriesFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (disabled || !carriesFiles(event)) return;
    // Sin este `preventDefault` en **cada** `dragover` el navegador no permite
    // soltar: su comportamiento por omisión es rechazar la zona.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    // A cero de golpe: al soltar no llega el `dragleave` que cerraría la
    // cuenta, y sin este reinicio la zona se quedaría resaltada para siempre.
    dragDepth.current = 0;
    setIsDragging(false);
    addFiles(Array.from(event.dataTransfer?.files ?? []));
  };

  // -------------------------------------------------------------------------
  // Pegar
  // -------------------------------------------------------------------------

  /**
   * El `paste` se escucha en el documento porque el elemento donde el usuario
   * tiene el cursor al pegar una captura casi nunca es este componente: es el
   * `<textarea>` del mensaje, que vive fuera y llega por `pasteScope`.
   *
   * Aun así no se acepta cualquier pegado de la página: solo los que ocurren
   * dentro de la zona, dentro del ámbito declarado, o con el foco en el propio
   * documento (nadie escribiendo en otro sitio). Sin ese filtro, pegar una
   * imagen en un buscador de la misma pantalla la adjuntaría al ticket.
   */
  useEffect(() => {
    if (disabled) return;

    const handler = (event: ClipboardEvent) => {
      const target = event.target as Node | null;
      const inZone = !!target && !!zoneRef.current?.contains(target);
      const inScope = !!target && !!pasteScope?.current?.contains(target);
      const nowhereInParticular = target === document.body || target === document.documentElement;
      if (!inZone && !inScope && !nowhereInParticular) return;

      const pasted = filesFromClipboard(event.clipboardData, new Date());
      if (pasted.length === 0) return;

      // Solo cuando de verdad hay archivos: así pegar texto en el textarea
      // sigue funcionando con normalidad.
      event.preventDefault();
      addFiles(pasted);
    };

    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [addFiles, disabled, pasteScope]);

  // -------------------------------------------------------------------------

  const zoneClasses = isDragging
    ? 'border-kubo-primary bg-kubo-primary/5'
    : 'border-slate-300 bg-slate-50/60';

  return (
    <div className={className}>
      <div
        ref={zoneRef}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        // Región, no control: aquí no hay ningún `onClick`. Lo que se pulsa es
        // el botón de abajo, que es un `<button>` y dispara el `<input>` real.
        role="group"
        aria-label="Archivos adjuntos"
        aria-disabled={disabled || undefined}
        data-dragging={isDragging || undefined}
        className={`rounded-xl border-2 border-dashed p-4 transition-colors ${zoneClasses} ${
          disabled ? 'opacity-60' : ''
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-600">
            <p className="font-medium text-slate-700">
              {isDragging ? 'Suelta aquí los archivos' : 'Arrastra archivos, pégalos con Ctrl+V o elígelos'}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              Se aceptan archivos {ALLOWED_TYPES_SENTENCE}, hasta{' '}
              {humanMegabytes(MAX_FILE_BYTES)} por archivo y {maxFiles} por mensaje.
            </p>
            {hint}
          </div>

          <div>
            {/*
              El input real. Está oculto y fuera del recorrido del tabulador
              para no dejar dos paradas de teclado sobre la misma acción: quien
              navega con el teclado llega al botón de al lado, que lo dispara.
              Oculto sigue siendo un `<input type="file">` de verdad, con su
              diálogo nativo, su `accept` y su `multiple`.
            */}
            <input
              ref={inputRef}
              type="file"
              // El `name` no lo usa nadie --el `FormData` de la subida se
              // construye a mano, con la clave `file` que espera el backend--,
              // pero sin él Chrome levanta el aviso «a form field element
              // should have an id or name attribute» en la consola, y un aviso
              // permanente es un aviso que se deja de leer.
              name="attachments"
              multiple
              accept={ACCEPT_ATTRIBUTE}
              tabIndex={-1}
              className="hidden"
              disabled={disabled}
              onChange={(event) => {
                addFiles(Array.from(event.target.files ?? []));
                // Se limpia para que elegir **el mismo archivo** otra vez
                // vuelva a disparar `change`: si no, el segundo intento no
                // produce ningún evento y parece que la aplicación se ha
                // quedado colgada.
                event.target.value = '';
              }}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
            >
              Elegir archivos
            </Button>
          </div>
        </div>

        {files.length > 0 && (
          <ul className="mt-4 space-y-2">
            {files.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2"
              >
                {previews[item.id] ? (
                  <img
                    src={previews[item.id]}
                    alt={item.file.name}
                    className="h-12 w-12 flex-shrink-0 rounded object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] font-semibold text-slate-500"
                  >
                    PDF
                  </span>
                )}

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-700">{item.file.name}</span>
                  <span className="block text-xs text-slate-500">{humanSize(item.file.size)}</span>
                </span>

                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removeFile(item.id)}
                  className="rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-red-600 disabled:opacity-50"
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {rejections.length > 0 && (
        <ul className="mt-2 space-y-1">
          {rejections.map((rejection) => (
            <li
              key={rejection.id}
              role="alert"
              data-error-code={rejection.code}
              className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
            >
              <span className="flex-1">{rejection.message}</span>
              <button
                type="button"
                onClick={() => dismissRejection(rejection.id)}
                aria-label={`Descartar el aviso de ${rejection.filename}`}
                className="rounded px-1 font-semibold text-red-500 hover:bg-red-100"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export type { PendingAttachment, RejectedAttachment };
