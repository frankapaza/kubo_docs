-- =========================================================================
--  Migración 018 — Conversación y adjuntos en tickets
-- =========================================================================
--  Hoy el cliente abre un ticket y ya no puede escribir nada más: ni añadir
--  un dato que se le olvidó, ni contestar cuando el ticket queda en espera.
--  El equipo tampoco tiene dónde responderle dentro del ticket. Esta
--  migración pone la base de datos de eso:
--
--    · `ticket_messages`      el hilo, con notas internas que el cliente no ve
--    · `ticket_attachments`   imágenes y PDF, colgados de un mensaje del hilo
--    · `ticket_events.type`   un valor nuevo del enum para el mensaje
--    · dos plantillas de aviso más en `notification_templates`
--
--  Todo lo que toca algo que ya existe va guardado con `information_schema` y
--  `TABLE_SCHEMA = DATABASE()`, igual que la 015 y la 016: un ALTER sin
--  guardar rompe el initdb al reejecutarse y detiene la cadena entera de
--  migraciones que hay detrás.
--
--  LO QUE NO ESTÁ AQUÍ Y ES DELIBERADO
--  No hay claves foráneas. Ninguna tabla de la mesa de servicio las tiene
--  (ver la 010: `tickets`, `ticket_events`, `client_systems`… todas sin FK), y
--  estrenarlas justo en estas dos las dejaría siendo las únicas de la mesa con
--  borrado en cascada implícito. La integridad la sostiene el servicio, como
--  en el resto del módulo.
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

