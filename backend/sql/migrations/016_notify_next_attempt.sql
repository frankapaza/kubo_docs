-- =========================================================================
--  Migración 016 — `ticket_events.notify_next_attempt_at`
-- =========================================================================
--  Corrige un agujero real del esquema de reintentos que estrenó la 015.
--
--  EL PROBLEMA QUE ARREGLA
--  La 015 dejó `notify_attempts` pero ninguna columna con el instante del
--  siguiente intento, así que el vigilante medía la espera desde `created_at`
--  con retrasos acumulados: intentable si `now - created_at >= retraso[
--  intentos]`. Eso solo frena mientras la fila es joven. Una fila que se mira
--  por primera vez con más edad que el retraso mayor cumple TODOS los retrasos
--  a la vez: gasta sus tres intentos en tres pasadas consecutivas del cron
--  —unos tres minutos— y queda abandonada.
--
--  Y ocurre justo en el escenario para el que existen los reintentos: si el
--  SMTP se cae media hora, al volver el vigilante encuentra los pendientes ya
--  envejecidos, quema el presupuesto entero de golpe y los sella con error. El
--  aviso se pierde en silencio. Lo mismo tras un reinicio o un despliegue con
--  filas pendientes.
--
--  Con esta columna la espera se mide desde el intento de verdad: al fallar se
--  guarda cuándo toca el siguiente, y el filtro se va al WHERE de la consulta
--  en vez de aplicarse en memoria sobre el lote.
--
--  Los ALTER van guardados con information_schema y `TABLE_SCHEMA = DATABASE()`,
--  igual que la 015: uno sin guardar rompe el initdb al reejecutarse y detiene
--  toda la cadena de migraciones.
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

-- -------------------------------------------------------------------------
-- El ayudante guardado, mismo patrón que `kubo_add_column_015`
-- -------------------------------------------------------------------------
--  Guarda por TABLA y por COLUMNA, en ese orden. Comprobar solo la columna no
--  basta: si la tabla no existiera, la consulta a COLUMNS no devuelve filas, el
--  IF sale verdadero y el ALTER revienta con ER_NO_SUCH_TABLE, deteniendo la
--  cadena entera bajo docker-entrypoint-initdb.d.
-- -------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS kubo_add_column_016;
DELIMITER //
CREATE PROCEDURE kubo_add_column_016(
  IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_ddl VARCHAR(512))
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table AND COLUMN_NAME = p_column
  ) THEN
    SET @sql = CONCAT('ALTER TABLE ', p_table, ' ADD COLUMN ', p_ddl);
    PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END //
DELIMITER ;

-- -------------------------------------------------------------------------
--  La columna
-- -------------------------------------------------------------------------
--  NULL significa "no hay espera pendiente: intentable ya". No significa
--  "nunca". Es el valor de una fila que todavía no ha fallado nunca.
-- -------------------------------------------------------------------------
CALL kubo_add_column_016('ticket_events', 'notify_next_attempt_at',
  'notify_next_attempt_at DATETIME NULL '
  'COMMENT ''cuando toca el siguiente intento; NULL = intentable ya'' '
  'AFTER notify_attempts');

DROP PROCEDURE IF EXISTS kubo_add_column_016;

-- =========================================================================
--  EL HISTÓRICO: por qué aquí NO hay ningún UPDATE
-- =========================================================================
--  La 015 sí lleva un UPDATE de sellado dentro del IF que crea `notified_at`,
--  y quien lea esta migración por analogía va a buscar el equivalente. No
--  está, y su ausencia es deliberada, no un olvido. Las filas existentes son
--  de dos clases y el NULL que reciben al añadirse la columna ya es el valor
--  correcto para las dos:
--
--  1) `notified_at IS NOT NULL` — ya selladas. El vigilante no vuelve a
--     mirarlas nunca: su consulta arranca por `notified_at IS NULL`. La
--     columna nueva es irrelevante para ellas, tenga el valor que tenga.
--     Escribirles algo sería tocar cientos de miles de filas para nada.
--
--  2) `notified_at IS NULL` — pendientes. NULL las deja intentables en la
--     pasada siguiente, que es exactamente lo que hay que hacer con las dos
--     variantes que puede haber:
--       · Las que nunca se intentaron (`notify_attempts = 0`): les toca ya.
--       · Las que fallaron bajo el esquema viejo (`notify_attempts > 0`):
--         siguen pendientes precisamente porque les quedaban intentos, y el
--         cálculo viejo desde `created_at` no es traducible a un instante
--         futuro fiable. Darles un intento inmediato al entrar el esquema
--         nuevo y espaciar los siguientes de verdad es la reparación correcta;
--         calcularles una espera a partir del dato roto sería propagarlo.
--
--  Y lo que NO se puede hacer aquí es el reflejo de la 015: sellar. Un
--  `UPDATE ... SET notified_at = ...` sobre las pendientes apagaría en
--  silencio avisos que sí había que mandar. La 015 podía sellar porque estaba
--  estrenando la bandeja de salida y todo lo anterior era histórico ajeno al
--  correo; aquí ya no: una fila pendiente hoy es un aviso que falta por salir.
--
--  Al escribirse esta migración había 0 filas pendientes en la base de
--  desarrollo, así que en la práctica no cambia nada. Se razona igualmente
--  porque en cualquier otra base el recuento no tiene por qué ser cero.
-- =========================================================================

-- -------------------------------------------------------------------------
--  Nota sobre índices: no hace falta ninguno nuevo.
--  `idx_ticket_events_notify (notified_at, id)` de la 015 sigue resolviendo el
--  arranque de la consulta (`notified_at IS NULL`) y el ORDER BY id. La
--  condición sobre `notify_next_attempt_at` se evalúa sobre ese puñado de
--  filas, que es el conjunto de pendientes: por definición pequeño, porque
--  todo lo que se mira se sella en la misma pasada.
-- -------------------------------------------------------------------------
