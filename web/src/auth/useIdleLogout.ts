import { useEffect, useRef } from 'react';

/** Última actividad del usuario en cualquier pestaña del panel (epoch ms). */
const LAST_ACTIVITY_KEY = 'kubo.lastActivity';

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
    // Cuánto antes del cierre se avisa. Nunca más de la mitad del plazo: con un
    // plazo de 1 min, avisar a los 30 s de 60 tiene sentido; avisar "30 s antes"
    // de un plazo de 20 s no.
    const warnBeforeMs = Math.min(warningSecondsRef.current * 1000, totalMs / 2);

    // La actividad se comparte entre pestañas por localStorage. Sin esto, una
    // pestaña quieta (la bandeja abierta de fondo) cerraba la sesión a los N
    // minutos aunque se estuviera trabajando en otra, y como cerrar sesión
    // borra el token compartido, sacaba también a la pestaña en uso.
    const readLastActivity = (): number => {
      try {
        const v = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
        return Number.isFinite(v) && v > 0 ? v : Date.now();
      } catch {
        return Date.now();
      }
    };
    const markActivity = () => {
      try {
        localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
      } catch {
        // Sin almacenamiento (modo privado estricto): cada pestaña cuenta sola.
      }
    };

    let warned = false;

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

    // Un solo temporizador que, al vencer, vuelve a mirar la última actividad
    // compartida antes de decidir: si otra pestaña tuvo actividad mientras
    // tanto, se reprograma en vez de cerrar.
    const check = () => {
      clearTimers();
      const idle = Date.now() - readLastActivity();
      if (idle >= totalMs) {
        onIdleRef.current();
        return;
      }
      const warnAt = totalMs - warnBeforeMs;
      if (idle >= warnAt && !warned && onWarningRef.current) {
        warned = true;
        onWarningRef.current();
      }
      const next = idle < warnAt ? warnAt - idle : totalMs - idle;
      timerRef.current = window.setTimeout(check, Math.max(next, 250));
    };

    const scheduleTimers = () => {
      warned = false;
      check();
    };

    // Throttle — evitamos reiniciar timers en CADA mousemove
    let lastReset = Date.now();
    const reset = () => {
      const now = Date.now();
      if (now - lastReset < 500) return;
      lastReset = now;
      markActivity();
      scheduleTimers();
    };

    // Actividad en otra pestaña: reprograma esta.
    const onStorage = (e: StorageEvent) => {
      if (e.key === LAST_ACTIVITY_KEY) scheduleTimers();
    };
    window.addEventListener('storage', onStorage);

    const events: (keyof DocumentEventMap)[] = [
      'mousedown',
      'mousemove',
      'keydown',
      'scroll',
      'touchstart',
      'click',
    ];
    events.forEach((ev) => document.addEventListener(ev, reset, { passive: true }));
    // Abrir el panel cuenta como actividad: si no, una marca vieja de una
    // sesión anterior cerraría la recién iniciada al primer chequeo.
    markActivity();
    scheduleTimers();

    return () => {
      clearTimers();
      events.forEach((ev) => document.removeEventListener(ev, reset));
      window.removeEventListener('storage', onStorage);
    };
  }, [timeoutMinutes]);
}