-- -------------------------------------------------------------------------
-- 1) El hilo de mensajes
-- -------------------------------------------------------------------------
--  `visibility` es lo único que separa una respuesta al cliente de una nota
--  que el equipo se deja a sí mismo. Va en el ENUM y no en un `TINYINT`
--  porque de un booleano nadie sabe, leyendo una fila suelta, cuál de los dos
--  lados es el que el cliente ve — y equivocarse aquí es enseñarle una nota
--  interna, que es el peor fallo posible de esta funcionalidad.
--
--  No lleva DEFAULT a propósito. El valor seguro sería 'INTERNA', pero
--  entonces un INSERT que se olvide de la columna guardaría en silencio como
--  nota interna un mensaje que el cliente escribió para el equipo: el mensaje
--  desaparece del hilo del cliente sin ningún error. Sin DEFAULT, ese mismo
--  INSERT revienta con `ER_NO_DEFAULT_FOR_FIELD` y se arregla al escribirlo.
--
--  LAS DOS COLUMNAS DE AUTOR
--  `author_user_id` (alguien del equipo) y `author_client_user_id` (alguien
--  del cliente) son excluyentes: exactamente una de las dos va llena. Es la
--  misma invariante que `tickets.created_by_user_id` /
--  `created_by_client_user_id` (013), y como allí, **se sostiene en el
--  servicio, no en el esquema**: son dos espacios de identificadores
--  distintos, `users` y `client_users`, y un CHECK que solo cuente nulos no
--  impediría el error que de verdad importa —poner el id de un cliente en la
--  columna del equipo—. Dejarla en el esquema daría una falsa sensación de
--  garantía sobre lo único que hay que revisar mensaje a mensaje: de qué lado
--  viene.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_messages (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id              BIGINT UNSIGNED NOT NULL,
  body_md                TEXT            NOT NULL,
  visibility             ENUM('PUBLICA','INTERNA') NOT NULL
                         COMMENT 'INTERNA no la ve el cliente en ningun caso',
  author_user_id         BIGINT UNSIGNED NULL
                         COMMENT 'autor del equipo; excluyente con la siguiente',
  author_client_user_id  BIGINT UNSIGNED NULL
                         COMMENT 'autor del cliente; excluyente con la anterior',
  created_at             TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- El hilo se lee siempre igual: los mensajes de UN ticket en orden de
  -- llegada. Con las dos columnas en el índice, esa consulta no toca la tabla
  -- ni ordena en memoria.
  INDEX idx_ticket_messages_ticket (ticket_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- 2) Los adjuntos
-- -------------------------------------------------------------------------
--  TODO ADJUNTO CUELGA DE UN MENSAJE
--  Este bloque decía lo contrario --«`message_id` es nulo cuando el archivo se
--  subió al crear el ticket… el adjunto cuelga siempre del ticket y solo a
--  veces de un mensaje»--, y esa premisa se retiró antes de terminar la
--  funcionalidad: el alta del ticket crea el ticket **con su primer mensaje**
--  y `TicketAttachmentsService.upload` exige `message_id`, así que no queda
--  ningún camino que escriba una fila sin él.
--
--  La columna se queda `NULL`-able por las filas anteriores a esa decisión,
--  pero un nulo aquí es una **anomalía**, no un caso normal: sin mensaje el
--  adjunto no hereda ninguna visibilidad, y uno cuya visibilidad nadie eligió
--  no se le puede enseñar a un cliente. Para quien no es del equipo el
--  huérfano no existe (`INNER JOIN` en `listAttachments`, 404 al descargar);
--  al equipo sí, que es quien tiene que poder verlo.
--
--  El texto del `COMMENT` de la columna, más abajo, se queda como se aplicó:
--  lo corrige la **019**, que es el registro de ese cambio. Reescribirlo aquí
--  dejaría el fichero diciendo algo que nunca corrió con ese texto.
--
--  `filename` vs `storage_key` — son dos cosas distintas y no se pueden
--  confundir:
--    · `filename` es lo que el usuario subió («Captura del error.png»). Se
--      guarda **solo para mostrarlo**. Lo escribe quien sube, así que nunca
--      puede tocar el sistema de ficheros.
--    · `storage_key` la genera el servidor y es la única que llega a
--      `IStorageService`. Va con UNIQUE: dos filas apuntando al mismo blob
--      harían que borrar una dejara a la otra señalando un archivo que ya no
--      está, y el índice convierte ese fallo silencioso en un error al
--      insertar.
--
--  `mime_type` es el tipo **detectado** leyendo los primeros bytes, no el
--  `Content-Type` que declara el navegador. Guardar el declarado sería
--  guardar lo que dice el que sube: un .exe anunciado como image/png se
--  serviría después con ese tipo. La detección la hace el servicio; la
--  columna solo tiene que dejar claro cuál de los dos guarda.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_attachments (
  id                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id                   BIGINT UNSIGNED NOT NULL,
  message_id                  BIGINT UNSIGNED NULL
                              COMMENT 'NULL si se subio al crear el ticket',
  filename                    VARCHAR(255)    NOT NULL
                              COMMENT 'nombre original, solo para mostrar',
  storage_key                 VARCHAR(255)    NOT NULL
                              COMMENT 'clave generada por el servidor',
  mime_type                   VARCHAR(120)    NOT NULL
                              COMMENT 'tipo detectado, no el declarado',
  size_bytes                  INT UNSIGNED    NOT NULL,
  uploaded_by_user_id         BIGINT UNSIGNED NULL
                              COMMENT 'del equipo; excluyente con la siguiente',
  uploaded_by_client_user_id  BIGINT UNSIGNED NULL
                              COMMENT 'del cliente; excluyente con la anterior',
  created_at                  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_ticket_attachments_key (storage_key),
  INDEX idx_ticket_attachments_ticket (ticket_id, created_at),
  INDEX idx_ticket_attachments_message (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================================
--  3) El tipo de evento nuevo: MESSAGE_POSTED
-- =========================================================================
--  POR QUÉ NO SE REUTILIZA `COMMENT`
--  `COMMENT` ya existe en este enum y significa otra cosa: es el marcador que
--  escribe `TicketAIService` cuando empuja el ticket a Jira o genera el
--  documento de cierre, con el dato en `payload`. No lo escribe una persona y
--  no es texto para nadie. Está **excluido a mano** del timeline del portal
--  (`CLIENT_VISIBLE_EVENT_TYPES` en `portal-tickets.service.ts`) precisamente
--  por eso. Meter ahí los mensajes de verdad significaría o publicar los
--  marcadores de la IA al cliente, o filtrar por `payload` fila a fila para
--  distinguir dos cosas que nunca debieron compartir tipo.
--
--  POR QUÉ `MESSAGE_POSTED` Y NO `MESSAGE`
--  El resto del enum nombra hechos consumados en participio: CREATED,
--  TRIAGED, ASSIGNED, RESOLVED, REOPENED, PRIORITY_OVERRIDDEN. `MESSAGE` a
--  secas nombraría una cosa, no un hecho, y se leería a un golpe de vista
--  como sinónimo de `COMMENT` — que es justo la confusión que hay que evitar.
--  `MESSAGE_POSTED` dice qué pasó y no se parece a nada de lo que ya hay.
--
--  EL PUNTO QUE NO SE PUEDE EQUIVOCAR — el MODIFY lista TODOS los valores.
--  Un `MODIFY ... ENUM(...)` que omita un valor no da error: lo borra, y las
--  filas que lo usaban se quedan con la cadena vacía. `ticket_events` tiene
--  cientos de filas y todos estos valores están en uso. La lista de abajo se
--  leyó de la base antes de escribirla, no de memoria:
--
--    docker exec kubo-mysql-dev mysql -uroot -proot kubo_devdocs \
--      -e "SHOW COLUMNS FROM ticket_events LIKE 'type'\G"
--
--    enum('CREATED','TRIAGED','ASSIGNED','TAKEN','STATUS_CHANGED','ESCALATED',
--         'COMMENT','RESOLVED','CLOSED','REOPENED','SLA_AT_RISK',
--         'PRIORITY_OVERRIDDEN')
--
--  El orden también se respeta: en un ENUM el orden define el valor numérico
--  interno de cada etiqueta, y reordenarlos reinterpretaría las filas ya
--  guardadas. El valor nuevo va al final, que es donde no cambia nada.
--
--  Y por eso el ALTER va guardado aunque redefinir un enum con el mismo
--  conjunto no falle: la guarda mira `COLUMN_TYPE` y lo salta en la segunda
--  pasada, así una reejecución no reescribe la definición de una columna de
--  una tabla grande para nada. El LIKE busca la etiqueta **entrecomillada**
--  (`'MESSAGE_POSTED'`) y no el nombre suelto: así no la daría por presente un
--  valor futuro que la contuviera como prefijo o sufijo.
-- =========================================================================
DROP PROCEDURE IF EXISTS kubo_add_event_type_018;
DELIMITER //
CREATE PROCEDURE kubo_add_event_type_018()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ticket_events'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ticket_events'
      AND COLUMN_NAME = 'type'
      AND COLUMN_TYPE LIKE '%''MESSAGE_POSTED''%'
  ) THEN
    ALTER TABLE ticket_events MODIFY COLUMN type
      ENUM('CREATED','TRIAGED','ASSIGNED','TAKEN','STATUS_CHANGED','ESCALATED',
           'COMMENT','RESOLVED','CLOSED','REOPENED','SLA_AT_RISK',
           'PRIORITY_OVERRIDDEN','MESSAGE_POSTED') NOT NULL;
  END IF;
END //
DELIMITER ;

CALL kubo_add_event_type_018();

DROP PROCEDURE IF EXISTS kubo_add_event_type_018;

-- =========================================================================
--  4) Las dos plantillas de aviso
-- =========================================================================
--  Solo los mensajes PÚBLICOS avisan, y solo en los dos sentidos que cruzan
--  la frontera entre cliente y equipo:
--
--    · TICKET_MESSAGE_FROM_CLIENT / TEAM   escribió el cliente → avisa al equipo
--    · TICKET_MESSAGE_FROM_TEAM   / CLIENT respondió el equipo → avisa al cliente
--
--  El sufijo nombra a QUIEN ESCRIBE, no a quién se avisa; la columna
--  `audience` dice lo segundo. Nombrarlas por el destinatario habría dado dos
--  claves que se leen al revés de lo que hacen.
--
--  Una nota INTERNA no dispara ninguno de los dos: no la ve el cliente y el
--  aviso al equipo por su propia nota sería ruido. Eso lo decide
--  `notification-rules.ts` (tarea 8); aquí solo se siembran los textos.
--
--  LA REGLA QUE NO SE PUEDE ROMPER — el público manda sobre las variables.
--  Una plantilla de CLIENT solo puede usar las variables de cliente:
--
--    CLIENT: {{codigo}} {{asunto}} {{estado}} {{fecha}} {{razon_social}}
--            {{enlace_portal}}
--    TEAM  : las de CLIENT y además {{prioridad}} {{sla}} {{responsable}}
--            {{motivo}} {{enlace_panel}}
--
--  (el catálogo vive en `notifications/domain/template-renderer.ts`). Colar
--  una de equipo en la de cliente filtraría por correo justo lo que el portal
--  se cuida de ocultar, y un correo no se retira.
--
--  Y NINGUNA DE LAS DOS LLEVA EL TEXTO DEL MENSAJE. Es la decisión que más se
--  nota: el aviso dice que hay respuesta y manda al portal, no la reproduce.
--  Un mensaje puede contener datos que el que responde puso ahí contando con
--  que se quedan en el ticket, y el correo va a una bandeja que no controlamos
--  y que se reenvía sola. Además, sin el texto dentro, un mensaje editado o
--  borrado después no deja copia circulando.
--
--  El párrafo final sobre responder al correo es el de la 017, no el de la
--  015: responder FUNCIONA —`EmailService` pone `replyTo`— pero no se registra
--  en el ticket ni avisa a nadie. Las siete plantillas anteriores lo dicen así
--  y `seeded-templates.consistency.spec.ts` lo vigila; estas dos nacen ya con
--  el texto correcto en vez de con la promesa falsa que hubo que corregir.
--
--  `ON DUPLICATE KEY UPDATE id = id` (clave única `trigger_key` + `audience`)
--  hace que reejecutar esto sea un no-op: no se pisa lo que el usuario haya
--  editado desde el panel, igual que en la 015.
-- =========================================================================
INSERT INTO notification_templates (trigger_key, audience, subject, body_md) VALUES

