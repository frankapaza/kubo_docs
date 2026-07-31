import { useEffect, useState } from 'react';

import { supportAgentsApi } from '../../api/tickets.api';
import { usersApi } from '../../api/users.api';
import { useAuth } from '../../auth/AuthContext';
import type { AgentLevel, ServiceCategory, SupportAgentView, User } from '../../api/types';
import { SERVICE_CATEGORIES, SERVICE_CATEGORY_LABELS } from '../../api/types';

const AGENT_LEVELS: AgentLevel[] = ['N1', 'N2', 'N3'];

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e5e6',
  borderRadius: 10,
  padding: 18,
};

/**
 * Equipo de técnicos de la mesa de servicio. Vive debajo del listado de
 * usuarios en UsersPage. GET /support-agents es de cualquier usuario
 * autenticado, pero create/update/remove están detrás de @Roles('ADMIN')
 * (ver backend/src/modules/tickets/support-agents.controller.ts): un
 * usuario no-admin nunca ve los controles de edición, para no ofrecer un
 * botón que el backend va a rechazar con 403.
 */
export default function SupportAgentsSection() {
  const { user: current } = useAuth();
  const isAdmin = current?.role === 'ADMIN';

  const [agents, setAgents] = useState<SupportAgentView[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Formulario de alta
  const [newUserId, setNewUserId] = useState<number | ''>('');
  const [newLevel, setNewLevel] = useState<AgentLevel>('N1');
  const [newSpecialties, setNewSpecialties] = useState<ServiceCategory[]>([]);

  // `cancelled` evita que una carga obsoleta pise el estado de la vista
  // actual — mismo idioma que TicketDetailPage/TicketsListPage.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      supportAgentsApi.list(),
      // GET /users está restringido por rol (ADMIN, PRODUCT_OWNER,
      // SCRUM_MASTER; ver TicketsListPage). Si falla, el listado de
      // técnicos igual se muestra: solo el formulario de alta se queda
      // sin candidatos.
      usersApi.list().catch((e) => {
        console.warn('[SupportAgentsSection] No se pudo cargar la lista de usuarios.', e);
        return [] as User[];
      }),
    ])
      .then(([agentsData, usersData]) => {
        if (!cancelled) {
          setAgents(agentsData);
          setUsers(usersData);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          console.warn('[SupportAgentsSection] No se pudo cargar el listado de técnicos.', e);
          setLoadError(e?.response?.data?.message ?? 'No se pudo cargar el listado de técnicos');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Task 15 separó los tipos a propósito: create()/update() devuelven el
  // SupportAgent plano, sin fullName/email/openTickets. Recargamos la
  // lista enriquecida en vez de intentar leer esos campos de la respuesta.
  const reload = () =>
    supportAgentsApi
      .list()
      .then(setAgents)
      .catch((e) => {
        console.warn('[SupportAgentsSection] No se pudo recargar el listado de técnicos.', e);
      });

  const register = async () => {
    if (!newUserId) return;
    setBusy(true);
    setError(null);
    try {
      await supportAgentsApi.create({ userId: newUserId, level: newLevel, specialties: newSpecialties });
      setNewUserId('');
      setNewLevel('N1');
      setNewSpecialties([]);
      await reload();
    } catch (e: any) {
      // El backend responde 409 CONFLICT con { code, message } si el
      // usuario ya está registrado como técnico; se muestra tal cual.
      setError(e?.response?.data?.message ?? 'No se pudo registrar el técnico');
    } finally {
      setBusy(false);
    }
  };

  const updateLevel = async (agent: SupportAgentView, level: AgentLevel) => {
    setBusy(true);
    setError(null);
    try {
      await supportAgentsApi.update(agent.id, { level });
      await reload();
    } catch (e: any) {
      console.warn('[SupportAgentsSection] No se pudo cambiar el nivel del técnico.', e);
      setError(e?.response?.data?.message ?? 'No se pudo cambiar el nivel');
    } finally {
      setBusy(false);
    }
  };

  const toggleSpecialty = async (agent: SupportAgentView, category: ServiceCategory) => {
    const specialties = agent.specialties ?? [];
    const next = specialties.includes(category)
      ? specialties.filter((c) => c !== category)
      : [...specialties, category];
    setBusy(true);
    setError(null);
    try {
      await supportAgentsApi.update(agent.id, { specialties: next });
      await reload();
    } catch (e: any) {
      console.warn('[SupportAgentsSection] No se pudo cambiar las especialidades del técnico.', e);
      setError(e?.response?.data?.message ?? 'No se pudo cambiar las especialidades');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (agent: SupportAgentView) => {
    setBusy(true);
    setError(null);
    try {
      await supportAgentsApi.update(agent.id, { isActive: agent.isActive === 0 });
      await reload();
    } catch (e: any) {
      console.warn('[SupportAgentsSection] No se pudo cambiar el estado del técnico.', e);
      setError(e?.response?.data?.message ?? 'No se pudo actualizar el técnico');
    } finally {
      setBusy(false);
    }
  };

  // Usuarios que todavía no son técnicos: son los únicos candidatos válidos
  // para el alta (el backend rechaza un userId ya registrado con CONFLICT).
  const agentUserIds = new Set(agents.map((a) => a.userId));
  const candidates = users.filter((u) => !agentUserIds.has(u.id));

  const gridCols = '1.4fr 90px 2fr 90px 100px';

  return (
    <section style={cardStyle}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && (
          <span role="alert" style={{ fontSize: 12, color: 'oklch(0.5 0.16 25)' }}>
            {error}
          </span>
        )}
        {loading && <span style={{ fontSize: 12, color: '#6d7577' }}>Cargando…</span>}
        {loadError && (
          <span role="alert" style={{ fontSize: 12, color: 'oklch(0.5 0.16 25)' }}>
            {loadError}
          </span>
        )}

        {!loading && !loadError && agents.length === 0 && (
          <span style={{ fontSize: 12, color: '#6d7577' }}>
            Todavía no hay técnicos registrados en la mesa de servicio.
          </span>
        )}

        {!loading && !loadError && agents.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: gridCols,
                gap: 12,
                padding: '8px 0',
                borderBottom: '1px solid #eceeef',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: '#6d7577',
              }}
            >
              <span>Técnico</span>
              <span>Nivel</span>
              <span>Especialidades</span>
              <span>Carga</span>
              <span>Estado</span>
            </div>

            {agents.map((a) => (
              <div
                key={a.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: gridCols,
                  gap: 12,
                  alignItems: 'center',
                  padding: '10px 0',
                  borderBottom: '1px solid #f1f3f3',
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: a.isActive ? '#15191a' : '#9aa0a1' }}>
                    {a.fullName}
                  </div>
                  <div style={{ fontSize: 11, color: '#6d7577' }}>{a.email}</div>
                </div>

                {isAdmin ? (
                  <select
                    value={a.level}
                    disabled={busy}
                    onChange={(e) => updateLevel(a, e.target.value as AgentLevel)}
                    aria-label={`Nivel de ${a.fullName}`}
                    style={{ fontSize: 12, padding: '5px 6px', border: '1px solid #dfe3e4', borderRadius: 5 }}
                  >
                    {AGENT_LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{a.level}</span>
                )}

                {isAdmin ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {SERVICE_CATEGORIES.map((c) => {
                      const checked = (a.specialties ?? []).includes(c);
                      return (
                        <label
                          key={c}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 11,
                            padding: '2px 6px',
                            borderRadius: 4,
                            border: '1px solid #e2e5e6',
                            background: checked ? '#eceeef' : '#fff',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={busy}
                            onChange={() => toggleSpecialty(a, c)}
                          />
                          {SERVICE_CATEGORY_LABELS[c]}
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <span style={{ fontSize: 12, color: '#4a5052' }}>
                    {(a.specialties ?? []).length > 0
                      ? a.specialties!.map((c) => SERVICE_CATEGORY_LABELS[c]).join(', ')
                      : '—'}
                  </span>
                )}

                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 600 }}>
                  {a.openTickets}
                </span>

                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => toggleActive(a)}
                    disabled={busy}
                    style={{
                      fontSize: 11,
                      padding: '5px 8px',
                      borderRadius: 5,
                      background: '#fff',
                      border: '1px solid #d8dcdd',
                      cursor: busy ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {a.isActive ? 'Desactivar' : 'Activar'}
                  </button>
                ) : (
                  <span style={{ fontSize: 12, color: a.isActive ? '#15191a' : '#9aa0a1' }}>
                    {a.isActive ? 'Activo' : 'Inactivo'}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {isAdmin ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8, borderTop: '1px solid #eceeef' }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Registrar técnico</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                value={newUserId}
                disabled={busy}
                onChange={(e) => setNewUserId(e.target.value ? Number(e.target.value) : '')}
                aria-label="Usuario a registrar como técnico"
                style={{ fontSize: 13, padding: '8px 10px', border: '1px solid #dfe3e4', borderRadius: 6, minWidth: 240 }}
              >
                <option value="">Selecciona un usuario…</option>
                {candidates.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName} · {u.email}
                  </option>
                ))}
              </select>
              <select
                value={newLevel}
                disabled={busy}
                onChange={(e) => setNewLevel(e.target.value as AgentLevel)}
                aria-label="Nivel del nuevo técnico"
                style={{ fontSize: 13, padding: '8px 10px', border: '1px solid #dfe3e4', borderRadius: 6 }}
              >
                {AGENT_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={register}
                disabled={busy || !newUserId}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  padding: '8px 14px',
                  borderRadius: 6,
                  background: busy || !newUserId ? '#c9cdce' : '#15191a',
                  color: '#fff',
                  border: 'none',
                  cursor: busy || !newUserId ? 'not-allowed' : 'pointer',
                }}
              >
                Registrar
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {SERVICE_CATEGORIES.map((c) => {
                const checked = newSpecialties.includes(c);
                return (
                  <label
                    key={c}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11,
                      padding: '2px 6px',
                      borderRadius: 4,
                      border: '1px solid #e2e5e6',
                      background: checked ? '#eceeef' : '#fff',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={busy}
                      onChange={() =>
                        setNewSpecialties((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
                      }
                    />
                    {SERVICE_CATEGORY_LABELS[c]}
                  </label>
                );
              })}
            </div>
            {candidates.length === 0 && users.length > 0 && (
              <span style={{ fontSize: 11, color: '#6d7577' }}>
                Todos los usuarios ya están registrados como técnicos.
              </span>
            )}
          </div>
        ) : (
          <span style={{ fontSize: 11, color: '#6d7577' }}>
            Solo un administrador puede registrar técnicos o cambiar su nivel, especialidades y estado.
          </span>
        )}
      </div>
    </section>
  );
}
