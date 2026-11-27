import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ApiKey, ApiKeysBackend } from '../api/integration-keys.api';
import { Button } from './ui/Button';
import { toast } from '../ui/Toast';

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const errMsg = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message?.toString() ?? fallback;

/**
 * Lista, alta y revocación de las claves de la API de integración. Lo usan el
 * portal (administrador del cliente) y la ficha del cliente en el panel.
 * La clave en claro se muestra una sola vez, al crearla.
 */
export default function ApiKeysManager({ backend, queryKey }: { backend: ApiKeysBackend; queryKey: unknown[] }) {
  const qc = useQueryClient();
  const keys = useQuery({ queryKey, queryFn: backend.list });
  const [nombre, setNombre] = useState('');
  const [secret, setSecret] = useState<string | null>(null);

  const issue = useMutation({
    mutationFn: (n: string) => backend.issue(n),
    onSuccess: (r) => {
      setSecret(r.secret);
      setNombre('');
      qc.invalidateQueries({ queryKey });
    },
    onError: (e) => toast.error(errMsg(e, 'No se pudo crear la clave.')),
  });
  const revoke = useMutation({
    mutationFn: (id: number) => backend.revoke(id),
    onSuccess: () => {
      toast.success('Clave revocada. Deja de funcionar al instante.');
      qc.invalidateQueries({ queryKey });
    },
    onError: (e) => toast.error(errMsg(e, 'No se pudo revocar la clave.')),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (nombre.trim()) issue.mutate(nombre.trim());
  };
  const confirmRevoke = (k: ApiKey) => {
    if (window.confirm(`¿Revocar la clave «${k.nombre}» (${k.prefijo}…)? Las integraciones que la usen dejarán de funcionar.`)) revoke.mutate(k.id);
  };
  const copy = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      toast.success('Clave copiada.');
    } catch {
      toast.error('No se pudo copiar; selecciónala y cópiala a mano.');
    }
  };

  const active = (keys.data ?? []).filter((k) => k.estado === 'ACTIVA').length;

  return (
    <div className="space-y-4">
      {secret && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-2">
          <p className="text-sm font-semibold text-amber-900">Guárdala ahora: no se volverá a mostrar.</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="flex-1 min-w-0 break-all rounded bg-white border border-amber-200 px-2 py-1.5 text-xs">{secret}</code>
            <Button size="sm" onClick={copy}>Copiar</Button>
            <Button size="sm" variant="secondary" onClick={() => setSecret(null)}>Ya la guardé</Button>
          </div>
        </div>
      )}

      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Nombre de la nueva clave
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            maxLength={80}
            placeholder="p. ej. Power BI gerencia"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm w-72"
          />
        </label>
        <Button type="submit" size="sm" disabled={!nombre.trim() || issue.isPending}>
          {issue.isPending ? 'Creando…' : 'Nueva clave'}
        </Button>
        <span className="text-xs text-slate-500">{active} de 10 claves activas</span>
      </form>

      {keys.isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {keys.error && <p role="alert" className="text-sm text-red-700">No se pudieron cargar las claves.</p>}
      {keys.data && keys.data.length === 0 && <p className="text-sm text-slate-500">Todavía no hay claves.</p>}
      {keys.data && keys.data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                {['Nombre', 'Clave', 'Estado', 'Creada', 'Último uso', ''].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keys.data.map((k) => (
                <tr key={k.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-800">{k.nombre}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">{k.prefijo}…</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${k.estado === 'ACTIVA' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {k.estado === 'ACTIVA' ? 'Activa' : `Revocada ${fmt(k.revocadaEn)}`}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{fmt(k.creadaEn)}</td>
                  <td className="px-3 py-2 text-slate-600">{fmt(k.ultimoUso)}</td>
                  <td className="px-3 py-2 text-right">
                    {k.estado === 'ACTIVA' && (
                      <Button size="sm" variant="secondary" onClick={() => confirmRevoke(k)} disabled={revoke.isPending}>
                        Revocar
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
