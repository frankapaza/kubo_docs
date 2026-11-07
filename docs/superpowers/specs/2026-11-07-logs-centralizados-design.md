# Logs y errores centralizados en DevDocs — Diseño

**Fecha:** 2026-11-07
**Estado:** aprobado por el responsable en conversación ("desarrolla todo lo que planteamos"); las decisiones marcadas *(decisión del implementador)* son de quien escribe esto y el responsable puede corregirlas.
**Rama base:** `feat/catalogo-sistemas` (los logs se clasifican por cliente y por sistema del catálogo).

## Problema

Los sistemas que la casa arrienda (.NET, ver «Inventario») corren en el servidor de cada cliente: hoy 10 clientes, un servidor cada uno. Cada aplicativo escribe sus logs con log4net en archivos locales. Para saber qué falló, el responsable entra por escritorio remoto servidor por servidor y abre los archivos. Es lento y no avisa: un error se descubre cuando el cliente llama.

Lo que quiere, en sus palabras: *"mejor centralizado en la web y de ahí puedo resolver y solo entrar al servidor para publicar"*.

## Objetivo

Todo dentro de **DevDocs** (no otra aplicación que abrir):

1. **Logs**: todos los mensajes de log de todos los aplicativos de todos los clientes, consultables con filtros (cliente, sistema, aplicativo, servidor, nivel, rango de fechas, texto) o todos juntos, y **en vivo**.
2. **Errores**: los ERROR/FATAL agrupados cuando son el mismo error, con su traza, cuántas veces y dónde ocurrió, y dos acciones: **Crear ticket** (ticket de la mesa de servicio ya clasificado por cliente y sistema, con la traza) y **Resuelto** (cierre interno, sin ticket). Aviso **en tiempo real** de cada error nuevo, como el de ticket nuevo.
3. **Instalación sencilla** en los aplicativos: el mismo gesto que ya conocen con log4net. Una DLL en `bin` y una entrada en `log4net.config`. Se descarga desde DevDocs junto con el manual.

## No objetivos

- **No** GlitchTip ni otro sistema aparte. Se evaluó y se descartó en la conversación: los errores ya salen de los mismos logs, y agrupar y marcar como resuelto se hace en DevDocs. Un sistema menos que mantener.
- **No** agente instalado en los servidores (Grafana Alloy). Se evaluó; el responsable prefirió configurarlo en cada aplicativo "como si fuera el log4net".
- **No** métricas, trazas distribuidas ni monitoreo de disponibilidad (el "vigilante" está proyectado aparte, ver el diseño del catálogo).
- **No** importar el histórico que ya está en los archivos: entra lo que se registre desde que se instala el appender.

## Anti-objetivos (cosas que harían fracasar esto aunque "funcione")

- **Que el appender ralentice o tumbe un aplicativo de un cliente.** Si DevDocs no responde, está lento o rechaza, el aplicativo sigue igual. Nunca lanza excepciones hacia el aplicativo, nunca bloquea el hilo que escribe el log, y tiene memoria acotada.
- **Que se pierda el log local.** El appender se suma a los que ya hay; el archivo local sigue siendo la red de seguridad.
- **Que un cliente vea los logs de otro**, o que alguien sin clave pueda escribir logs falsos.
- **Que el volumen tumbe DevDocs.** Los aplicativos tienen `<root><level value="ALL"/>`: sin control, entra todo el DEBUG de diez clientes.

## Inventario (revisado en `C:\LanFnkDev\GRUPOVYV2026`)

- 59 proyectos. Mayoría **.NET Framework 4.8** (MCOB/GCC.*, tareas de llamadas, WebApiIntegracion, MSEG, MLEGA, MADM). También 4.7.2 (UtilitarioConexion), **4.6.1** (MCAM, MADM/TareaNocturna), **4.5/4.5.2** (MBUS, MCOB/TiempoReal, GCC.TEST) y **.NET 5** (MCOB/Sincronizador).
- log4net **3.2.0** en 25 proyectos; **2.0.8 a 2.0.12** en los antiguos.
- Configuración con `XmlConfigurator` y `log4net.config` aparte. Ya usan varios appenders a la vez (consola, `RollingFileAppender`, `SmtpAppender` con umbral ERROR).

## Arquitectura

