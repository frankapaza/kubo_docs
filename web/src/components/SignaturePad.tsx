import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

export interface SignaturePadHandle {
  /** PNG del trazo (fondo blanco), o null si está vacío. */
  toDataUrl: () => string | null;
  clear: () => void;
  isEmpty: () => boolean;
}

/**
 * Firma con el dedo, el mouse o el Apple Pencil (pointer events; el grosor sigue la
 * presión del lápiz). `touch-action: none` evita que el iPad desplace la página mientras
 * se firma. El lienzo se dibuja a la densidad de la pantalla para que el trazo sea nítido.
 */
const SignaturePad = forwardRef<SignaturePadHandle, { height?: number; onChange?: (empty: boolean) => void }>(
  function SignaturePad({ height = 180, onChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    /** Solo el primer dedo o lápiz dibuja: un segundo dedo no hace zigzag. */
    const activePointer = useRef<number | null>(null);
    const last = useRef<{ x: number; y: number } | null>(null);
    const [empty, setEmpty] = useState(true);

    const ctx = () => canvasRef.current?.getContext('2d') ?? null;

    const setup = useCallback(() => {
      const c = canvasRef.current;
      if (!c) return;
      const ratio = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      c.width = Math.round(w * ratio);
      c.height = Math.round(height * ratio);
      const g = c.getContext('2d');
      if (!g) return;
      g.scale(ratio, ratio);
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, height);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = '#0F2A3D';
      setEmpty(true);
      onChange?.(true);
    }, [height, onChange]);

    useEffect(() => {
      setup();
    }, [setup]);

    const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (activePointer.current !== null) return;
      activePointer.current = e.pointerId;
      e.currentTarget.setPointerCapture(e.pointerId);
      drawing.current = true;
      last.current = point(e);
    };
    const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawing.current || !last.current || e.pointerId !== activePointer.current) return;
      const g = ctx();
      if (!g) return;
      const p = point(e);
      const pressure = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
      g.lineWidth = 1.2 + pressure * 2.6;
      g.beginPath();
      g.moveTo(last.current.x, last.current.y);
      g.lineTo(p.x, p.y);
      g.stroke();
      last.current = p;
      if (empty) {
        setEmpty(false);
        onChange?.(false);
      }
    };
    const up = (e?: React.PointerEvent<HTMLCanvasElement>) => {
      if (e && activePointer.current !== null && e.pointerId !== activePointer.current) return;
      activePointer.current = null;
      drawing.current = false;
      last.current = null;
    };

    useImperativeHandle(ref, () => ({
      toDataUrl: () => (empty ? null : canvasRef.current?.toDataURL('image/png') ?? null),
      clear: setup,
      isEmpty: () => empty,
    }));

    return (
      <div className="flex flex-col gap-2">
        <canvas
          ref={canvasRef}
          aria-label="Área de firma: firme con el dedo, el mouse o el Apple Pencil"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={up}
          style={{ width: '100%', height, touchAction: 'none', border: '2px dashed #c5ceda', borderRadius: 12, background: '#fff', cursor: 'crosshair' }}
        />
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{empty ? 'Firme dentro del recuadro' : 'Firma registrada en el recuadro'}</span>
          <button type="button" onClick={setup} className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
            Borrar y volver a firmar
          </button>
        </div>
      </div>
    );
  },
);

export default SignaturePad;
