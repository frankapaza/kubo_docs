# Tickets por correo — Plan de implementación

> **Para trabajadores agénticos:** SUB-HABILIDAD REQUERIDA: usa superpowers:subagent-driven-development. Los pasos usan casillas (`- [ ]`).

**Goal:** Que un correo de un cliente registrado cree un ticket solo, que se le responda con su número, y que cada respuesta suya se pegue al hilo de ese ticket.

**Architecture:** Todo lo decidible vive en módulos **puros** sin red ni base de datos: el análisis de cabeceras, la correlación, las reglas de aceptación y el recorte del cuerpo. El acceso al buzón queda detrás de una interfaz, para que el servicio de ingesta se pueda probar entero con correos de ejemplo. Un scheduler de un solo hilo lo dispara cada minuto, con la misma disciplina que el despachador de notificaciones.

**Tech Stack:** NestJS 10 · TypeORM 0.3 (`synchronize: false`) · MySQL 8 · Jest 29 (con `TZ=UTC` forzado) · `imapflow` + `mailparser` · React 18 + Vite

**Spec:** `docs/superpowers/specs/2026-08-22-tickets-por-correo-design.md`

## Global Constraints

- **Nunca decidir por la ausencia de un valor** en lugar de por el hecho que lo determina. Es el defecto que más veces ha reaparecido aquí. En este proyecto se materializa en que **una cabecera de autenticación ausente significa NO autenticado**, nunca «probablemente bien».
- **La frontera entre empresas.** Un correo de la empresa A no puede tocar un ticket de la empresa B por ningún camino, ni siquiera poniendo su número en el asunto.
- **Un canal externo nunca escribe notas internas.** Todo lo que entra por correo de un cliente es un mensaje **público**.
- **Escrituras transaccionales** con `runInTransaction` y `manager.getRepository(...)` dentro del callback.
- TypeORM devuelve `bigint` **como cadenas**. Nunca comparar identificadores con `===`; usar `sameId` de `backend/src/common/ids.ts`.
- Cuerpos de error `{ code, message }`, mensaje en español dirigido a una persona.
- **Nunca guardar ni mostrar HTML de fuera.** Solo texto.
- **Nada de lo que se envía puede dispararse solo en cadena**: todo envío va marcado como automático y nunca se responde a lo que ya lo está.
- Comentarios en español, que expliquen el porqué y no el qué.
- Ninguna prueba debe consagrar un comportamiento equivocado.
- **La ingesta nace apagada.**

## Estructura de ficheros

**Backend — se crean:**
- `backend/sql/migrations/021_correo_entrante.sql`
- `backend/src/modules/inbound-email/domain/message-headers.ts` — análisis de cabeceras y asunto. Puro.
- `backend/src/modules/inbound-email/domain/intake-rules.ts` — autenticación, automático, propio, tamaño. Puro.
- `backend/src/modules/inbound-email/domain/quoted-text.ts` — recorte del cuerpo. Puro.
- `backend/src/modules/inbound-email/domain/correlation.ts` — a qué ticket pertenece. Puro.
- `backend/src/modules/inbound-email/entities/inbound-email.entity.ts`
- `backend/src/modules/inbound-email/inbound-emails.repository.ts`
- `backend/src/modules/inbound-email/mailbox.interface.ts` — el contrato del buzón.
- `backend/src/modules/inbound-email/imap-mailbox.service.ts` — la implementación real.
- `backend/src/modules/inbound-email/inbound-email.service.ts` — el recorrido.
- `backend/src/modules/inbound-email/inbound-email.scheduler.ts`
- `backend/src/modules/inbound-email/inbound-email.controller.ts`
- `backend/src/modules/inbound-email/inbound-email.module.ts`
- Sus ficheros de prueba.

**Backend — se modifican:**
- `backend/src/modules/tickets/entities/ticket.entity.ts` — `emailMessageId`.
- `backend/src/modules/ticket-messages/entities/ticket-message.entity.ts` — `inboundEmailId`, `bodyFull`.
- `backend/src/modules/notifications/entities/*` — guardar el `Message-ID` de lo que enviamos.
- `backend/src/modules/notifications/notification-dispatcher.service.ts` — marcar los envíos como automáticos y guardar su identificador.
- `backend/src/config/portal-schema.validator.ts`
- `backend/src/app.module.ts`
- `.github/workflows/deploy.yml`, `docker-compose.yml`, `docker-compose.dev.yml` — la migración 021.

**Web:** una pantalla de correo entrante y su entrada de menú.

---

### Task 1: Esquema y despliegue