```
Aplicativo .NET (log4net)
  └─ KuboLogAppender (DLL) ── HTTPS POST lotes JSON ──► DevDocs backend  /api/v1/ingest/logs
        cola acotada en memoria,                           │  valida clave de instalación
        hilo propio, nunca lanza                           │  limita tamaño / ritmo
                                                           ├─► Loki (líneas de log, 30 días)
                                                           ├─► MySQL error_groups / error_occurrences (180 días)
                                                           └─► Socket (/tickets ns): error:new, logs:lines (en vivo)
DevDocs web ── /monitoreo/errores, /monitoreo/logs, /monitoreo/instalaciones
```

### Almacenamiento

- **Líneas de log → Loki** *(decisión del implementador)*. Contenedor nuevo `loki` en el `docker-compose.yml` de producción y de desarrollo, en la red interna (sin exponerse por Caddy), almacenamiento en disco con volumen propio y **retención de 30 días** con el compactor. Motivo: el volumen (ALL de diez clientes) no es para MySQL; Loki indexa solo etiquetas y comprime el texto, y filtra por etiqueta y por texto, que es exactamente la consulta que se necesita. Etiquetas (baja cardinalidad, fijas): `cliente`, `sistema`, `aplicativo`, `servidor`, `nivel`. Todo lo demás (logger, hilo, mensaje, excepción) va en la línea, como JSON.
- **Errores agrupados → MySQL** (migración nueva). Necesitan estado, enlace a ticket, autor y fecha de resolución: son datos de negocio, no logs.
- **Retenciones** *(decisión del implementador; el responsable no la fijó)*: logs 30 días (Loki), ocurrencias de error 180 días (job diario que borra las viejas; el grupo se conserva mientras tenga ticket o se haya visto en 180 días).

### Instalaciones y claves

Hay **dos tipos de instalación** (confirmado por el responsable: existen aplicativos que corren en servidores propios o que atienden a varios clientes desde un solo despliegue, p. ej. `WebApiIntegracion`, `Sincronizador`, `UtilitarioConexion`):

- **De cliente**: un **sistema asignado a un cliente** (`client_systems` del catálogo). El cliente y el sistema de cada log salen **de la clave**, nunca de lo que diga el lote: un aplicativo no puede declararse de otro cliente. Si un evento trae la propiedad de cliente (ver abajo), se **ignora**.
- **Interna / compartida**: sin cliente fijo. Tiene un **nombre** propio (p. ej. "Integraciones Kubo") y, opcionalmente, un sistema del catálogo. Cada evento puede indicar el cliente con la propiedad de log4net **`kubo:ruc`** (`ThreadContext`/`LogicalThreadContext.Properties["kubo:ruc"]`). El servidor la resuelve contra `clients.ruc`; si no viene o no coincide, el evento queda como **"sin cliente"** (etiqueta `cliente="interno"`) y se ve igual en Logs y Errores, filtrable. Un RUC desconocido nunca se rechaza: el log no se pierde.
  *(Decisión del implementador: el RUC porque ya está en la ficha del cliente y el aplicativo compartido suele tenerlo a mano; el manual muestra cómo ponerlo en una línea.)*

Común a las dos:

- La instalación agrupa **todos los aplicativos y servidores** que usan su clave: el **aplicativo** (`Aplicativo` en la configuración) y el **servidor** (nombre de máquina) viajan en cada lote como etiquetas.
- La clave se genera en DevDocs (pantalla de instalaciones, solo ADMIN), se muestra **una sola vez**, y en la base solo se guarda su huella (mismo criterio que las invitaciones del portal: `secret_fingerprint`). Se puede **revocar** y **regenerar**.
- Cada instalación tiene un **nivel mínimo** configurable desde DevDocs (por omisión `INFO`): lo que llegue por debajo se descarta en la recepción, aunque el aplicativo lo envíe. Es el control de volumen del lado del servidor *(decisión del implementador, por el `<root level="ALL"/>` de los aplicativos)*.
- Todos los servidores de los clientes tienen salida HTTPS a `docs.kuboti.com` (confirmado). Aun así el appender admite un proxy opcional (`Proxy` en la configuración) por si un cliente lo cambia.

### Recepción (`POST /api/v1/ingest/logs`)

- Autenticación por cabecera `X-Kubo-Log-Key`. Sin JWT (lo llama un aplicativo, no una persona). Clave inválida o revocada → 401.
- Cuerpo: `{ aplicativo, servidor, appenderVersion, eventos: [ { ts (ISO UTC), nivel, logger, mensaje, excepcion?, hilo?, propiedades? } ] }`, admite `Content-Encoding: gzip`.
- Límites: lote ≤ 1000 eventos y ≤ 2 MB descomprimido; mensaje y excepción recortados a 32 KB cada uno; limitador de ritmo por clave (p. ej. 600 lotes/min) → 429. Los límites exactos quedan al implementador.
- Respuesta 202 rápida. Escribe en Loki (push API), y para cada evento ERROR/FATAL actualiza el grupo de error. Si Loki no responde, la recepción responde 503 y el appender reintenta; los errores (MySQL) se procesan igual.

