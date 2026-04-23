# Kubo DevDocs — Roadmap

Documento vivo de fases de producto. Actualizar al cerrar cada fase.

## Visión del producto

Kubo NO es otro Jira. Es **el sistema operativo de reuniones ágiles**: el pipeline único voz → transcripción → acta firmada → backlog estructurado → herramienta externa (Jira/Azure/Linear/etc.).

---

## 🧱 Fase 0 — Consolidar lo que ya está
**Tiempo:** ~1 semana · **Impacto:** bajo pero necesario · **Riesgo:** nulo

**Goal:** dejar el pipeline actual sólido antes de ampliarlo.

- [ ] Dashboard simple por proyecto: métricas de reuniones, actas, historias exportadas
- [ ] Fases del proyecto (`INICIO → PLANIFICACIÓN → EJECUCIÓN → CIERRE`) con fechas
- [ ] Fix bugs pendientes del APK móvil (upload grande, outbox)
- [ ] Pulir la UI de integraciones y el flujo de export a Jira

---

## 🎙️ Fase 1 — Tipificar reuniones ⭐ IN PROGRESS
**Tiempo:** 2-3 semanas · **Impacto:** ALTO (diferenciador clave) · **Riesgo:** bajo

**Goal:** que cada tipo de reunión produzca el output correcto, no solo un acta genérica. Pasar de "transcriptor con IA" a "sistema operativo de reuniones ágiles".

### Tipos de reunión a soportar

| Tipo | Output especializado |
|---|---|
| `DAILY` | Lista de impedimentos + compromisos del día por persona |
| `RETROSPECTIVE` | Start / Stop / Continue + action items con responsable |
| `SPRINT_PLANNING` | Historias seleccionadas + story points commitment + sprint goal |
| `SPRINT_REVIEW` | Demo notes + feedback de stakeholders + decisiones |
| `POSTMORTEM` | Timeline + 5 whys + root cause + action items |
| `DISCOVERY` | Perfil entrevistado + insights + hipótesis validadas + preguntas pendientes |
| `GENERIC` | Acta clásica (default, comportamiento actual) |

### Implementación

- [ ] Campo `meetingType` en tabla `meetings` (SQL migration)
- [ ] Enum + entity + DTO actualizados
- [ ] System prompts especializados por tipo en `LLMService`
- [ ] Selector de tipo en la UI al crear la reunión (web + móvil)
- [ ] Badge del tipo en la lista y detalle de reuniones
- [ ] Template de acta (Markdown) adaptado por tipo
- [ ] El agente de Agilidad se enriquece con ejemplos de cada tipo

---

## 🔌 Fase 2 — Ampliar integraciones
**Tiempo:** 2 semanas · **Impacto:** alto (mercado) · **Riesgo:** bajo

**Goal:** ser el puente universal de meetings → work. Más herramientas soportadas = más difícil que nos reemplacen.

### Prioridad por adopción del mercado
1. **Azure DevOps** (empresas grandes / regulado) — API similar a Jira
2. **Trello** (startups, PYMEs) — más simple
3. **Linear** (equipos técnicos modernos) — GraphQL, muy limpia
4. **GitHub Projects** (open source / dev teams) — GraphQL
5. **Slack** notifications (side-effect útil)

### Implementación
- [ ] Generalizar el módulo `integrations` con `provider` field en BD
- [ ] Abstraer `jira.service.ts` en una interfaz → implementaciones por provider
- [ ] Modal de export: mismo UX, solo cambia el dropdown de "integración"

---

## 🔐 Fase 3 — Compliance & sectores regulados
**Tiempo:** 2 semanas · **Impacto:** medio-alto (precio 3-5x) · **Riesgo:** medio

**Goal:** convertir las actas firmadas en un moat para salud, farma, banca, gobierno.

- [ ] **WebAuthn / huella digital** (ya anotado como pendiente) — Touch ID, Windows Hello, huella Android
- [ ] **PDF/A-3 para archivado legal** — garantiza apertura 50 años después
- [ ] **Audit log exhaustivo** — quién vio qué acta, cuándo, IP
- [ ] **Plantillas por sector:** comité clínico, acta regulatoria farma, acta de directorio bancaria
- [ ] **Retención configurable** — políticas de archivado automático

---

## 🏢 Fase 5 — Clientes como entidad raíz + Documentos inteligentes
**Tiempo:** 3-4 semanas · **Impacto:** ALTO (abre legal-tech y sales-tech) · **Riesgo:** medio

**Goal:** dejar de ser solo "CRM de proyectos" y convertirse en el sistema operativo completo del ciclo comercial + delivery. La clave: introducir `Cliente` como entidad raíz de la que cuelgan documentos comerciales, reuniones pre-venta y proyectos.

### Nueva arquitectura de información

```
🏢 Cliente (raíz)
   ├── 📄 Documentos comerciales (NDA, cotización, contrato, SOW, TDR, addendum)
   ├── 🎙️ Reuniones pre-venta (discovery, presentación, negociación, cierre)
   └── 📁 Proyectos (nacen al firmar un contrato)
        └── Reuniones de delivery (dailies, retros, planning, review, postmortem)
        └── Actas + Backlog + Jira (flujo existente)
```

### Iteración 5.A — Clientes + vínculo con Proyectos
- [ ] Entidad `Client` (razón social, RUC, representante, status)
- [ ] Tabla `clients` + FK `client_id` en `projects`
- [ ] Migración de datos: cliente implícito por cada proyecto existente
- [ ] UI: sección "Clientes" en sidebar (lista + detalle con tabs)
- [ ] Proyectos ahora se crean ligados a un cliente
- [ ] Flujo de estado: PROSPECT → CLIENT → FORMER_CLIENT