**Files:**
- Create: `backend/sql/migrations/021_correo_entrante.sql`
- Modify: `backend/src/config/portal-schema.validator.ts` (+ su spec)
- Modify: `.github/workflows/deploy.yml`, `docker-compose.yml`, `docker-compose.dev.yml`

**Interfaces:**
- Produce: la tabla `inbound_emails`; las columnas `tickets.email_message_id`, `ticket_messages.inbound_email_id`, `ticket_messages.body_full`, y la columna del `Message-ID` en la tabla de envíos de notificación.

Contexto: **las tres listas de despliegue van escritas a mano** y hay que añadir la 021 a las tres. En la migración 020 se descubrió que faltaba en `deploy.yml` —lo que habría dejado el backend abortando en el arranque— y en la revisión final que faltaba también en los dos compose. Aquí se hacen las tres de una vez.

- [ ] **Step 1: Escribir la migración**

Sigue el patrón idempotente de la 020: procedimientos `kubo_add_column_021` y `kubo_add_index_021` con comprobación contra `information_schema`, y `USE kubo_devdocs;` al principio.

```sql
CREATE TABLE IF NOT EXISTS inbound_emails (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  message_id VARCHAR(998) NOT NULL,
  from_address VARCHAR(320) NOT NULL,
  subject VARCHAR(998) NULL,
  sent_at DATETIME NULL,
  received_at DATETIME NOT NULL,
  outcome ENUM(
    'TICKET_CREADO','MENSAJE_ANADIDO','DESCARTADO_NO_AUTENTICADO',
    'DESCARTADO_AUTOMATICO','DESCARTADO_PROPIO','DESCARTADO_DUPLICADO',
    'REMITENTE_DESCONOCIDO','DESCARTADO_POR_TOPE','ERROR'
  ) NOT NULL,
  reason TEXT NULL,
  ticket_id BIGINT UNSIGNED NULL,
  client_user_id BIGINT UNSIGNED NULL,
  attachment_count INT UNSIGNED NOT NULL DEFAULT 0,
  attachment_names JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_inbound_message_id (message_id),
  KEY idx_inbound_outcome (outcome, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

`message_id` a 998 caracteres porque es el máximo de una línea de cabecera de correo. **La clave única es lo que hace la ingesta idempotente**: si el proceso cae a medio procesar y al reiniciar vuelve a leer el mismo correo, el `INSERT` falla y se salta.

Columnas nuevas, con el procedimiento idempotente:
- `tickets.email_message_id VARCHAR(998) NULL`
- `ticket_messages.inbound_email_id BIGINT UNSIGNED NULL`
- `ticket_messages.body_full MEDIUMTEXT NULL`
- En la tabla que registra los envíos de notificación, `sent_message_id VARCHAR(998) NULL` — sin él, `In-Reply-To` no tiene contra qué correlacionar.

Índices: `idx_tickets_email_message_id` sobre `tickets(email_message_id)` y el equivalente sobre la columna de envíos. Son los que sostienen la correlación, y sin ellos cada respuesta recorre la tabla entera.

- [ ] **Step 2: Añadir las columnas al validador de esquema**

En `REQUIRED_COLUMNS` de `portal-schema.validator.ts`, con `MIGRATION_021 = 'migrations/021_correo_entrante.sql'`, las cuatro columnas nuevas. Actualiza también su `.spec.ts`, que lleva la lista esperada.

- [ ] **Step 3: Añadir la 021 a las tres listas de despliegue**

`deploy.yml` (paso de migraciones), `docker-compose.yml` y `docker-compose.dev.yml` (los montajes de `docker-entrypoint-initdb.d`), siguiendo **exactamente** el patrón de las líneas vecinas de cada fichero, que no es el mismo en los tres. En `deploy.yml` **no toques ningún otro paso**: despliega a un servidor de producción vivo.

- [ ] **Step 4: Aplicar y comprobar la idempotencia**

Run:
```bash
mysql -u root -p kubo_devdocs < backend/sql/migrations/021_correo_entrante.sql
mysql -u root -p kubo_devdocs < backend/sql/migrations/021_correo_entrante.sql
```
Expected: las dos pasadas terminan sin error. Si la segunda falla, la migración no es idempotente.

- [ ] **Step 5: Commit**

```bash
git add backend/sql/migrations/021_correo_entrante.sql backend/src/config/ .github/workflows/deploy.yml docker-compose.yml docker-compose.dev.yml
git commit -m "feat(correo): esquema de correo entrante, y la 021 en las tres listas de despliegue"
```

---

### Task 2: Cabeceras y asunto

**Files:**
- Create: `backend/src/modules/inbound-email/domain/message-headers.ts` + spec

**Interfaces:**
- Produce:
  - `export function parseMessageIds(raw: string | null | undefined): string[]` — extrae identificadores de un `In-Reply-To` o un `References`, en orden.
  - `export function stripSubjectPrefixes(subject: string): string` — quita `Re:`, `RE:`, `RV:`, `Fwd:`, `FW:` y sus acumulaciones.
  - `export function extractTicketCode(subject: string): string | null` — saca `KB-1234` de un asunto.
  - `export function isAutomaticMessage(headers: Record<string, string | undefined>): boolean`

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
describe('parseMessageIds', () => {
  it('extrae un identificador con corchetes', () => {
    expect(parseMessageIds('<abc@kuboti.com>')).toEqual(['<abc@kuboti.com>']);
  });

  it('extrae varios de un References, en orden', () => {
    expect(parseMessageIds('<a@x> <b@x>\r\n <c@x>')).toEqual(['<a@x>', '<b@x>', '<c@x>']);
  });

  // Un cliente de correo que omite los corchetes existe, y su respuesta no
  // debe perderse por eso.
  it('acepta un identificador sin corchetes y lo normaliza', () => {
    expect(parseMessageIds('abc@kuboti.com')).toEqual(['<abc@kuboti.com>']);
  });

  it('devuelve vacio con nulo, indefinido o cadena vacia', () => {
    expect(parseMessageIds(null)).toEqual([]);
    expect(parseMessageIds(undefined)).toEqual([]);
    expect(parseMessageIds('   ')).toEqual([]);
  });
});

describe('stripSubjectPrefixes', () => {
  it.each([
    ['Re: Algo falla', 'Algo falla'],
    ['RE: RE: Algo falla', 'Algo falla'],
    ['RV: Algo falla', 'Algo falla'],
    ['Fwd: Re: Algo falla', 'Algo falla'],
    ['  re : Algo falla', 'Algo falla'],
  ])('%s -> %s', (entrada, esperado) => {
    expect(stripSubjectPrefixes(entrada)).toBe(esperado);
  });

  it('no toca un asunto que empieza por una palabra parecida', () => {
    expect(stripSubjectPrefixes('Revision del contrato')).toBe('Revision del contrato');
  });
});

describe('extractTicketCode', () => {
  it('saca el codigo de un asunto con acuse', () => {
    expect(extractTicketCode('Re: [KB-1234] Algo falla')).toBe('KB-1234');
  });

  it('lo encuentra aunque no este al principio', () => {
    expect(extractTicketCode('Algo falla [KB-0007]')).toBe('KB-0007');
  });

  it('devuelve null si no hay ninguno', () => {
    expect(extractTicketCode('Algo falla')).toBeNull();
  });

  // Si hay dos, no adivinamos: es un reenvio de una conversacion mezclada y
  // acertar por casualidad es peor que abrir un ticket nuevo.
  it('devuelve null si hay mas de uno', () => {
    expect(extractTicketCode('[KB-1] y [KB-2]')).toBeNull();
  });
});

describe('isAutomaticMessage', () => {
  it.each([
    { 'auto-submitted': 'auto-replied' },
    { 'auto-submitted': 'auto-generated' },
    { precedence: 'bulk' },
    { precedence: 'list' },
    { 'x-auto-response-suppress': 'All' },
    { 'list-id': '<lista.ejemplo.com>' },
  ])('reconoce %o', (cabeceras) => {
    expect(isAutomaticMessage(cabeceras as any)).toBe(true);
  });

  it('un correo normal no es automatico', () => {
    expect(isAutomaticMessage({ from: 'a@x.com', subject: 'Hola' })).toBe(false);
  });

  // `Auto-Submitted: no` es el valor que la norma define para el correo
  // escrito por una persona. Tratarlo como automatico silenciaria respuestas
  // legitimas de clientes cuyos servidores lo anaden.
  it('Auto-Submitted: no NO es automatico', () => {
    expect(isAutomaticMessage({ 'auto-submitted': 'no' })).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `cd backend && npx jest src/modules/inbound-email/domain/message-headers.spec.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

