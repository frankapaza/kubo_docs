import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { portalApi } from '../../api/portal.api';
import type { PortalInvitationPreview } from '../../api/types';
import { Button } from '../../components/ui/Button';

/**
 * Página pública: **la única del portal que se abre sin sesión y da a cambio
 * una credencial**. Antes de pedir nada saluda: consulta la ruta pública de
 * solo lectura (decisión 10 de la spec) y muestra el nombre de la persona
 * invitada y el de su empresa, para que sepa qué está creando y no termine
 * poniendo una contraseña en la cuenta equivocada. Esa consulta **no consume
 * la invitación**: se puede recargar la página sin que el enlace deje de
 * servir.
 *
 * No pide el correo —ya lo lleva la invitación, y pedirlo permitiría probar
 * direcciones— y la única escritura ocurre al enviar el formulario.
 *
 * Aceptar no inicia sesión (decisión 11 de la spec). El servidor devuelve el
 * correo con el que entrar y de aquí se va al login como cualquier otra
 * persona.
 */
export default function PortalAcceptInvitationPage() {
  const { secret } = useParams<{ secret: string }>();
  const navigate = useNavigate();

  const [preview, setPreview] = useState<PortalInvitationPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneEmail, setDoneEmail] = useState<string | null>(null);

  /**
   * Corta el camino tardío tras desmontar. Su propio efecto de vista previa ya
   * lo hacía —con la variable `cancelled` de la limpieza— y el diálogo hermano
   * de esta misma tarea (`InvitePortalUserDialog`) también, pero el envío del
   * formulario de aquí no: entre `acceptInvitation` y su respuesta la persona
   * puede haber pulsado «Inicia sesión» y haberse ido. Escribir en el estado
   * de un componente desmontado es la misma asimetría de disciplina que este
   * proyecto ya cerró en los otros dos sitios.
   */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    portalApi
      .previewInvitation(secret ?? '')
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((err: any) => {
        // Cualquier fallo al consultar —incluido uno transitorio de red— se
        // trata igual que un enlace no válido: fallar cerrado es la misma
        // disciplina que rige el resto de esta funcionalidad. Distinguir
        // "el servidor no respondió" de "el enlace es malo" solo le
        // serviría a quien está probando enlaces.
        if (!cancelled) {
          setPreviewError(
            err?.response?.data?.message ??
              'El enlace no es válido o ha caducado. Pide a quien te invitó que te mande uno nuevo.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [secret]);

  /**
   * Freno **síncrono** al doble envío, marcado antes de cualquier `await`.
   * Aquí importa más que en ningún otro formulario del portal: la invitación
   * es de un solo uso, así que un segundo envío que se cuele antes de que
   * `busy` reptinte recibiría el cuerpo genérico de «enlace no válido» —el de
   * su propia aceptación, que acaba de funcionar— y la persona creería que
   * algo ha fallado cuando su cuenta ya existe.
   */
  const inFlight = useRef(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;

    // La comparación en el navegador es una cortesía, no la validación: el
    // servidor la repite y es la suya la que manda (§«La contraseña» de la
    // spec).
    if (password !== confirmation) {
      setError('Las dos contraseñas no coinciden.');
      return;
    }

    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const { email } = await portalApi.acceptInvitation({
        secret: secret ?? '',
        password,
        passwordConfirmation: confirmation,
      });
      if (alive.current) setDoneEmail(email);
    } catch (err: any) {
      if (alive.current) {
        setError(
          err?.response?.data?.message ??
            'No se pudo completar el alta. Inténtalo de nuevo en unos minutos.',
        );
      }
    } finally {
      // La referencia SÍ se libera siempre, esté montado o no: es una marca
      // propia, no estado de React, y dejarla puesta bloquearía un reintento
      // si el componente sigue vivo.
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  };

  if (doneEmail) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl shadow-md p-8 max-w-md w-full text-center space-y-4">
          <h1 className="text-xl font-bold text-slate-800">Tu cuenta ya está lista</h1>
          <p className="text-slate-500 text-sm">
            Entra al portal con <strong>{doneEmail}</strong> y la contraseña que acabas de
            elegir.
          </p>
          <Button onClick={() => navigate('/portal/login', { replace: true })}>
            Ir a iniciar sesión
          </Button>
        </div>
      </div>
    );
  }

  if (previewLoading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <p className="text-slate-500 text-sm">Comprobando tu invitación…</p>
      </div>
    );
  }

  /*
   * El enlace no vale: no existe, caducó, ya se usó, se revocó, quien invitó
   * está desactivado o su empresa dejó de ser cliente. No se distingue cuál
   * de esas fue —mismo cuerpo genérico que `accept`, decisión 10 de la
   * spec—, y sin formulario: no tiene sentido pedir una contraseña para una
   * invitación que ya sabemos que no se va a poder aceptar.
   */
  if (!preview) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl shadow-md p-8 max-w-md w-full text-center space-y-4">
          <h1 className="text-xl font-bold text-slate-800">Este enlace no funciona</h1>
          <p className="text-slate-500 text-sm">{previewError}</p>
          <Link className="text-sm underline" to="/portal/login">
            Ir a iniciar sesión
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="bg-white rounded-xl shadow-md p-8 max-w-md w-full space-y-4"
      >
        <div>
          <h1 className="text-xl font-bold text-slate-800">Hola, {preview.fullName}</h1>
          <p className="text-slate-500 text-sm mt-1">
            {preview.clientName
              ? `Te invitaron a unirte al portal de ${preview.clientName}. Elige tu contraseña para entrar.`
              : 'Elige tu contraseña para entrar al portal.'}
          </p>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Contraseña</span>
          <input
            type="password"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            minLength={8}
            required
            autoComplete="new-password"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Repite la contraseña</span>
          <input
            type="password"
            value={confirmation}
            onChange={(ev) => setConfirmation(ev.target.value)}
            minLength={8}
            required
            autoComplete="new-password"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        {/*
          El servidor responde exactamente lo mismo tanto si el enlace no
          existe como si caducó o si ya se usó. Aquí se pinta tal cual: no se
          intenta adivinar cuál de las cosas pasó, porque esa distinción
          solo le serviría a quien está probando enlaces.
        */}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Creando tu cuenta…' : 'Crear mi cuenta'}
        </Button>

        <p className="text-xs text-slate-400 text-center">
          ¿Ya tienes cuenta? <Link className="underline" to="/portal/login">Inicia sesión</Link>
        </p>
      </form>
    </div>
  );
}
