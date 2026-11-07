-- =========================================================================
--  Migración 029 — El catálogo de sistemas y la asignación cliente-sistema
-- =========================================================================
--  Hasta aquí `client_systems` era texto libre por cliente: el nombre del
--  sistema se tecleaba una vez por cada empresa que lo usaba. El mismo
--  producto arrendado a ocho clientes eran ocho nombres escritos a mano, y a
--  la novena alguien escribía «Sistema Cobranzas» donde los otros pusieron
--  «Sistema de Cobranza»: dos productos donde solo hay uno, y el total de
--  tickets por sistema partido sin que nada lo delatara.
--
--  Esta migración separa los dos hechos:
--
--    · `systems`        el producto que la casa arrienda. Una fila por
--                       producto, para todos los clientes.
--    · `client_systems` la pareja cliente-producto (la relación comercial).
--                       Gana `system_id` y deja de exigir `name`.
--
--  `tickets.system_id` SIGUE apuntando a `client_systems.id`, como hasta
--  ahora: esta migración no escribe en `tickets`. Del ticket se llega al
--  producto con una unión.
--
--  LO QUE YA EXISTE SE CONVIERTE SOLO DONDE NO HAY DUDA. Calca el patrón de
--  la 025: detecta los casos dudosos, los deja como están y los anota en
--  `system_catalog_conflicts` para que una persona decida. Se marcan:
--
--    · NOMBRE_EN_VARIOS_CLIENTES   el nombre (sin mayúsculas ni espacios de
--      los bordes) aparece en más de un cliente. Probablemente es el mismo
--      producto, pero «probablemente» no es una decisión que pueda tomar una
--      migración: fusionarlas es irreversible en la práctica, y equivocarse
--      junta en un informe los tickets de dos productos distintos.
--    · DUPLICADO_EN_EL_MISMO_CLIENTE   dos filas del mismo cliente que
--      normalizan igual. La clave única de la 010 impide casi todas (su
--      colación ignora mayúsculas y espacios finales), pero no los espacios
--      iniciales: «ERP» y « ERP» conviven y chocarían con la clave nueva.
--    · NOMBRE_VACIO   una fila cuyo nombre es solo espacios. No hay producto
--      que crear con eso.
--
--  Las filas marcadas conservan su nombre, su `is_active` y `system_id`
--  vacío. El código nuevo solo mira asignaciones con `system_id`, así que
--  para ese cliente el formulario de ticket se comporta como el de un
--  cliente sin sistemas: no se bloquea nada y sale el aviso correspondiente.
--
--  Todo lo demás se convierte: su nombre entra al catálogo y la fila recibe
--  su `system_id`. Un nombre que solo aparece en un cliente es literalmente
--  el estado de hoy escrito con el modelo nuevo.
--
--  Lo que ningún SQL puede ver: dos nombres que significan el mismo producto
--  pero se escriben distinto («Sistema de Cobranza» y «Cobranzas») se
--  convierten en dos productos. El sitio donde eso se limpia es el catálogo,
--  a ojo, por una persona, una sola vez.
--
--  Se conservan, a propósito: la columna `client_systems.name` (la única
--  constancia de qué decía una fila marcada y de qué nombre dio origen a
--  cada producto), la clave única vieja `uq_client_systems (client_id, name)`
--  (con `name` vacío en las filas nuevas no estorba: MySQL admite varios
--  NULL en una clave única) y la nulabilidad de `client_systems.system_id`.
--
--  Idempotente: los cambios de esquema van guardados con information_schema,
--  como en la 021, la 027 y la 028; los INSERT de diagnóstico usan
--  `ON DUPLICATE KEY UPDATE` sobre la clave única de su tabla, y la
--  conversión solo toca filas con `system_id` vacío y sin marcar.
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

