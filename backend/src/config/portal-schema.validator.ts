import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Algo que el código da por hecho y la base no tiene todavía. */
interface MissingItem {
  kind: 'tabla' | 'columna';
  /** `client_users` o `tickets.created_by_client_user_id`. */
  name: string;
  /**
   * Los ficheros SQL que hay que pasar, **en orden**, para que eso exista.
   *
   * Casi siempre es uno solo. Es una lista porque hay un requisito que no lo
   * cumple ninguna migración por sí sola: `workspace_settings.team_inbox_email`
   * (ver `TEAM_INBOX_FILES`). Nombrar solo la última de la cadena manda al
   * operador a aplicar algo que no puede crear lo que falta.
   */
  files: readonly string[];
}

/**
 * Cómo aplicar a mano un fichero SQL sobre una base que ya tiene datos.
 *
 * La ruta es relativa a `backend/sql/`, así que sirve igual para una migración
 * numerada (`migrations/015_...`) que para los `add_*.sql` que viven un nivel
 * más arriba. Es justo lo que hacía falta para poder nombrar los dos ficheros
 * que crean `workspace_settings`.
 *
 * El `sh -c` con comillas simples no es adorno: la contraseña vive dentro del
 * contenedor, en `MYSQL_ROOT_PASSWORD`. Sin él la expande el shell del host,
 * donde no existe —allí se llama `DB_ROOT_PASSWORD`—, y MySQL responde
 * "Access denied (using password: NO)" justo cuando el backend está en bucle
 * de reinicio y el operador menos margen tiene para adivinar por qué.
 */
const comoAplicarla = (file: string): string =>
  `docker compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" kubo_devdocs' ` +
  `< backend/sql/${file}`;

/**
 * Comprueba al arranque que las migraciones 013, 014 y 015 están aplicadas, y
 * aborta si no.
 *
 * El portal de clientes no solo añade tablas nuevas: **modifica entidades ya
 * existentes**. `ticket.entity.ts` declara `created_by_client_user_id` y
 * `ticket-event.entity.ts` declara `actor_client_user_id`, así que TypeORM las
 * emite en todo SELECT e INSERT sobre `tickets` y `ticket_events`. Contra una
 * base sin la 013, eso es `ER_BAD_FIELD_ERROR` en el listado de tickets, el
 * detalle, cada transición, la asignación y el escaneo de SLA: la rama tumba
 * lo que ya funcionaba, y lo hace con un aluvión de 500 que no dice por qué.
 *
 * Y es un escenario probable, no teórico: las migraciones solo se ejecutan por
 * `docker-entrypoint-initdb.d`, que MySQL corre **únicamente sobre un
 * directorio de datos vacío**. El volumen `mysql_data` sobrevive a
 * `docker compose up -d --build`, así que cualquier despliegue sobre una base
 * con datos previos se queda sin la 013 y no hay runner que lo detecte.
 *
 * Sigue la forma de `DbTimezoneInitializer` y `JwtSecretsValidator`: hacer
 * explícita al boot una precondición que de otro modo solo se nota cuando ya
 * es tarde, y abortar con un mensaje que diga qué falta y cómo arreglarlo en
 * vez de aceptar tráfico en ese estado.
 *
 * Un requisito no encaja en "falta tal migración" y por eso se trata aparte:
 * `workspace_settings.team_inbox_email`. Esa columna la añade la 015, pero
 * solo si la tabla ya existe —su ayudante está guardado también por tabla, y
 * con razón—, y `workspace_settings` la crean los `add_workspace_*.sql`, que
 * hasta ahora solo montaba `docker-compose.dev.yml`. En el stack de producción
 * la 015 corría entera, omitía la columna en silencio y el arranque abortaba
 * pidiendo la 015: la migración que el operador ya había aplicado y la única
 * que no puede arreglarlo. Ver `TEAM_INBOX_FILES` y `notaBuzon`.
 *
 * Consulta `information_schema` en vez de dejar que falle un SELECT: así se
 * distingue "falta la migración" de "la base está caída", y el diagnóstico
 * sale entero de una sola pasada (tabla y las cuatro columnas), no de la
 * primera consulta que reviente.
 */
@Injectable()
export class PortalSchemaValidator implements OnApplicationBootstrap {
  private readonly logger = new Logger('PortalSchemaValidator');