### Iteración 5.B — Documentos inteligentes
- [ ] Entidad `DocumentTemplate` (plantillas reutilizables con placeholders)
- [ ] Semilla: cargar plantillas reales de contrato y cotización KUBO
- [ ] Entidad `CommercialDocument` (docs generados por cliente)
- [ ] Pipeline: Reunión → IA llena variables → Plantilla → PDF firmable
- [ ] Firmas digitales SHA-256 en documentos comerciales
- [ ] Versionado y audit trail

### Iteración 5.C — Reuniones pre-venta
- [ ] Meeting puede ligarse a `client_id` (sin proyecto obligatorio)
- [ ] Tipos nuevos: `SALES_DISCOVERY`, `SALES_PROPOSAL`, `SALES_CLOSING`
- [ ] Contrato firmado → crea Proyecto automáticamente

---

## 🎙️ Fase 6 — Extensión de navegador para grabar meetings online
**Tiempo:** 3-4 semanas · **Impacto:** ALTO (captura automática de meetings remotos) · **Riesgo:** medio-alto

**Goal:** capturar el audio de reuniones en Google Meet, Zoom Web y Teams sin depender del APK móvil ni de que alguien recuerde darle "Grabar". Hoy Kubo solo graba desde la app móvil o desde la web del propio proyecto; si el meeting es en una plataforma externa, el usuario se queda sin transcripción.

### Arquitectura propuesta

**Extensión de Chrome (Manifest V3):**
- Se activa automáticamente al detectar tabs en `meet.google.com`, `zoom.us/wc`, `teams.microsoft.com/v2`
- Un badge junto a la URL muestra "🔴 Grabando para Kubo" cuando está activa
- Usa `chrome.tabCapture` API para capturar el audio del tab (lo que se escucha) + `navigator.mediaDevices.getUserMedia` para el micrófono del usuario
- Mezcla ambos streams en un único WebM
- Popup con: botón Start/Stop, selector de "asociar a reunión Kubo existente" o "crear nueva reunión"
- Al terminar: sube el archivo al mismo endpoint `POST /meetings/:id/audio` que usa la web y móvil

### Implementación

- [ ] Estructura base de la extensión (manifest.json, popup, content script, background)
- [ ] Captura de audio (tab + mic, mezclado con Web Audio API)
- [ ] UI popup con login contra Kubo (reutiliza JWT token)
- [ ] Selector de reunión: lista las reuniones del usuario o permite crear una nueva con QuickMeeting
- [ ] Upload al backend con barra de progreso
- [ ] Outbox local en IndexedDB por si cae la red (igual que el APK)
- [ ] Detección automática de participantes del meeting (scraping ligero del DOM de Meet/Zoom)
- [ ] Publicación en Chrome Web Store (o distribución como `.crx` privado)

### Consideraciones

- **Permisos sensibles** — `tabCapture` + `microphone` son permisos "peligrosos" en Chrome Store; puede tardar la revisión
- **Consentimiento legal** — grabar una reunión sin avisar es ilegal en varias jurisdicciones; la extensión debe mostrar un aviso visible y configurable ("Aviso: esta sesión se está grabando")
- **Firefox/Edge** — `tabCapture` funciona en Chromium (Edge, Brave), pero Firefox tiene su propia API. Empezar por Chrome
- **Safari** — no soporta Manifest V3 extensions con tabCapture todavía. Postergar

### Alternativa más simple (puente)

Si la extensión resulta demasiado pesada para una primera iteración:
- **Integración con Meet/Zoom via bot oficial** (Recall.ai, Symbl.ai) — APIs que meten un "usuario bot" a la reunión y devuelven el audio. Costo por minuto pero cero desarrollo en el cliente
- **Web grabación directa** desde Kubo (ya casi la tienes en `/recording`) con un enlace compartible que permita a invitados sumarse a grabar un call usando el navegador

---

## 📊 Fase 4 — Analytics e inteligencia transversal
**Tiempo:** 2-3 semanas · **Impacto:** alto (retención) · **Riesgo:** medio

**Goal:** dar visibilidad de patrones y tendencias que emergen del corpus completo de reuniones. Pasar de herramienta individual a **memoria organizacional viva**.

- [ ] **Dashboard ejecutivo cross-proyecto:** velocidad, temas recurrentes, bloqueadores crónicos
- [ ] **Alertas automáticas:** "Este impedimento lleva 3 retros sin resolverse"
- [ ] **Resumen semanal por proyecto:** IA sintetiza todas las reuniones en un brief
- [ ] **Búsqueda semántica** en transcripciones: "¿cuándo se decidió X?" → fecha + enlace
- [ ] **Tendencias:** si "seguridad" aparece 5 reuniones seguidas → sugiere un epic

---

## Resumen ejecutivo

| Fase | Tiempo | Impacto | Riesgo | Estado |
|---|---|---|---|---|
| 0 Consolidar | 1 sem | Bajo pero necesario | Nulo | Pendiente |
| 1 Tipificar reuniones | 2-3 sem | **Alto** (diferenciador) | Bajo | **En curso** |
| 2 Más integraciones | 2 sem | Alto (mercado) | Bajo | Pendiente |
| 3 Compliance | 2 sem | Medio-Alto (precio) | Medio | Pendiente |
| 4 Analytics | 2-3 sem | Alto (retención) | Medio | Pendiente |

**Total: ~10-12 semanas** para tener un producto muy diferenciado sin desnaturalizarlo.