El módulo no importa nada del proyecto: es texto entrando y texto saliendo. Puntos que debe respetar:

- `parseMessageIds` normaliza siempre a la forma con corchetes, para que la comparación posterior sea una igualdad de cadenas y no una comparación con reglas.
- `stripSubjectPrefixes` aplica el prefijo repetidamente hasta que deje de haberlo, sin distinguir mayúsculas y admitiendo espacio antes de los dos puntos.
- `extractTicketCode` busca **todas** las coincidencias y devuelve `null` si hay más de una.
- `isAutomaticMessage` lee las cabeceras **en minúsculas** — las cabeceras de correo no distinguen mayúsculas y quien las pase puede no haberlas normalizado. Documenta ese supuesto en la firma.

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `cd backend && npx jest src/modules/inbound-email/domain/message-headers.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/inbound-email/domain/
git commit -m "feat(correo): analisis de cabeceras y asunto"
```

---

### Task 3: Las reglas de aceptación y el recorte del cuerpo

**Files:**
- Create: `backend/src/modules/inbound-email/domain/intake-rules.ts` + spec
- Create: `backend/src/modules/inbound-email/domain/quoted-text.ts` + spec

**Interfaces:**
- Produce:
  - `export type AuthVerdict = 'PASA' | 'FALLA' | 'SIN_CABECERA'`
  - `export function judgeAuthentication(topmostHeader: string | null | undefined): AuthVerdict`
  - `export function isOwnMailbox(fromAddress: string, mailboxAddress: string): boolean`
  - `export function stripQuotedText(body: string): string`