  private static readonly MIGRATION_013 = 'migrations/013_portal_clientes.sql';
  private static readonly MIGRATION_014 = 'migrations/014_audit_client_user.sql';
  private static readonly MIGRATION_015 = 'migrations/015_notificaciones.sql';
  private static readonly MIGRATION_016 = 'migrations/016_notify_next_attempt.sql';
  private static readonly MIGRATION_018 = 'migrations/018_conversacion_adjuntos.sql';
  private static readonly MIGRATION_020 = 'migrations/020_requerimientos_portal.sql';
  private static readonly MIGRATION_021 = 'migrations/021_correo_entrante.sql';
  private static readonly MIGRATION_023 = 'migrations/023_correo_entrante_imap.sql';
  private static readonly MIGRATION_026 = 'migrations/026_invitaciones_portal.sql';

  /**
   * Lo que hace falta para que exista `workspace_settings.team_inbox_email`, en
   * este orden y no en otro.
   *
   * La columna la añade la 015, pero su ayudante está guardado **también por
   * tabla** y se salta la columna en silencio si `workspace_settings` no
   * existe. Esa guarda es correcta y deliberada: sin ella el ALTER reventaría
   * y, bajo `docker-entrypoint-initdb.d`, un fichero que falla detiene la
   * cadena entera de migraciones. Pero significa que en una base donde esa
   * tabla nunca se creó —el stack de `docker-compose.yml` era exactamente
   * eso— la 015 corre entera, omite la columna, y el arranque aborta. Decirle
   * ahí al operador "aplica la 015, es idempotente" es mandarlo a lo que ya
   * hizo y a lo que no puede funcionar.
   *
   * El orden importa dos veces: `add_workspace_smtp_and_session.sql` crea
   * `smtp_from`, y la 015 añade el buzón `AFTER smtp_from`.
   */
  private static readonly TEAM_INBOX_FILES: readonly string[] = [
    'add_workspace_settings.sql',
    'add_workspace_smtp_and_session.sql',
    PortalSchemaValidator.MIGRATION_015,
  ];

  /** Tablas nuevas de la 013 y la 015. */
  private static readonly REQUIRED_TABLES: ReadonlyArray<{
    table: string;
    files: readonly string[];
  }> = [
    { table: 'client_users', files: [PortalSchemaValidator.MIGRATION_013] },
    // 015: sin ella el vigilante no tiene plantillas que leer y no sale
    // ningún aviso; peor, la pantalla de administración responde 500.
    { table: 'notification_templates', files: [PortalSchemaValidator.MIGRATION_015] },
    // 018: el hilo de mensajes y sus adjuntos. Sin ellas, el detalle del
    // ticket —en el panel y en el portal— responde 500 al leer la
    // conversación, y el cliente vuelve a quedarse sin poder escribir después
    // de abrir el ticket, que es justo lo que la funcionalidad arregla.
    //
    // El valor `MESSAGE_POSTED` que la 018 añade a `ticket_events.type` no se
    // comprueba aquí, y no por olvido: este validador mira `information_schema`
    // por tabla y por columna, y un valor de enum no es ninguna de las dos
    // cosas. Comprobarlo pediría leer y parsear `COLUMN_TYPE`, una consulta de
    // otra forma para el único requisito que no encaja en el modelo. Además no
    // hace falta: la 018 amplía el enum y crea estas dos tablas en el mismo
    // fichero, así que exigir las tablas ya exige haber pasado la migración.
    { table: 'ticket_messages', files: [PortalSchemaValidator.MIGRATION_018] },
    { table: 'ticket_attachments', files: [PortalSchemaValidator.MIGRATION_018] },
    // 026: las invitaciones del portal. `ClientUserInvitation` la declara como
    // entidad, así que sin ella TypeORM revienta en cuanto un administrador de
    // cliente abre la pantalla de su gente — y el alta desde el portal deja de
    // existir sin que nadie sepa por qué.
    { table: 'client_user_invitations', files: [PortalSchemaValidator.MIGRATION_026] },
    // La 019 tampoco está aquí, y por el mismo motivo que el enum de arriba
    // más uno propio: no crea ninguna tabla ni ninguna columna --solo corrige
    // el `COMMENT` de `ticket_attachments.message_id`--, así que no hay nada
    // que exigir con este modelo. Y sobre todo: una base sin la 019 funciona
    // exactamente igual. Abortar el arranque por un texto desactualizado sería
    // dejar el servicio caído por algo que no rompe nada, que es justo lo que
    // este validador no debe hacer. Se anota para que la ausencia se lea como
    // una decisión y no como un descuido.
  ];