-- --- Escribió el cliente: se avisa al equipo -------------------------------
('TICKET_MESSAGE_FROM_CLIENT', 'TEAM',
 '[{{codigo}}] El cliente escribió en el ticket — {{razon_social}}',
 '{{razon_social}} dejó un mensaje nuevo el {{fecha}}.

- **Código:** {{codigo}}
- **Asunto:** {{asunto}}
- **Estado:** {{estado}}
- **Prioridad:** {{prioridad}}
- **Vence:** {{sla}}
- **Responsable:** {{responsable}}

El mensaje no va en este correo: léelo y contéstalo en el panel, que es donde
queda registrado y donde el cliente lo va a ver.
{{enlace_panel}}

Este correo es automático. Si respondes, tu respuesta llega al buzón del
remitente, pero **no se registra en el ticket ni avisa a nadie
automáticamente**: el cliente no la vería. Contesta desde el panel.'),

-- --- Respondió el equipo: se avisa al cliente ------------------------------
('TICKET_MESSAGE_FROM_TEAM', 'CLIENT',
 '[{{codigo}}] Te respondimos: {{asunto}}',
 'Hola,

Te dejamos una respuesta en tu ticket **{{codigo}}** el {{fecha}}.

- **Asunto:** {{asunto}}
- **Estado:** {{estado}}
- **Empresa:** {{razon_social}}

Por seguridad no copiamos el mensaje aquí. Ábrelo en el portal para leerlo
completo y seguir la conversación:
{{enlace_portal}}

Este correo es automático. Si respondes, tu respuesta llega a un buzón que
leemos, pero **no se registra en el ticket ni avisa a nadie automáticamente**.
Escríbenos desde el portal: así queda en el ticket y lo ve todo el equipo.')

ON DUPLICATE KEY UPDATE id = id;

-- =========================================================================
--  NOTA PARA QUIEN DESPLIEGUE ESTO
-- =========================================================================
--  `.github/workflows/deploy.yml` comprueba, antes de reconstruir, que hay
--  exactamente 7 plantillas sembradas y aborta si no. Con estas dos son 9, y
--  ese número está actualizado en el mismo commit que este fichero. Si alguien
--  vuelve a añadir plantillas aquí, tiene que subir también ese recuento o el
--  despliegue se parará en seco con la versión vieja sirviendo.
-- =========================================================================