-- -------------------------------------------------------------------------
-- 1) El catálogo: los productos que la casa arrienda
-- -------------------------------------------------------------------------
--  La colación ignora mayúsculas, como la de la 010: «ERP Core» y «erp core»
--  son el mismo nombre para la clave única.
CREATE TABLE IF NOT EXISTS systems (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(120)    NOT NULL,
  is_active   TINYINT(1)      NOT NULL DEFAULT 1
              COMMENT 'si la casa lo sigue ofreciendo; retirado = no se asigna a nadie mas',
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                              ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_systems_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- 2) La caja negra: qué filas de client_systems NO se convirtieron y por qué
-- -------------------------------------------------------------------------
--  Sin esto, «a este cliente le falta un sistema» no se podría investigar.
--  Misma razón de ser que `email_normalization_conflicts` en la 025. La
--  clave única por `client_system_id` es lo que hace idempotentes los
--  INSERT de la sección 5.
CREATE TABLE IF NOT EXISTS system_catalog_conflicts (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  client_system_id  BIGINT UNSIGNED NOT NULL,
  client_id         BIGINT UNSIGNED NOT NULL,
  nombre            VARCHAR(120)    NOT NULL COMMENT 'tal como esta guardado, sin tocar',
  motivo            VARCHAR(32)     NOT NULL
                    COMMENT 'NOMBRE_EN_VARIOS_CLIENTES, DUPLICADO_EN_EL_MISMO_CLIENTE o NOMBRE_VACIO',
  detected_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_system_catalog_conflict (client_system_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- 3) client_systems.system_id: el producto del catálogo de cada asignación
-- -------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS kubo_add_column_029;
DELIMITER //
CREATE PROCEDURE kubo_add_column_029(
  IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_ddl VARCHAR(512))
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table AND COLUMN_NAME = p_column
  ) THEN
    SET @sql = CONCAT('ALTER TABLE ', p_table, ' ADD COLUMN ', p_ddl);
    PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END //
DELIMITER ;

CALL kubo_add_column_029('client_systems', 'system_id',
  "system_id BIGINT UNSIGNED NULL "
  "COMMENT 'producto del catalogo (systems.id); NULL = fila marcada por la 029, ver system_catalog_conflicts' "
  "AFTER client_id");

DROP PROCEDURE IF EXISTS kubo_add_column_029;

-- -------------------------------------------------------------------------
-- 4) client_systems.name pasa a admitir vacío
-- -------------------------------------------------------------------------
--  Las asignaciones nuevas no traen nombre: el nombre vive en el catálogo.
--  Guardado por IS_NULLABLE, como la sección 2 de la 027: un MODIFY sobre
--  una columna que ya admite vacío no da error, pero reescribe la tabla
--  entera en cada pasada.
DROP PROCEDURE IF EXISTS kubo_relax_column_029;
DELIMITER //
CREATE PROCEDURE kubo_relax_column_029()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'client_systems'
      AND COLUMN_NAME = 'name'
      AND IS_NULLABLE = 'NO'
  ) THEN
    ALTER TABLE client_systems
      MODIFY COLUMN name VARCHAR(120) NULL
      COMMENT 'nombre tecleado antes de la 029; las asignaciones nuevas lo dejan vacio';
  END IF;
END //
DELIMITER ;

CALL kubo_relax_column_029();
DROP PROCEDURE IF EXISTS kubo_relax_column_029;

-- -------------------------------------------------------------------------
-- 5) Los dudosos, marcados y sin tocar
-- -------------------------------------------------------------------------
--  Solo se miran las filas de antes de la 029: con nombre y sin `system_id`.
--  Una asignación nueva no tiene nombre, y una ya convertida no se vuelve a
--  juzgar.

-- 5a) El nombre aparece en más de un cliente.
INSERT INTO system_catalog_conflicts (client_system_id, client_id, nombre, motivo)
SELECT cs.id, cs.client_id, cs.name, 'NOMBRE_EN_VARIOS_CLIENTES'
FROM client_systems cs
JOIN (
  SELECT LOWER(TRIM(name)) AS clave
  FROM client_systems
  WHERE name IS NOT NULL AND system_id IS NULL AND TRIM(name) <> ''
  GROUP BY LOWER(TRIM(name))
  HAVING COUNT(DISTINCT client_id) > 1
) varios ON varios.clave = LOWER(TRIM(cs.name))
WHERE cs.name IS NOT NULL AND cs.system_id IS NULL
ON DUPLICATE KEY UPDATE motivo = 'NOMBRE_EN_VARIOS_CLIENTES';

