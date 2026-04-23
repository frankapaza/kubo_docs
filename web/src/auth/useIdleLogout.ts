import { useEffect, useRef } from 'react';

/**
 * Cierra la sesión del usuario después de N minutos de INACTIVIDAD.
 *
 * Sliding window: cualquier actividad del usuario (mouse, teclado, scroll, touch)
 * reinicia el contador. Si el usuario está interactuando, la sesión nunca expira.
 *
 * @param timeoutMinutes  minutos de inactividad. Si es 0 o null, el timer queda deshabilitado.
 * @param onIdle  callback que se dispara al expirar (típicamente logout).
 * @param onWarning  opcional: callback que se dispara cuando quedan `warningSeconds` antes de expirar.
 * @param warningSeconds  segundos antes del logout para mostrar aviso (default 30).
 */
export function useIdleLogout(
  timeoutMinutes: number | null | undefined,
  onIdle: () => void,
  options?: { onWarning?: () => void; warningSeconds?: number },
) {
  const timerRef = useRef<number | null>(null);
  const warningRef = useRef<number | null>(null);
  const onIdleRef = useRef(onIdle);
  const onWarningRef = useRef(options?.onWarning);
  const warningSecondsRef = useRef(options?.warningSeconds ?? 30);

  // Mantenemos los callbacks actualizados sin tener que re-registrar listeners
  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);
  useEffect(() => {
    onWarningRef.current = options?.onWarning;
    warningSecondsRef.current = options?.warningSeconds ?? 30;
  }, [options?.onWarning, options?.warningSeconds]);

  useEffect(() => {
    if (!timeoutMinutes || timeoutMinutes <= 0) return;

    const totalMs = timeoutMinutes * 60 * 1000;
    const warnMs = Math.max(totalMs - warningSecondsRef.current * 1000, totalMs - 1000);

    const clearTimers = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (warningRef.current !== null) {
        window.clearTimeout(warningRef.current);
        warningRef.current = null;
      }
    };

    const scheduleTimers = () => {
      clearTimers();
      if (onWarningRef.current && warnMs > 0) {
        warningRef.current = window.setTimeout(() => {
          onWarningRef.current?.();
        }, warnMs);
      }
      timerRef.current = window.setTimeout(() => {
        onIdleRef.current();
      }, totalMs);
    };

    // Throttle — evitamos reiniciar timers en CADA mousemove
    let lastReset = Date.now();
    const reset = () => {
      const now = Date.now();
      if (now - lastReset < 500) return;
      lastReset = now;
      scheduleTimers();
    };

    const events: (keyof DocumentEventMap)[] = [
      'mousedown',
      'mousemove',
      'keydown',
      'scroll',
      'touchstart',
      'click',
    ];
    events.forEach((ev) => document.addEventListener(ev, reset, { passive: true }));
    scheduleTimers();

    return () => {
      clearTimers();
      events.forEach((ev) => document.removeEventListener(ev, reset));
    };
  }, [timeoutMinutes]);
}