- [ ] **Step 1: Escribir las pruebas de autenticación**

```ts
describe('judgeAuthentication', () => {
  it('acepta cuando spf y dkim pasan', () => {
    expect(judgeAuthentication('mx.kuboti.com; spf=pass smtp.mailfrom=cliente.com; dkim=pass header.d=cliente.com'))
      .toBe('PASA');
  });

  it('acepta con dkim=pass aunque spf no aparezca', () => {
    expect(judgeAuthentication('mx.kuboti.com; dkim=pass header.d=cliente.com')).toBe('PASA');
  });

  it('rechaza cuando ambos fallan', () => {
    expect(judgeAuthentication('mx.kuboti.com; spf=fail; dkim=fail')).toBe('FALLA');
  });

  it('rechaza spf=softfail y dkim=none', () => {
    expect(judgeAuthentication('mx.kuboti.com; spf=softfail; dkim=none')).toBe('FALLA');
  });

  // El punto entero de este modulo: la ausencia significa NO, nunca
  // "probablemente bien". Si el proveedor no anade la cabecera, no entra
  // ningun correo -- y eso es lo que queremos que pase, en voz alta.
  it('sin cabecera es SIN_CABECERA, que no es PASA', () => {
    expect(judgeAuthentication(null)).toBe('SIN_CABECERA');
    expect(judgeAuthentication(undefined)).toBe('SIN_CABECERA');
    expect(judgeAuthentication('   ')).toBe('SIN_CABECERA');
  });

  // "pass" dentro de otra palabra no es un veredicto.
  it('no confunde una subcadena con un veredicto', () => {
    expect(judgeAuthentication('mx.kuboti.com; spf=fail (passed nothing); dkim=fail')).toBe('FALLA');
  });
});
```

Y sobre `isOwnMailbox`:

```ts
it('reconoce el propio buzon sin distinguir mayusculas', () => {
  expect(isOwnMailbox('Ticket@Kuboti.com', 'ticket@kuboti.com')).toBe(true);
});

it('no confunde una direccion que lo contiene', () => {
  expect(isOwnMailbox('ticket@kuboti.com.atacante.net', 'ticket@kuboti.com')).toBe(false);
});
```

- [ ] **Step 2: Escribir las pruebas del recorte**

```ts
describe('stripQuotedText', () => {
  it('corta en la linea de atribucion de Gmail', () => {
    const cuerpo = 'Gracias, ya funciona.\n\nEl mar, 5 ago 2026 a las 10:03, Soporte <ticket@kuboti.com> escribio:\n> Hola, hemos...';
    expect(stripQuotedText(cuerpo)).toBe('Gracias, ya funciona.');
  });

  it('corta en el separador de Outlook', () => {
    const cuerpo = 'Confirmado.\n\n-----Mensaje original-----\nDe: Soporte\n...';
    expect(stripQuotedText(cuerpo)).toBe('Confirmado.');
  });

  it('corta en un bloque de lineas con >', () => {
    expect(stripQuotedText('Vale.\n\n> lo anterior\n> mas de lo anterior')).toBe('Vale.');
  });

  it('deja intacto un correo sin cita', () => {
    expect(stripQuotedText('Buenos dias, tengo un problema.')).toBe('Buenos dias, tengo un problema.');
  });

  // Lo que NO debe hacer: si el recorte se comiera todo, el mensaje quedaria
  // vacio en el hilo y el cliente veria una burbuja en blanco. Ante la duda,
  // se devuelve el original: por eso ademas se guarda el cuerpo completo.
  it('devuelve el original si el recorte lo dejaria vacio', () => {
    const soloCita = '> solo cita\n> nada mas';
    expect(stripQuotedText(soloCita)).toBe(soloCita);
  });

  it('no se traga una linea que empieza por > en medio de una frase util', () => {
    const cuerpo = 'El error dice:\n> Timeout\ny pasa siempre.';
    expect(stripQuotedText(cuerpo)).toBe(cuerpo);
  });
});
```