### Agrupación de errores

- **Huella** = hash de: cliente + sistema + aplicativo + tipo de excepción + mensaje normalizado (números, GUIDs, fechas y rutas reemplazados por marcadores) + primer marco de la traza que pertenezca al código propio. Sin excepción, solo con el mensaje normalizado y el logger.
- `error_groups`: huella, cliente, sistema, aplicativo, título (tipo + mensaje corto), logger, primera vez, última vez, total de ocurrencias, servidores vistos, **estado** (`NUEVO`, `CON_TICKET`, `RESUELTO`), ticket enlazado, quién resolvió y cuándo, nota de resolución.
- `error_occurrences`: muestras de las últimas ocurrencias (tope por grupo, p. ej. 50) con mensaje completo, traza, servidor, hilo y propiedades.
- **Reapertura**: si un grupo `RESUELTO` vuelve a ocurrir, pasa a `NUEVO` con marca de "reapareció" y avisa en tiempo real. Si está `CON_TICKET` y su ticket sigue abierto, no se reabre: suma ocurrencias. Si está `CON_TICKET` pero su ticket ya está `RESUELTO` o `CERRADO` y el error vuelve a ocurrir **después** de esa resolución, pasa a `NUEVO` con marca de "reapareció tras el ticket KB-XXXX" y avisa *(decisión del implementador: si no, un error "arreglado" que regresa no avisaría nunca)*.
- **Instalación interna sin cliente**: la huella usa `interno` en lugar del cliente; con `kubo:ruc` resuelto, usa ese cliente.

### Acciones sobre un error

- **Crear ticket**: crea un ticket con `TicketsService.create` (puerta común; avisa de ticket nuevo en tiempo real) con cliente y sistema de la instalación, asunto = título del error, descripción = mensaje, servidor, aplicativo, primera y última vez, total y la traza de la última ocurrencia. Origen nuevo del ticket: `MONITOREO` *(decisión del implementador; requiere ampliar el ENUM `tickets.origin` en la migración)*. El grupo pasa a `CON_TICKET` con enlace al ticket; desde el ticket se ve el enlace al error.
  - **Estos tickets son internos** (confirmado por el responsable): el cliente **no** los ve. El portal excluye el origen `MONITOREO` en el listado, en el detalle (404 como si no existiera), en los adjuntos y mensajes, y en el informe mensual del portal. No disparan ningún aviso por correo al cliente (hoy ya no lo harían con las reglas de notificación; añadir un test que lo fije).
  - Error de instalación interna **sin cliente**: el ticket se crea sin cliente; si el flujo de alta exige cliente o sistema (regla del catálogo), se pide elegirlos en un diálogo antes de crearlo.
- **Resuelto**: cierre interno, sin ticket ni aviso al cliente. Nota opcional. Se puede **reabrir** a mano.
- Las dos quedan registradas con autor y fecha.

### Tiempo real

- Se reutiliza el gateway de socket existente (`/tickets`, solo personal).
- `error:new`: grupo nuevo o reaparecido → toast y notificación del sistema operativo, igual que `ticket:created`, con enlace al error.
- `logs:lines`: la pantalla de Logs en modo **en vivo** se suscribe con sus filtros; el servidor guarda el filtro en el socket y le envía solo las líneas que cumplen, en lotes y con un tope de ritmo (el resto se descarta del envío en vivo con un aviso "N líneas omitidas"; siguen en Loki).

### Pantallas (menú nuevo "Monitoreo", solo personal)

1. **Errores**: lista de grupos con filtros (cliente, sistema, aplicativo, servidor, estado, rango de fechas, texto), orden por última vez o por cantidad; contador de nuevos. Detalle: título, traza, ocurrencias recientes, servidores, gráfico simple de ocurrencias por día, botones **Crear ticket**, **Resuelto**, **Reabrir**, enlace al ticket y botón "ver logs alrededor" (abre Logs filtrado en esa instalación y ±5 minutos).
2. **Logs**: búsqueda con los mismos filtros + nivel + texto + rango, paginada desde Loki; interruptor **En vivo**. Cada línea expandible (logger, hilo, excepción).
3. **Instalaciones** (solo ADMIN): lista de instalaciones (cliente · sistema · último envío · aplicativos y servidores vistos · estado de la clave), crear clave, revocar, regenerar; **descarga** del paquete del appender y **manual** en pantalla.