  /**
   * Columnas hermanas del actor que las migraciones del portal añaden a tablas
   * ya existentes. Son las peligrosas: sin ellas, las entidades mienten sobre
   * el esquema real y lo que deja de funcionar es código que ya existía.
   */
  private static readonly REQUIRED_COLUMNS: ReadonlyArray<{
    table: string;
    column: string;
    files: readonly string[];
  }> = [
    { table: 'tickets', column: 'created_by_client_user_id', files: [PortalSchemaValidator.MIGRATION_013] },
    { table: 'ticket_events', column: 'actor_client_user_id', files: [PortalSchemaValidator.MIGRATION_013] },
    { table: 'work_items', column: 'created_by_client_user_id', files: [PortalSchemaValidator.MIGRATION_013] },
    // 020: sin ella, `work-item.entity.ts` pide una columna que no existe y
    // TypeORM la emite en TODO SELECT sobre work_items — el tablero interno
    // entero deja de cargar, no solo el portal. Falla en el arranque, que es
    // donde se ve, en vez de en la primera consulta de un usuario.
    { table: 'work_items', column: 'origin', files: [PortalSchemaValidator.MIGRATION_020] },
    { table: 'work_item_events', column: 'actor_client_user_id', files: [PortalSchemaValidator.MIGRATION_013] },
    // 014: sin ella, la entidad AuditLog pide una columna que no existe y
    // TODA la auditoría se pierde en silencio (el interceptor degrada el
    // fallo del INSERT a un warn por petición).
    { table: 'audit_log', column: 'client_user_id', files: [PortalSchemaValidator.MIGRATION_014] },
    // 015: las tres columnas de la bandeja de salida.
    //
    // Aquí valen las dos razones. La primera es la de siempre desde que el
    // vigilante existe: `ticket-event.entity.ts` ya declara estas columnas, así
    // que TypeORM las emite en todo SELECT sobre `ticket_events` y sin ellas es
    // ER_BAD_FIELD_ERROR en el timeline de cada ticket.
    //
    // La segunda es exclusiva de la 015 y es la que de verdad importa: protege
    // el sellado del histórico. El UPDATE que marca los eventos viejos como ya
    // notificados vive DENTRO de la 015, en el mismo IF que crea
    // `notified_at`. Si la columna apareciera por otro camino —creada a mano
    // para "desbloquear" un arranque, por ejemplo—, el histórico quedaría sin
    // sellar y el vigilante mandaría un correo por cada evento de meses atrás,
    // a clientes reales, sin vuelta atrás. Exigir la migración es exigir el
    // sellado, y por eso el mensaje de error desaconseja el atajo.
    { table: 'ticket_events', column: 'notified_at', files: [PortalSchemaValidator.MIGRATION_015] },
    { table: 'ticket_events', column: 'notify_attempts', files: [PortalSchemaValidator.MIGRATION_015] },
    { table: 'ticket_events', column: 'notify_last_error', files: [PortalSchemaValidator.MIGRATION_015] },
    // 016: el instante del siguiente intento.
    //
    // Sin ella no es solo que falle el SELECT: es que el esquema de espera que
    // la sustituía estaba roto. Medir el retraso desde `created_at` hacía que
    // cualquier evento más viejo que el retraso mayor gastase sus tres intentos
    // en tres pasadas seguidas y quedara abandonado — justo lo que pasa cuando
    // el SMTP vuelve tras una caída larga y el vigilante encuentra la cola
    // envejecida. Volver a arrancar sin esta columna es volver a ese fallo.
    {
      table: 'ticket_events',
      column: 'notify_next_attempt_at',
      files: [PortalSchemaValidator.MIGRATION_016],
    },
    // El buzón del equipo. Sin él la pantalla de ajustes responde 500 al leer o
    // guardar, y sin esta línea el arranque no lo habría avisado.
    //
    // Es el único requisito con una cadena de tres ficheros detrás, y no por
    // gusto: ver `TEAM_INBOX_FILES`. La 015 sola no puede crear esta columna
    // sobre una base donde `workspace_settings` no existe.
    {
      table: 'workspace_settings',
      column: 'team_inbox_email',
      files: PortalSchemaValidator.TEAM_INBOX_FILES,
    },
    // 021: las columnas del correo entrante. Ninguna entidad las declara
    // todavía —eso llega en una tarea posterior—, pero el esquema se despliega
    // antes que ese código, y sin él la correlación de respuestas no tiene
    // contra qué buscar, que es el punto entero del proyecto.
    { table: 'tickets', column: 'email_message_id', files: [PortalSchemaValidator.MIGRATION_021] },
    {
      table: 'ticket_messages',
      column: 'inbound_email_id',
      files: [PortalSchemaValidator.MIGRATION_021],
    },
    { table: 'ticket_messages', column: 'body_full', files: [PortalSchemaValidator.MIGRATION_021] },
    // El Message-ID de cada aviso saliente, en la misma tabla que hace de
    // bandeja de salida desde la 015. Sin él, `In-Reply-To` no tiene con qué
    // casar la respuesta del cliente con el ticket que la originó.
    {
      table: 'ticket_events',
      column: 'sent_message_id',
      files: [PortalSchemaValidator.MIGRATION_021],
    },
    // 023: la configuración del buzón IMAP real (Task 8), junto a la de SMTP
    // en la misma fila. `WorkspaceSetting` declara las siete columnas nuevas
    // a la vez, así que basta una para detectar la migración entera -- mismo
    // criterio que `notify_next_attempt_at` (016) y `team_inbox_email` (015):
    // sin ella, cualquier lectura o escritura de `workspace_settings`
    // (los ajustes del emisor, el envío de correo, el reloj de ingesta)
    // responde ER_BAD_FIELD_ERROR, no solo la pantalla de correo entrante.
    {
      table: 'workspace_settings',
      column: 'imap_enabled',
      files: [PortalSchemaValidator.MIGRATION_023],
    },
    // 026: la autoría honesta. `client-user.entity.ts` ya declara esta columna,
    // así que TypeORM la emite en TODO SELECT e INSERT sobre `client_users`:
    // sin ella el login del portal responde 500 (ER_BAD_FIELD_ERROR), no solo
    // el alta nueva.
    //
    // `created_by` pasando a nulable no se exige aquí: este validador mira
    // presencia, no nulabilidad. Va en el mismo fichero que esta columna, así
    // que exigir la columna ya exige haber pasado la migración entera.
    {
      table: 'client_users',
      column: 'created_by_client_user_id',
      files: [PortalSchemaValidator.MIGRATION_026],
    },
  ];

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    const missing = [...(await this.findMissingTables()), ...(await this.findMissingColumns())];