La última es la que evita el falso positivo: un bloque citado **al final** se corta; uno en medio, no.

- [ ] **Step 3: Ejecutar y comprobar que fallan**

Run: `cd backend && npx jest src/modules/inbound-email/domain/`
Expected: FAIL — los módulos no existen.

- [ ] **Step 4: Implementar**

`judgeAuthentication` busca `dkim=pass` o `spf=pass` con una expresión que exija límite de palabra, y devuelve los tres valores. **`SIN_CABECERA` es un valor distinto de `FALLA` a propósito**: el registro tiene que poder distinguir «el remitente falló la autenticación» de «nuestro servidor no está añadiendo la cabecera», que son dos problemas de operación completamente distintos.

`stripQuotedText` busca marcadores conocidos y corta en el **primero que aparezca a partir de una línea en blanco**; si el resultado queda vacío tras recortar espacios, devuelve el original.

- [ ] **Step 5: Ejecutar y comprobar que pasan**

Run: `cd backend && npx jest src/modules/inbound-email/domain/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/inbound-email/domain/
git commit -m "feat(correo): reglas de aceptacion y recorte de la cita"
```

---

### Task 4: A qué ticket pertenece un correo

**Files:**
- Create: `backend/src/modules/inbound-email/domain/correlation.ts` + spec

**Interfaces:**
- Consume: `parseMessageIds`, `extractTicketCode` de la tarea 2.
- Produce:

```ts
export interface CorrelationInput {
  inReplyTo: string | null;
  references: string | null;
  subject: string | null;
  /** Tickets que el repositorio encontró para esos identificadores. */
  byMessageId: Array<{ ticketId: number; clientId: number }>;
  /** Ticket que el repositorio encontró por el código del asunto, si lo había. */
  byCode: { ticketId: number; clientId: number } | null;
  /** Empresa del remitente, ya resuelta. */
  senderClientId: number;
}
export type CorrelationResult =
  | { kind: 'HILO'; ticketId: number; via: 'CABECERA' | 'ASUNTO' }
  | { kind: 'NUEVO'; reason: 'SIN_REFERENCIA' | 'REFERENCIA_DE_OTRA_EMPRESA' };

export function correlate(input: CorrelationInput): CorrelationResult
```

**Esta es la tarea con más peso de seguridad del proyecto.** Es la que decide si un correo puede tocar el ticket de otra empresa.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
const BASE = { inReplyTo: null, references: null, subject: null, byMessageId: [], byCode: null, senderClientId: 7 };

describe('correlate', () => {
  it('sin ninguna referencia, es un ticket nuevo', () => {
    expect(correlate(BASE)).toEqual({ kind: 'NUEVO', reason: 'SIN_REFERENCIA' });
  });

  it('con la cabecera apuntando a un ticket propio, va al hilo', () => {
    expect(correlate({ ...BASE, inReplyTo: '<a@x>', byMessageId: [{ ticketId: 5, clientId: 7 }] }))
      .toEqual({ kind: 'HILO', ticketId: 5, via: 'CABECERA' });
  });

  // La frontera, por el camino de las cabeceras.
  it('una cabecera que apunta a un ticket de OTRA empresa abre uno nuevo', () => {
    expect(correlate({ ...BASE, inReplyTo: '<a@x>', byMessageId: [{ ticketId: 5, clientId: 99 }] }))
      .toEqual({ kind: 'NUEVO', reason: 'REFERENCIA_DE_OTRA_EMPRESA' });
  });

  it('con el codigo en el asunto y el ticket es propio, va al hilo', () => {
    expect(correlate({ ...BASE, subject: 'Re: [KB-5] Algo', byCode: { ticketId: 5, clientId: 7 } }))
      .toEqual({ kind: 'HILO', ticketId: 5, via: 'ASUNTO' });
  });

  // LA PRUEBA MAS IMPORTANTE DEL PROYECTO. Un identificador en el asunto es
  // adivinable: sin esta regla, cualquiera con una direccion registrada
  // escribiria en el hilo de cualquier otra empresa poniendo su numero.
  it('el codigo en el asunto de un ticket AJENO abre uno nuevo, no toca el ajeno', () => {
    expect(correlate({ ...BASE, subject: 'Re: [KB-5] Algo', byCode: { ticketId: 5, clientId: 99 } }))
      .toEqual({ kind: 'NUEVO', reason: 'REFERENCIA_DE_OTRA_EMPRESA' });
  });

  it('la cabecera manda sobre el asunto cuando las dos apuntan a sitios distintos', () => {
    expect(correlate({
      ...BASE, inReplyTo: '<a@x>', subject: 'Re: [KB-9] Algo',
      byMessageId: [{ ticketId: 5, clientId: 7 }], byCode: { ticketId: 9, clientId: 7 },
    })).toEqual({ kind: 'HILO', ticketId: 5, via: 'CABECERA' });
  });

  it('si la cabecera es de otra empresa NO cae al asunto: abre uno nuevo', () => {
    expect(correlate({
      ...BASE, inReplyTo: '<a@x>', subject: 'Re: [KB-9] Algo',
      byMessageId: [{ ticketId: 5, clientId: 99 }], byCode: { ticketId: 9, clientId: 7 },
    })).toEqual({ kind: 'NUEVO', reason: 'REFERENCIA_DE_OTRA_EMPRESA' });
  });

  it('usa References cuando no hay In-Reply-To', () => {
    expect(correlate({ ...BASE, references: '<a@x> <b@x>', byMessageId: [{ ticketId: 5, clientId: 7 }] }))
      .toEqual({ kind: 'HILO', ticketId: 5, via: 'CABECERA' });
  });
});
```

La penúltima merece detenerse: cuando la cabecera apunta a otra empresa, **no se cae al asunto como alternativa**. Caerse sería exactamente la puerta que la regla del asunto quiere cerrar.

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `cd backend && npx jest src/modules/inbound-email/domain/correlation.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implementar**