-- 5b) Dos o más filas del mismo cliente que normalizan igual.
INSERT INTO system_catalog_conflicts (client_system_id, client_id, nombre, motivo)
SELECT cs.id, cs.client_id, cs.name, 'DUPLICADO_EN_EL_MISMO_CLIENTE'
FROM client_systems cs
JOIN (
  SELECT client_id, LOWER(TRIM(name)) AS clave
  FROM client_systems
  WHERE name IS NOT NULL AND system_id IS NULL AND TRIM(name) <> ''
  GROUP BY client_id, LOWER(TRIM(name))
  HAVING COUNT(*) > 1
) dup ON dup.client_id = cs.client_id AND dup.clave = LOWER(TRIM(cs.name))
WHERE cs.name IS NOT NULL AND cs.system_id IS NULL
ON DUPLICATE KEY UPDATE motivo = 'DUPLICADO_EN_EL_MISMO_CLIENTE';

-- 5c) Un nombre hecho solo de espacios.
INSERT INTO system_catalog_conflicts (client_system_id, client_id, nombre, motivo)
SELECT cs.id, cs.client_id, cs.name, 'NOMBRE_VACIO'
FROM client_systems cs
WHERE cs.name IS NOT NULL AND cs.system_id IS NULL AND TRIM(cs.name) = ''
ON DUPLICATE KEY UPDATE motivo = 'NOMBRE_VACIO';

-- -------------------------------------------------------------------------
-- 6) Lo que no está marcado, convertido
-- -------------------------------------------------------------------------
--  Primero el producto, después la asignación que lo apunta. El
--  `ON DUPLICATE KEY UPDATE systems.id = systems.id` deja intacto un producto que ya
--  estuviera en el catálogo (por ejemplo, dado de alta a mano entre dos
--  pasadas): no le cambia ni las mayúsculas.
INSERT INTO systems (name)
SELECT DISTINCT TRIM(cs.name)
FROM client_systems cs
WHERE cs.name IS NOT NULL
  AND cs.system_id IS NULL
  AND TRIM(cs.name) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM system_catalog_conflicts c WHERE c.client_system_id = cs.id
  )
ON DUPLICATE KEY UPDATE systems.id = systems.id;

UPDATE client_systems cs
JOIN systems s ON s.name = TRIM(cs.name)
SET cs.system_id = s.id
WHERE cs.name IS NOT NULL
  AND cs.system_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM system_catalog_conflicts c WHERE c.client_system_id = cs.id
  );

-- -------------------------------------------------------------------------
-- 7) Un cliente no tiene el mismo producto dos veces
-- -------------------------------------------------------------------------
--  Al final, después de la conversión, para que el fichero cuente la
--  historia en el orden en que ocurre. Las filas marcadas tienen
--  `system_id` vacío y MySQL admite varios NULL en una clave única, así que
--  no chocan.
DROP PROCEDURE IF EXISTS kubo_add_unique_029;
DELIMITER //
CREATE PROCEDURE kubo_add_unique_029(
  IN p_table VARCHAR(64), IN p_index VARCHAR(64), IN p_ddl VARCHAR(512))
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table AND INDEX_NAME = p_index
  ) THEN
    SET @sql = CONCAT('ALTER TABLE ', p_table, ' ADD UNIQUE KEY ', p_ddl);
    PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END //
DELIMITER ;

CALL kubo_add_unique_029('client_systems', 'uq_client_systems_system',
  'uq_client_systems_system (client_id, system_id)');

DROP PROCEDURE IF EXISTS kubo_add_unique_029;