    if (missing.length > 0) {
      throw new Error(PortalSchemaValidator.buildMessage(missing));
    }

    this.logger.log(
      'Esquema del portal de clientes verificado: están aplicados los ' +
        `${PortalSchemaValidator.requiredFiles().length} ficheros que exige este validador ` +
        `(${PortalSchemaValidator.requiredFiles().join(', ')}), con sus ` +
        `${PortalSchemaValidator.REQUIRED_TABLES.length} tablas y sus ` +
        `${PortalSchemaValidator.REQUIRED_COLUMNS.length} columnas.`,
    );
  }

  /**
   * Todos los ficheros que este validador exige de verdad, sin repetir y en
   * orden.
   *
   * **Derivado de las dos listas, nunca escrito a mano.** El mensaje de
   * arranque enumeraba cinco migraciones (013, 014, 015, 016 y 018) cuando ya
   * se exigían nueve —faltaban la 020, la 021, la 023 y la 026, además de los
   * dos `add_workspace_*.sql` de la cadena del buzón—, y el desfase crecía con
   * cada tarea: el operador leía «verificado» junto a una lista que ya no
   * describía lo comprobado. Calcularlo cierra el defecto de raíz en vez de
   * corregir la lista una vez más — el próximo requisito aparece solo.
   *
   * El `sort` deja los `add_*.sql` delante de `migrations/*`, que es además el
   * orden en que hay que aplicarlos; mismo criterio que `buildMessage`.
   */
  private static requiredFiles(): string[] {
    const todos = [
      ...PortalSchemaValidator.REQUIRED_TABLES.flatMap((t) => t.files),
      ...PortalSchemaValidator.REQUIRED_COLUMNS.flatMap((c) => c.files),
    ];
    return [...new Set(todos)].sort();
  }

  private async findMissingTables(): Promise<MissingItem[]> {
    const rows: Array<{ tableName: string }> = await this.dataSource.query(
      'SELECT TABLE_NAME AS tableName FROM information_schema.TABLES ' +
        'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)',
      [PortalSchemaValidator.REQUIRED_TABLES.map((t) => t.table)],
    );
    const present = new Set(rows.map((r) => r.tableName));
    return PortalSchemaValidator.REQUIRED_TABLES.filter((t) => !present.has(t.table)).map((t) => ({
      kind: 'tabla',
      name: t.table,
      files: t.files,
    }));
  }

  private async findMissingColumns(): Promise<MissingItem[]> {
    const tables = [...new Set(PortalSchemaValidator.REQUIRED_COLUMNS.map((c) => c.table))];
    const rows: Array<{ tableName: string; columnName: string }> = await this.dataSource.query(
      'SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.COLUMNS ' +
        'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)',
      [tables],
    );
    const present = new Set(rows.map((r) => `${r.tableName}.${r.columnName}`));
    return PortalSchemaValidator.REQUIRED_COLUMNS.filter(
      (c) => !present.has(`${c.table}.${c.column}`),
    ).map((c) => ({ kind: 'columna', name: `${c.table}.${c.column}`, files: c.files }));
  }

  /**
   * Un solo mensaje con todo lo que falta, agrupado por la cadena de ficheros
   * que lo arregla: el operador ve de una vez qué tiene que pasar y en qué
   * orden, sin arrancar cinco veces para descubrirlo de uno en uno.
   */
  private static buildMessage(missing: MissingItem[]): string {
    // La clave agrupa por cadena completa, no por el último fichero: el buzón
    // del equipo necesita tres y no puede mezclarse con lo que solo necesita
    // la 015. El `sort` deja los `add_*.sql` delante de `migrations/*`, que es
    // además el orden en que hay que aplicarlos.
    const cadenas = [...new Set(missing.map((m) => m.files.join(' → ')))].sort();

    const detalle = cadenas
      .map((cadena) => {
        const suyos = missing.filter((m) => m.files.join(' → ') === cadena);
        const tablas = suyos.filter((m) => m.kind === 'tabla').map((m) => m.name);
        const columnas = suyos.filter((m) => m.kind === 'columna').map((m) => m.name);
        const que = [
          tablas.length > 0 ? `tablas: ${tablas.join(', ')}` : null,
          columnas.length > 0 ? `columnas: ${columnas.join(', ')}` : null,
        ]
          .filter(Boolean)
          .join('; ');
        const ordenes = suyos[0].files.map((f) => `    ${comoAplicarla(f)}`).join('\n');
        return `${cadena} (${que})\n${ordenes}`;
      })
      .join('\n  ');

    return (
      'Faltan migraciones por aplicar en esta base de datos:\n  ' +
      `${detalle}\n` +
      'Las entidades ya declaran esas columnas, así que TypeORM las emite en todo SELECT e ' +
      'INSERT: sin la 013, el listado de tickets, el detalle, las transiciones, la asignación y ' +
      'el escaneo de SLA responden 500 (ER_BAD_FIELD_ERROR); sin la 014 se pierde toda la ' +
      'auditoría; sin la 015 no hay bandeja de salida ni plantillas, y no sale ningún aviso por ' +
      'correo. No añadas a mano las columnas de la 015: el sellado del histórico va dentro de esa ' +
      'migración, y sin él el vigilante envía un correo por cada evento de meses atrás. Sin la ' +
      '018 no hay hilo de mensajes ni adjuntos: el detalle del ticket responde 500 al leer la ' +
      'conversación, en el panel y en el portal. ' +
      PortalSchemaValidator.notaBuzon(missing) +
      'Las migraciones solo se ejecutan por docker-entrypoint-initdb.d, y MySQL solo ' +
      'corre ese directorio sobre un datadir vacío: una base que ya tenía datos NO las recibe al ' +
      'reconstruir los contenedores. Aplícalas a mano y vuelve a arrancar: las migraciones ' +
      'numeradas son idempotentes, pero los add_workspace_*.sql no llevan guardas de ' +
      'information_schema —son ALTER pelados—, así que si alguna de sus columnas ya estaba, el ' +
      'fichero falla entero y hay que aplicar a mano solo lo que falte.'
    );
  }

  /**
   * La nota del buzón del equipo, solo cuando es esa columna la que falta.
   *
   * Va aparte y condicionada porque es el único caso en que el consejo general
   * —"aplica la migración que la trae"— es directamente falso: la 015 ya se
   * aplicó y no puede crearla. Ponerla siempre la convertiría en ruido y
   * dejaría de leerse justo el día que hace falta.
   */
  private static notaBuzon(missing: MissingItem[]): string {
    const falta = missing.some((m) => m.name === 'workspace_settings.team_inbox_email');
    if (!falta) return '';
    return (
      'Ojo con workspace_settings.team_inbox_email: esa columna la añade la 015, pero su ayudante ' +
      'está guardado también por tabla y se salta la columna EN SILENCIO cuando ' +
      'workspace_settings no existe (la guarda es deliberada: sin ella el ALTER rompería el ' +
      'initdb entero). Así que volver a pasar solo la 015 no la crea nunca; hay que crear antes ' +
      'la tabla con add_workspace_settings.sql y add_workspace_smtp_and_session.sql —en ese ' +
      'orden, porque la 015 añade el buzón AFTER smtp_from— y pasar la 015 después. '
    );
  }
}