Orden: si hay resultados por cabecera, decide **solo** con ellos —propio → hilo; ajeno → nuevo— y no sigue. Si no los hay, mira el asunto con la misma regla. Si tampoco, nuevo.

Compara las empresas con `sameId`, nunca con `===`: los identificadores llegan de la base como cadenas.

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `cd backend && npx jest src/modules/inbound-email/domain/correlation.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/inbound-email/domain/
git commit -m "feat(correo): correlacion con la frontera entre empresas"
```

---

### Task 5: Entidades, repositorio y el contrato del buzón

**Files:**
- Create: `backend/src/modules/inbound-email/entities/inbound-email.entity.ts`
- Create: `backend/src/modules/inbound-email/inbound-emails.repository.ts` + spec
- Create: `backend/src/modules/inbound-email/mailbox.interface.ts`
- Modify: `backend/src/modules/tickets/entities/ticket.entity.ts`, `backend/src/modules/ticket-messages/entities/ticket-message.entity.ts`

**Interfaces:**
- Produce:

```ts
export interface IncomingMessage {
  messageId: string;
  from: string;
  subject: string | null;
  sentAt: Date | null;
  textBody: string;
  headers: Record<string, string | undefined>;
  authenticationResults: string | null;   // solo la más alta
  attachmentNames: string[];
}
export const MAILBOX = Symbol('MAILBOX');
export interface Mailbox {
  fetchUnprocessed(limit: number): Promise<IncomingMessage[]>;
  markProcessed(messageId: string): Promise<void>;
}
```

El contrato es **deliberadamente pequeño**: es lo que permite probar el servicio entero con correos de ejemplo y sin red.

Métodos del repositorio, todos con `where` fijo:
- `findByMessageId(messageId: string)`
- `record(row)` — inserta el registro del correo.
- `findTicketsByEmailMessageIds(messageIds: string[]): Promise<Array<{ ticketId: number; clientId: number }>>` — busca en `tickets.email_message_id` **y** en la columna de envíos de notificación.
- `findTicketByCode(code: string)`
- `countRepliesToUnknown(address: string, since: Date)` y `countRepliesToUnknown(since: Date)` para los topes.

- [ ] **Step 1: Escribir las pruebas del repositorio**

Con el patrón de `work-items.repository.spec.ts`: repositorio real, dobles de TypeORM, aserciones sobre los argumentos con **objetos literales completos**, nunca `expect.objectContaining`.

- [ ] **Step 2: Ejecutar, implementar, volver a ejecutar**

Run: `cd backend && npx jest src/modules/inbound-email`

- [ ] **Step 3: Arrancar el backend contra la base real**