## El appender (`KuboLogAppender`)

- Clase `Kubo.Log4Net.KuboLogAppender : AppenderSkeleton`. Proyecto .NET SDK-style en el repo (`tools/kubo-log-appender/`).
- **Dos variantes** por la mezcla de versiones:
  - `net45` compilada contra **log4net 2.0.8** → aplicativos con log4net 2.x (.NET 4.5–4.8).
  - `net462` y `netstandard2.0` compiladas contra **log4net 3.x** → aplicativos con log4net 3.x (.NET 4.6.2–4.8) y .NET 5+.
  El manual explica cuál elegir y el `bindingRedirect` si el aplicativo usa una versión de log4net distinta de la compilada.
- **Sin dependencias** externas (ni Newtonsoft.Json ni HttpClient en net45): JSON escrito a mano, `HttpWebRequest`, `GZipStream`. Para no chocar con las versiones que ya tenga cada aplicativo.
- Comportamiento: `Append` solo encola (no bloquea); hilo de fondo envía lotes cada `FlushIntervalMs` o al llegar a `BatchSize`; cola acotada `MaxQueueSize` (descarta lo más viejo y cuenta lo descartado, que se reporta en el siguiente lote); reintento con espera creciente ante error de red/503/429; timeout corto; al cerrar (`OnClose`) intenta vaciar con tope de tiempo. **Nunca** lanza al aplicativo; sus propios fallos van a `LogLog` de log4net.
- Fuerza **TLS 1.2** (los .NET 4.5 usan TLS 1.0 por omisión y Caddy no lo acepta) sumándolo a los protocolos activos, sin quitar los existentes.
- Parámetros en `log4net.config`: `Url`, `ApiKey`, `Aplicativo`, `Threshold` (estándar de log4net; el manual recomienda `INFO`), `BatchSize`, `FlushIntervalMs`, `MaxQueueSize`, `TimeoutMs`, `Proxy` (opcional).
- Envía las propiedades del evento de log4net (`ThreadContext`/`LogicalThreadContext`), entre ellas `kubo:ruc` para las instalaciones compartidas.
- Se distribuye como zip (`kubo-log-appender-<versión>.zip`) con las DLLs por variante y el manual (`MANUAL.md` y `MANUAL.html`). El zip y las DLLs se compilan con un script del repo y se versionan junto al backend, que los sirve desde la pantalla de instalaciones *(decisión del implementador: compilar en Docker con .NET complicaría y alargaría el despliegue)*.

## El manual de implementación (español, para quien publica los aplicativos)

Paso a paso: pedir la clave en DevDocs, elegir la variante según la versión de log4net del aplicativo, copiar la DLL a `bin`, agregar el `<appender>` y su `<appender-ref>` en `log4net.config` (ejemplo completo), `bindingRedirect` si aplica, publicar, verificar en DevDocs que llegan los logs, y solución de problemas (no llega nada, TLS, proxy, clave revocada). Incluye la recomendación de retirar el `SmtpAppender` con credenciales en texto plano.

## Seguridad

- Ingesta solo con clave; huella en base; el cliente y el sistema salen de la clave.
- Lectura de logs y errores solo personal (JWT del personal + `StaffOnlyGuard`); instalaciones solo ADMIN.
- Loki no se expone a internet.
- Los logs pueden contener datos personales de los clientes de los clientes: acceso restringido al personal y retención acotada.

## Despliegue

- Migración nueva (030, tras la 029 del catálogo), registrada en el validador de esquema y en las listas de despliegue.
- Servicio `loki` nuevo en los `docker-compose`, con su configuración en el repo, **tope de memoria** en el contenedor y límites de ingesta propios de Loki.
- **Vigilancia de disco** *(decisión del implementador; no se conoce el tamaño del servidor)*: DevDocs consulta el uso de Loki y, si el disco del volumen pasa de un umbral, lo muestra en la pantalla de instalaciones y avisa al personal. La retención se puede acortar por variable (`LOKI_RETENTION`).
- Variable nueva `LOKI_URL` (por omisión `http://loki:3100`).
- La publicación a producción la confirma el responsable: sube también el catálogo de sistemas y el archivado de tickets.

## Lo que queda al implementador

Nombres internos, límites exactos de ritmo y tamaño, la normalización precisa del mensaje, el diseño visual de las pantallas siguiendo el estilo existente, cómo paginar Loki, y la forma del gráfico de ocurrencias.