Solo **si el puerto está libre**; si está ocupado, no arranques nada y dilo en el informe, comprobando en su lugar que las columnas existen consultando `information_schema`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/inbound-email/ backend/src/modules/tickets/entities/ backend/src/modules/ticket-messages/entities/
git commit -m "feat(correo): entidades, repositorio y contrato del buzon"
```

---

### Task 6: El recorrido de un correo

**Files:**
- Create: `backend/src/modules/inbound-email/inbound-email.service.ts` + spec

**Interfaces:**
- Consume: los cuatro módulos puros, el repositorio, `Mailbox`, `TicketsService`, `TicketMessagesService`, `ClientUsersService`, `UsersService`.
- Produce: `InboundEmailService.drain(): Promise<DrainSummary>`

**Es el corazón del proyecto.** Ejecuta los ocho pasos de la especificación, en orden, y **cada descarte se registra con su motivo**.

- [ ] **Step 1: Escribir las pruebas que fallan**

Un doble de `Mailbox` que devuelve correos de ejemplo. Casos, todos obligatorios:

```
- un correo de cliente registrado sin referencia -> crea ticket, origen EMAIL, y responde con el numero
- una respuesta con In-Reply-To a un ticket propio -> anade mensaje PUBLICO, no crea ticket
- el mensaje anadido lleva authorClientUserId del remitente y visibilidad PUBLICA
- un correo del personal -> mensaje publico del equipo, con authorUserId
- un correo sin cabecera de autenticacion -> descartado, outcome DESCARTADO_NO_AUTENTICADO, y NO se responde
- un correo con autenticacion fallida -> descartado, y NO se responde
- un correo automatico -> descartado, y NO se responde
- un correo del propio buzon -> descartado
- el mismo Message-ID dos veces -> se procesa una sola vez
- un remitente desconocido -> se responde una vez y se registra REMITENTE_DESCONOCIDO
- un correo que revienta al procesarse -> se registra ERROR y **el siguiente se procesa igual**
```

Las dos últimas líneas de esa lista son las que hacen que la cola no se atasque: un correo roto no puede parar a los demás.

Y la prueba que cierra el proyecto:

```ts
it('un cliente de la empresa A no puede escribir en el hilo de la empresa B', async () => {
  // correo de un usuario de la empresa 7, con el codigo de un ticket de la 99
  // en el asunto. Debe crear un ticket NUEVO de la empresa 7.
  expect(mensajesAnadidosA(ticketDeLaEmpresa99)).toHaveLength(0);
  expect(ticketsCreados[0].clientId).toBe(7);
});
```

- [ ] **Step 2: Implementar**

Puntos que la implementación debe respetar:

- **El registro se escribe siempre**, pase lo que pase, y **antes** de responder nada. Si el proceso cae después de crear el ticket pero antes de registrar, al reiniciar crearía un segundo ticket.
- El ticket se crea con `origin: 'EMAIL'`, `clientId` **del usuario remitente** —nunca de nada que venga en el correo—, y su `emailMessageId` guardado para correlacionar respuestas.
- El mensaje va con `visibility: 'PUBLICA'` **siempre**, sin excepción y sin parámetro que lo cambie.
- El cuerpo recortado va a `bodyMd` y el original a `bodyFull`.
- Si el correo traía adjuntos, se anotan el número y los nombres, y se añade al cuerpo una línea diciendo que venían adjuntos y que hay que pedirlos. **No se descargan** (fuera de alcance).
- El bucle **captura el error de cada correo por separado**.

- [ ] **Step 3: Ejecutar y comprobar que pasa**

Run: `cd backend && npx jest src/modules/inbound-email`

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/inbound-email/
git commit -m "feat(correo): el recorrido completo de un correo entrante"
```

---

### Task 7: Los topes y la respuesta al desconocido

**Files:**
- Create: `backend/src/modules/inbound-email/domain/throttle.ts` + spec
- Modify: `backend/src/modules/inbound-email/inbound-email.service.ts` + spec

**Interfaces:**
- Produce:
  - `export const UNKNOWN_REPLY_COOLDOWN_DAYS = 7`
  - `export const UNKNOWN_REPLY_MAX_PER_HOUR = 20`
  - `export const NEW_TICKETS_MAX_PER_ADDRESS_PER_HOUR = 10`
  - `export function shouldReplyToUnknown(input): boolean`

- [ ] **Step 1: Escribir las pruebas**

```
- a una direccion que ya recibio respuesta hace 2 dias, NO se le responde
- a una que la recibio hace 8 dias, si
- superado el tope global por hora, no se responde a nadie mas (y se registra)
- una direccion que abrio 10 tickets en una hora deja de abrir mas
- **el tope de tickets NO afecta a las respuestas a hilos existentes**: un cliente
  con una conversacion viva no debe quedarse mudo por un tope pensado para el
  correo mal configurado que abre tickets en bucle
```

Esa última distinción es la que evita que el freno contra el abuso rompa el caso legítimo.

- [ ] **Step 2: Escribir el texto de la respuesta al desconocido**

Debe decir, en español y sin jerga: que su dirección no está registrada, **que escriba a una persona de Kubo** —no solo «contacte con su administrador», porque si su empresa nunca fue dada de alta ese administrador no existe—, y **no debe citar el correo original**.

Y va marcada como automática, para que el servidor del otro lado no le conteste.

- [ ] **Step 3: Implementar, ejecutar, commit**

```bash
git commit -m "feat(correo): topes contra bucles y abuso, y la respuesta al desconocido"
```

---

### Task 8: El buzón real, la configuración y el reloj

**Files:**
- Create: `backend/src/modules/inbound-email/imap-mailbox.service.ts`
- Create: `backend/src/modules/inbound-email/inbound-email.scheduler.ts` + spec
- Create: `backend/src/modules/inbound-email/inbound-email.module.ts`
- Modify: `backend/src/app.module.ts`, ajustes del espacio de trabajo, `package.json`

- [ ] **Step 1: Añadir las dependencias**

Run: `cd backend && npm install imapflow mailparser && npm install --save-dev @types/mailparser`

`imapflow` y `mailparser` son del mismo autor que `nodemailer`, que este proyecto ya usa.

- [ ] **Step 2: Implementar el adaptador**

Solo traduce: conecta, lee, convierte a `IncomingMessage`, marca. **Ninguna decisión de negocio vive aquí** — por eso el servicio se puede probar entero sin red.

Dos cosas que debe hacer bien:
- **Tomar solo la cabecera `Authentication-Results` más alta**, la que añadió nuestro servidor. `mailparser` las devuelve todas; las de más abajo las puede haber escrito cualquiera.
- **Preferir `text/plain`**; si solo hay HTML, convertirlo a texto. Nunca devolver HTML.

- [ ] **Step 3: La configuración y el interruptor**

Servidor, puerto, usuario, contraseña, carpeta y un interruptor de encendido en los ajustes del espacio de trabajo, junto a los de SMTP. **El valor por defecto del interruptor es apagado.**

- [ ] **Step 4: El scheduler**

Cada 60 segundos, con `waitForCompletion` y una guarda de reentrada, **igual que el despachador de notificaciones** — que tuvo justamente ese defecto y provocó correos duplicados con una sola instancia.

Si el interruptor está apagado, no hace nada y no se queja.

- [ ] **Step 5: Comprobar que el backend arranca**

Run: `cd backend && npx tsc --noEmit && npm test`

Y arranca el backend **solo si el puerto está libre**. Con la ingesta apagada, no debe intentar conectarse a ningún buzón.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(correo): buzon IMAP, configuracion e ingesta cada minuto"
```

---

### Task 9: La pantalla de correo entrante

**Files:**
- Create: `backend/src/modules/inbound-email/inbound-email.controller.ts`
- Create: `web/src/pages/InboundEmailPage.tsx`
- Modify: `web/src/api/`, `web/src/App.tsx`, y el menú

Una lista de lo que ha entrado, con su resultado, filtrable por resultado, y un botón para reintentar los que quedaron en `ERROR`.

Bajo los guards de personal. **No es una superficie de cliente**: aquí se ven direcciones y asuntos de todas las empresas.

Reglas que la revisión comprobará: el freno síncrono al doble envío en el reintento, limpiar todos los estados de error, y que las fechas se pinten con las etiquetas que manda el backend en hora de Perú —este proyecto lleva **cinco** fallos de zona horaria y el frontend casi nunca pasa la zona.

- [ ] **Step 1 a 4: tipos, pantalla, ruta, compilar y commit**

Run: `cd web && npx tsc --noEmit && npm run build`

```bash
git commit -m "feat(correo): pantalla de correo entrante"
```

---

## Comprobación final antes de fusionar

- [ ] `cd backend && npm test` y `npx tsc --noEmit` — limpios.
- [ ] `cd web && npx tsc --noEmit && npm run build` — limpios.
- [ ] `SELECT COUNT(*) FROM ticket_events WHERE notified_at IS NULL;` sigue en `0`.
- [ ] La migración 021 aparece en `deploy.yml` **y** en los dos ficheros de compose.
- [ ] El interruptor de la ingesta está **apagado** por defecto.

## Lo que solo se puede verificar con el buzón conectado

Esto **no lo cubre ninguna prueba** y va en la nota de puesta en marcha:

1. **Que el proveedor añada `Authentication-Results`.** Si no lo hace, no entra ningún correo. Es lo primero, y por eso la ingesta nace apagada.
2. Que una respuesta real de **Outlook** y otra de **Gmail** traigan las cabeceras que la correlación espera.
3. Que el acuse llegue a la bandeja del cliente y **no a spam** — para lo que hace falta publicar el DMARC que sigue pendiente.
4. Que un correo con adjunto se procese sin romperse.
5. Que el buzón no acumule correo sin marcar por un fallo del marcado.
