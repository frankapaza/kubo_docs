# Carga masiva de usuarios de cliente — Diseño

**Fecha:** 2026-09-09
**Estado:** propuesto
**Alcance:** R5. Extiende R4 (`2026-08-26-usuarios-desde-el-portal-design.md`), terminado y desplegado. Las once decisiones de aquel documento siguen vigentes y **ninguna de las de aquí las contradice**; donde una regla cambia de signo (la decisión 10 de abajo) queda escrito por qué la regla de origen sigue siendo la misma.

## Problema

Una empresa cliente recién dada de alta **no tiene ningún usuario**. Invitar por correo es una función del portal, y el portal la reserva al administrador de la propia empresa (`PortalUsersController`, con `ClientJwtGuard` y `ClientAdminGuard`). Para poder invitar hace falta ser administrador de cliente; para ser administrador de cliente hace falta existir como usuario; para existir como usuario hace falta que alguien invite.

Es un agujero de arranque, y se abre **en cada cliente nuevo**, no una vez.

Hoy la única salida es el alta del panel (`POST /client-users`), que exige que alguien de la casa teclee la contraseña de otra persona y se la comunique por algún canal. Eso rompe la decisión 1 de R4 —«la contraseña no la teclea nadie por otro»— y además es peor de lo que parece: **el portal no tiene ninguna pantalla para cambiar la contraseña**, y «recuperar contraseña olvidada» está explícitamente fuera de alcance en R4. La contraseña que la casa teclea hoy es **permanente**.

El caso inmediato es un cliente con **22 personas** en una hoja de cálculo.

## La solución

En el panel de la casa, dentro de «Usuarios de clientes»: **descargar una plantilla, rellenarla, subirla**. El sistema no crea contraseñas: crea **invitaciones**, las mismas de R4, y cada persona elige su propia clave por el mismo enlace de un solo uso que ya existe.

Después, a quien deba ser administrador se le asciende con la edición que **ya existe** en el panel (`PATCH /client-users/:id`, `isAdmin`). El orden importa y no es negociable: solo se puede ascender a alguien que ya aceptó la invitación y por tanto ya es una fila de `client_users`. La carga masiva no adelanta ese paso.

Esta funcionalidad **reutiliza el motor de invitaciones de R4 entero** —secreto de 32 bytes, huella en base, caducidad de siete días, un solo uso, el mismo correo, la misma página pública de aceptar—. Lo único que añade es una puerta de entrada distinta para crearlas, y la autoría honesta de esa puerta.

## Decisiones ya tomadas

Acordadas con el responsable antes de escribir este documento:

1. **La plantilla se genera y el archivo subido se analiza en el servidor.** El navegador solo descarga bytes y sube bytes.

   Dos razones, y las dos importan. La primera es de peso: el paquete del frontend ya avisa por tamaño en cada `npm run build`, y una librería de hojas de cálculo en el navegador lo empeora sin ganar nada. La segunda es la que manda: **el análisis tiene que ocurrir donde se puede validar**. Un análisis en el navegador es una sugerencia —quien mande la petición a mano se lo salta entero— y obligaría a escribir la validación dos veces, que es como se consigue que las dos difieran. Aquí solo hay una, en el servidor, y el navegador no decide nada.

2. **Se acepta lo que Excel produce de verdad.** Ver «El formato del archivo», más abajo: se acepta `.xlsx` **y** texto separado, con el separador olfateado y la codificación deducida.

3. **Primero enseña, después manda.** Subir el archivo **no manda ningún correo**. Devuelve, fila a fila, qué pasaría. Los correos salen en una **segunda acción explícita**.

   Con 22 mensajes saliendo hacia personas reales, descubrir el error a mitad no tiene arreglo: un correo enviado no se retira. La revisión es el único momento en que el error todavía es gratis.

4. **Aquí sí se dice el motivo de cada fila.** Ver la decisión 10, donde queda escrito por qué esto **no** contradice la decisión 7 de R4.

5. **Una fila mala no tumba las buenas.** Se invita a las correctas y se informa exactamente de cuáles quedaron fuera y por qué. Repetir la carga tiene que ser seguro.

6. **Solo usuarios normales.** La carga masiva no crea administradores nunca, ni aunque el archivo traiga una columna que lo pida. Para eso está la edición del panel. Coherente con las decisiones 2 y 9 de R4.

## Decisiones que se toman aquí

Estas las tomo yo y quedan registradas para poder revertirse.

### 7. La invitación gana un segundo tipo de autor, y no se miente sobre cuál fue

Este es el cambio de esquema, y es forzado: `client_user_invitations.invited_by_client_user_id` es **`NOT NULL`** y apunta a `client_users`. Cuando invita la casa **no hay ningún usuario de cliente al que apuntar** —ese es literalmente el problema que esta funcionalidad resuelve—, así que la columna no se puede rellenar sin inventar un valor.

Se hace exactamente lo que la **decisión 8 de R4** hizo con `client_users.created_by`: **columna aparte, y la vieja pasa a admitir vacío**.

- `client_user_invitations.invited_by_user_id BIGINT UNSIGNED NULL` — el miembro del personal que lanzó la carga.
- `client_user_invitations.invited_by_client_user_id` pasa de `NOT NULL` a `NULL`.
- Una restricción `CHECK` en la base: **exactamente una de las dos**, nunca las dos, nunca ninguna.

No se hace un `invited_by` polimórfico con un discriminador, por la misma razón que R4 rechazó el suyo: `users` y `client_users` son tablas distintas a propósito, y un mismo entero no puede significar una fila de una o de otra según el viento.

Esto arrastra tres consecuencias en código que ya está en producción, y las tres son obligatorias:

- **La invalidación por autor desactivado** (R4, «El enlace, en detalle»: *«se invalida sola si el administrador que invitó queda desactivado»*) tiene que mirar al autor **que sea**. Si el autor es del personal, la comprobación equivalente es `users.is_active`. Una invitación de la casa no puede sobrevivir a que ese empleado deje la empresa.
- **`accept` y `preview` tienen que aplicar la misma comprobación**, byte a byte, o divergen — y la decisión 10 de R4 dice que divergir es exactamente lo que delata el motivo del rechazo.
- **La autoría del usuario que nace al aceptar** se reparte igual: si invitó la casa, `client_users.created_by` es ese empleado y `created_by_client_user_id` queda vacío; si invitó un administrador de cliente, al revés. Nunca las dos, nunca ninguna. Es la decisión 8 de R4 aplicada al caso nuevo, no una regla nueva.
- Una fila con **las dos vacías** —imposible por el `CHECK`, pero el código no debe apoyarse en eso— se trata como **enlace no válido**. Falla cerrado.

### 8. La librería: `exceljs`, una sola, y solo en el backend

Hace falta una dependencia porque hay que **generar** un `.xlsx` y **leer** un `.xlsx`. Las candidatas y por qué caen:

| Candidata | Veredicto |
|---|---|
| `xlsx` (SheetJS, el paquete de npm) | **Descartada.** La versión publicada en npm quedó congelada en 2022 y arrastra CVE conocidos de contaminación de prototipo y de ReDoS; SheetJS trasladó las versiones nuevas a su propio CDN, fuera del registro. Una dependencia que solo se actualiza saliéndose del gestor de paquetes no entra en una superficie que recibe archivos. |
| `node-xlsx` | **Descartada.** Es una envoltura fina sobre `xlsx`: hereda el problema entero y le añade una capa. |
| `read-excel-file` + `write-excel-file` | **Descartadas.** Leen y escriben, pero son **dos** paquetes, y el acuerdo es una sola dependencia nueva. |
| `xlsx-populate` | **Descartada.** Sin publicaciones recientes y sin tipos propios. |
| **`exceljs`** | **Elegida.** |

`exceljs` es la única que, con un solo paquete, hace las dos mitades del trabajo: escribe la plantilla (con anchos de columna, fila de encabezado fija y la columna de correo **formateada como texto**, que es lo que impide que Excel autocorrija una dirección) y lee el libro que vuelve. Es MIT, vive en npm, trae sus propios tipos de TypeScript, y no carga con los CVE de contaminación de prototipo que descartan a la familia `xlsx`.

Lo que **no** es, y conviene escribirlo aquí para que nadie se lo encuentre después: `exceljs` no es un paquete pequeño, arrastra transitivas de descompresión ZIP, y su ritmo de publicación es lento. Eso se acepta porque (a) es una dependencia **de backend**, así que no toca el peso del paquete del frontend, que es lo que la decisión 1 quería proteger; (b) la superficie que la alimenta está acotada por la decisión 9; y (c) el análisis del texto separado —la otra mitad del formato— **no la usa**: se escribe a mano, unas sesenta líneas, porque necesita cosas que ningún analizador genérico hace a nuestro gusto (olfatear el separador, deducir la codificación) y porque añadir un segundo paquete rompería el acuerdo de una sola dependencia.

### 9. La frontera de la subida: qué entra, y todo lo demás no

Es una superficie nueva que recibe un archivo. Las reglas, en el orden en que se aplican, y **todas fallan cerrado**:

1. **Tope de tamaño: 512 KB**, aplicado por `multer` (`limits.fileSize`) **antes** de tener el archivo entero en memoria, exactamente como `ATTACHMENT_UPLOAD_LIMITS` en los adjuntos de tickets. La plantilla con 22 filas pesa unos 6 KB; 512 KB deja dos órdenes de magnitud de margen y sigue siendo irrelevante para la memoria del proceso. **Un solo archivo por petición** (`limits.files: 1`).
2. **El tipo se decide por los bytes, jamás por la extensión ni por el `Content-Type` declarado.** Es la misma disciplina que `attachment-rules.ts` y por el mismo motivo: los dos datos los pone quien sube, y comprobar la extensión es no comprobar nada.
   - Empieza por `50 4B 03 04` (`PK\x03\x04`) → rama ZIP/OOXML.
   - No empieza por eso → rama texto, que además exige que los bytes decodifiquen a texto **sin ningún byte nulo**. Un binario cualquiera renombrado a `.csv` muere aquí.
3. **Un ZIP que no es un libro de Excel se rechaza**: si no contiene `xl/workbook.xml`, fuera. Un `.docx`, un `.jar` o un `.zip` con fotos son todos ZIP válidos.
4. **Guarda contra la bomba de descompresión.** Un ZIP de 300 KB puede declararse como gigabytes al descomprimir, y `exceljs` carga el libro en memoria. Antes de que `exceljs` toque nada, se recorre el **directorio central** del ZIP —lectura de cabeceras, sin descomprimir un solo byte— y se rechaza si hay **más de 64 entradas** o si la **suma de los tamaños declarados sin comprimir pasa de 8 MB**. Una entrada con el tamaño en `0xFFFFFFFF` (marca de ZIP64) también se rechaza: un libro de dos columnas y doscientas filas no necesita ZIP64, y aceptarlo sería aceptar un tamaño que la cabecera ya no dice.

   *Límite conocido:* los tamaños del directorio central los escribe quien construyó el archivo y **pueden mentir**. Esta guarda para la bomba ingenua, no a un adversario decidido. Lo que de verdad acota el caso adverso es que esta ruta está detrás de sesión, personal de la casa y rol `ADMIN` (decisión 11), con asiento en `audit_log`: no es una superficie anónima, y un agotamiento de memoria desde ahí es un acto interno con nombre y apellido, no un ataque desde internet.
5. **Contrato de columnas exacto.** Dos columnas, `Nombre completo` y `Correo electrónico`, en la primera fila, comparadas tras normalizar (recorte, minúsculas, sin tildes, espacios colapsados) — porque Excel y quien rellena hacen cosas con las mayúsculas y los acentos. Una columna de más, de menos, o con otro nombre: **se rechaza el archivo entero**, con un mensaje que dice cuáles son las columnas esperadas. No se adivina por posición: un archivo con las dos columnas cambiadas de sitio invitaría a todo el mundo con el nombre en el correo.
6. **Tope de filas: 200.** Pasarse **rechaza el archivo entero**; no se recortan las primeras 200. Truncar en silencio es el peor resultado posible de los tres: el operador vería «invitadas 200» y no sabría que faltan.
7. **Las filas completamente vacías se ignoran** —Excel las genera sola al arrastrar— pero una fila con **un solo campo** relleno no está vacía: es un error y se informa como tal.
8. **El número de fila del archivo viaja con cada resultado**, para que el operador pueda ir a corregirla. Es lo único que hace accionable un informe de 22 líneas.

Nada de esto escribe en la base ni manda ningún correo: la revisión es de solo lectura sobre el sistema (decisión 3).

### 10. Por qué aquí se dice el motivo y en el portal no

En el portal, invitar rechaza con un texto genérico único (**decisión 7 de R4**) y **eso no cambia**. Aquí se dice el motivo exacto de cada fila. No es una incoherencia, y merece quedar escrito por qué.

La regla de fondo no es «nunca digas por qué». Es: **no le digas a nadie algo que no pudiera obtener ya por otro camino.**

- **En el portal**, quien pide es un administrador de una empresa cliente. Está fuera de la casa y solo ve a su propia gente. Decirle «ese correo ya está registrado» le convierte el formulario en un comprobador de quiénes son nuestros clientes: escribe direcciones de una empresa que sospecha y el sistema le confirma cuáles conoce. Ese oráculo no existe por ninguna otra vía, así que hay que cerrarlo.
- **Aquí**, quien pide es personal de la casa con rol `ADMIN`. Ya puede pedir `GET /clients` y `GET /client-users?clientId=…` y leerse **la lista entera de empresas y de sus usuarios**, con nombre y correo. Un texto genérico no le ocultaría nada: le obligaría a ir a mirar la lista él mismo y a cruzarla a mano contra 22 filas. Se le haría adivinar lo que ya tiene delante.

Aplicando la misma regla a dos superficies distintas salen dos respuestas distintas. Ese es el sentido de tenerla escrita.

**La valla que lo sostiene:** los textos de motivo de esta funcionalidad viven **solo** en el servicio de carga masiva y solo salen por las rutas del panel. No se reutilizan, no se exportan hacia el portal, y `INVITE_REJECTED_MESSAGE` sigue siendo el único cuerpo de rechazo de `PortalUsersController`. Si algún día alguien quiere una carga masiva **desde el portal**, esa funcionalidad no puede reutilizar estos textos: tendría que volver a la genérica, porque quien la usa vuelve a estar fuera de la casa.

### 11. Quién puede: las tres rutas exigen rol `ADMIN`

`ClientUsersController` ya lleva `@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)` a nivel de clase, y reparte el rol por ruta: `list` (lectura) va sin `@Roles`, y **`create` y `update` —las dos mutaciones— llevan `@Roles('ADMIN')`**. Se sigue ese criterio, sin inventar uno.

- `POST …/carga-masiva/envio` es una mutación, y de las gordas: crea invitaciones y saca correos reales. **`@Roles('ADMIN')`**, sin discusión.
- `POST …/carga-masiva/revision` no escribe nada, pero **no es una lectura inocente**: dice, dirección por dirección, si está libre, si es de esta empresa, o si es de otra. Es la misma información que `create` protege tras `ADMIN`, servida más cómoda. **`@Roles('ADMIN')`**.
- `GET …/carga-masiva/plantilla` no lee nada de nadie: es un archivo estático generado. Igualmente **`@Roles('ADMIN')`**, por dos razones: es el primer paso de una operación que solo un `ADMIN` puede terminar —dejar que un `DEVELOPER` se descargue la plantilla para chocar contra un 403 al subirla es una pantalla que promete algo que no puede cumplir—, y no cuesta nada. *Es la decisión más blanda de las tres; queda anotada como tal.*

Y en el frontend: la pantalla entera ya está detrás de `canManageUsers(current)` —que es `role === 'ADMIN'`— con `<Navigate to="/clients" replace />`. No hace falta ninguna comprobación nueva en el navegador, y no se añade: el guard de pantalla y los tres del servidor ya coinciden.

### 12. El tope de frecuencia del portal **no** aplica aquí; sí aplica otro, por otra razón

`POST /portal/usuarios/invitaciones` lleva `ApiThrottlerGuard`. Su comentario dice para qué: *«los tres motivos de rechazo son indistinguibles entre sí, pero un 201 contra un 400 sigue diciendo si una dirección está libre»*. **Ese tope existe para cerrar un oráculo.**

Aquí ese oráculo **no existe**, y no porque lo hayamos cerrado: porque la decisión 10 lo abre a propósito, y lo abre porque quien mira ya lo tenía. Copiar el tope del portal a esta ruta sería copiar el mecanismo sin su motivo, que es como se acumulan las reglas que nadie sabe por qué están.

Pero **sí hay un tope**, por el motivo que gobierna `NOTIFICATION_TEST_THROTTLE`: el efecto externo e irreversible. Su comentario dice que el envío de prueba de una plantilla era *«la única ruta del panel con un efecto externo e irreversible»*. **Deja de serlo aquí**, y en peor: una sola petición saca hasta 200 correos de verdad por el SMTP de producción. Quemar la cuota del proveedor o la reputación del remitente es el riesgo que R4 ya señaló como el que hunde la funcionalidad entera aunque el código sea perfecto.

Así que:

- **`GET …/plantilla` y `POST …/revision`: sin tope.** No mandan nada. Limitar la revisión sería molestar justo en el paso que existe para que el operador corrija y vuelva a intentarlo —y el paso que queremos que repita cuantas veces necesite antes de mandar nada.
- **`POST …/envio`: con tope propio**, `BULK_INVITE_THROTTLE`, con los mismos dos escalones que el resto (ráfaga de un minuto, sostenido de quince) y valores estrechos: **2 por minuto y 6 cada quince minutos**. El caso real es una carga de 22 una vez. El techo teórico —6 × 200 = 1200 correos cada quince minutos desde una dirección— se anota tal cual: no es un número cómodo, pero está tres órdenes de magnitud por debajo del sin-tope y el actor está autenticado y auditado. El comentario de `throttler.config.ts` que hoy dice «la única excepción» pasa a nombrar las **dos**.

Se cuenta por dirección de origen, como todo lo demás, porque `ThrottlerGuard.getTracker` usa `req.ip` y no hay ninguna razón para cambiarlo aquí.

### 13. Qué pasa si el quinto correo falla

Nada especial, y esa es la gracia: **`deliver` ya se traga el fallo de envío** (decisión 6 de R4). La invitación queda creada con su `send_error`, y la carga masiva sigue con la sexta.

Cada fila lleva su propio destino en el informe final:

| Resultado | Qué pasó |
|---|---|
| `INVITADA` | Invitación creada y correo entregado al SMTP. |
| `INVITADA_SIN_CORREO` | Invitación creada, **el correo no salió**. El enlace existe y es válido; lo que falta es que llegue. |
| `OMITIDA` | La revalidación del momento del envío la rechazó (ver decisión 15). No se creó nada para ella. |
| `FALLO` | Algo inesperado reventó al escribir esa fila. No se creó nada para ella. |

Y los cuatro contadores, sumados, encima de la tabla. **El operador nunca ve «se enviaron los correos» a secas.**

Tres reglas más:

- **Cada fila es su propia transacción.** `replaceInvitation` ya lo es. Un fallo en la fila 5 no puede deshacer las cuatro anteriores ni impedir las diecisiete siguientes: es la decisión 5, y la única forma de cumplirla es no envolver el lote en una transacción única.
- **Los envíos van en serie, no en paralelo.** Veintidós conexiones SMTP simultáneas es la forma más rápida de que el proveedor nos marque. En serie, 22 correos son unos pocos segundos.
- **El motivo técnico del fallo de envío no sale en la respuesta**, igual que `PortalInvitationView.deliveryFailed` es un booleano y no el texto del SMTP: por qué exactamente rechazó el servidor es diagnóstico interno, y va al log del backend como ya va hoy.

**Cómo se recupera un `INVITADA_SIN_CORREO`:** volviendo a pasar esa fila por la carga. El panel **no** tiene botón de reenviar invitación —`resend` es una ruta del portal y exige un administrador de cliente, que en este escenario todavía no existe—, y no se añade aquí. Volver a cargar produce el mismo efecto que un reenvío: enlace nuevo, el anterior anulado. Ver la decisión 14, que es exactamente lo mismo dicho para el caso general.

### 14. Repetir la carga es seguro, y mata los enlaces anteriores

Repetir la carga completa —el caso normal: se arregla una fila y se vuelve a subir el archivo entero— **es seguro**, y esa es una propiedad que hay que poder dar por hecha. Pero tiene una consecuencia visible que no se puede callar.

- A quien **ya aceptó** no se le vuelve a invitar: la fila sale `RECHAZADA` («ya es usuario activo de esta empresa») y no se le manda nada. Su contraseña no se toca. Es la primera condición de `admiteReinvitacion` (decisión 12 de R4) y aquí vale igual.
- A quien **tiene una invitación viva** se le reinvita, y `replaceInvitation` hace lo de siempre: **revoca la anterior y emite un secreto nuevo**, las dos cosas en la misma transacción.

**Consecuencia, y va en la pantalla antes de confirmar, no después:** si esa persona ya recibió el primer correo, **su enlace deja de funcionar**. No hay alternativa —de la invitación anterior solo existe su huella (decisión 3 de R4), así que no se puede volver a mandar el mismo secreto ni queriendo— y es exactamente la misma consecuencia que R4 ya aceptó para el botón de reenviar. La diferencia es de escala: aquí puede pasarle a veintidós personas de golpe, así que la revisión marca esas filas como `SE_REINVITARA` con el texto dicho entero, y el diálogo lo repite en el paso de confirmar.

- A quien está **desactivado, no es administrador y es de esta misma empresa** se le reinvita y al aceptar **se reactiva su fila**, con su historia intacta. Es la decisión 12 de R4, sin ningún cambio: la carga masiva no inventa una segunda forma de reactivar.
- A quien está **desactivado y es administrador** de esa empresa, no. Sale `RECHAZADA`. La carga masiva no toca administradores en ninguna dirección (decisión 6 de aquí, decisiones 2 y 9 de R4).
- A quien tiene una **invitación viva de otra empresa**, no. Sale `RECHAZADA` y **su invitación no se toca**: es la regla de R4 («la invitación ajena no se toca») y aquí no hay ninguna razón para relajarla.

### 15. Lo que se confirma es lo que se revisó, y se vuelve a comprobar contra el mundo

Entre la revisión y la confirmación pasa tiempo: el operador lee 22 filas, duda, va a preguntar. Hay dos problemas distintos ahí, y hacen falta dos soluciones distintas — confundirlos es cómo se resuelve solo uno.

**Problema A: que se confirme algo distinto de lo revisado.** La confirmación no puede ser un formulario libre donde el navegador manda una lista de correos: eso sería una segunda ruta de invitación masiva sin revisión, con otro nombre.

*Solución:* la revisión devuelve un **bloque opaco** (`revision`) con lo que se va a hacer —versión, empresa, instante de emisión y las filas aprobadas, en su orden— y su **`mac`**: un HMAC-SHA256 sobre **la cadena del bloque tal cual**, no sobre el objeto reconstruido. La confirmación devuelve los dos **verbatim**. El servidor recalcula el MAC, compara **en tiempo constante**, y solo entonces decodifica.

Tres propiedades que salen de hacerlo así:

- **Sobre la cadena, no sobre el objeto**: no hay ninguna canonicalización que acordar entre las dos puntas, así que no hay ninguna forma de que un `JSON.stringify` con las claves en otro orden rompa la firma por sorpresa.
- **La empresa va dentro del bloque firmado**, y la confirmación **no acepta ningún `clientId`** en el cuerpo. Una revisión del cliente A no se puede confirmar contra el cliente B, porque no hay ningún sitio donde escribir «B».
- **La clave se deriva de `JWT_ACCESS_SECRET`**, que `JwtSecretsValidator` ya obliga a existir y a no ser un valor de ejemplo en producción — así que no hay variable de entorno nueva ni un secreto más que rotar. Se deriva, no se usa tal cual: `HMAC(JWT_ACCESS_SECRET, 'kubo:carga-masiva-usuarios:v1')`, con separación de dominio, para que este uso y la firma de los tokens nunca compartan material de clave.

**Problema B: que el mundo haya cambiado.** El MAC garantiza que la entrada es la misma. **No garantiza que el veredicto siga siendo el mismo**, y no puede: en esos minutos alguien pudo dar de alta a una de esas direcciones desde el panel, o el cliente pudo pasar a `FORMER_CLIENT`.

*Solución:* al confirmar, **cada fila se vuelve a evaluar contra la base**, con la misma función que la evaluó en la revisión. Si el veredicto cambió a rechazo, esa fila sale `OMITIDA` con su motivo y **no se invita**. Nunca se invita nada que no estuviera aprobado en la revisión **y** siga aprobado ahora: las dos condiciones.

**Y una caducidad**, porque un bloque firmado sin fecha es un vale al portador para siempre: la revisión **vale 30 minutos**. El instante de emisión viaja dentro del bloque firmado —así que no se puede estirar— y se compara como instante absoluto contra el reloj del servidor. Pasado ese plazo, la confirmación se rechaza con un mensaje que dice que hay que volver a subir el archivo.

*Por qué 30 minutos:* es más de lo que se tarda en leer 22 filas y menos de lo que se tarda en olvidarse de una pestaña abierta. Es un número elegido, no derivado.

## El formato del archivo

**La plantilla que se descarga es `.xlsx`.** Se elige así, y no CSV, porque Excel la abre de dos clics sin ningún asistente de importación, y porque permite dejar la columna de correo **formateada como texto** —lo que impide que Excel autocorrija o reformatee una dirección— y la fila de encabezado inmovilizada. La plantilla lleva las dos columnas, una fila de ejemplo y una nota corta: que la contraseña la elige cada persona, y que la carga no crea administradores.

**Y también se acepta texto separado**, aunque no sea lo que se reparte. El motivo es la decisión 2 y es puro realismo sobre lo que hace la gente: quien recibe una plantilla la abre en Excel, y quien tiene ya la lista en otro sistema la exporta como CSV. Cuando Excel guarda un CSV en un Windows en español **escribe `;` y no `,`** —usa el separador de listas del sistema— y, según la opción exacta que elija quien guarda, **puede perder la marca de codificación** y escribir en la codificación de la página de códigos local. Un lector que solo entienda «comas y UTF-8» rechaza archivos perfectamente razonables y le echa la culpa a quien los hizo.

Así que la rama de texto:

- **Se come la marca de orden de bytes** si está, y no la deja aparecer como parte del primer encabezado.
- **Olfatea el separador** entre `,`, `;` y tabulador, contándolos en la línea de encabezado **fuera de comillas**, y se queda con el que más aparezca. Si no aparece ninguno, el archivo no tiene dos columnas y se rechaza.
- **Deduce la codificación**: si los bytes son UTF-8 válido, es UTF-8; si no, se lee como `latin1`. La comprobación es la misma que ya usa `decodeMultipartFilename` en `common/http/` —reinterpretar y comparar los bytes— y se resuelve así, y no con una lista de codificaciones a probar, porque el caso real es exactamente ese: nombres peruanos con tildes y eñes guardados por un Excel en español.
- **Entiende comillas**: campos entrecomillados con el separador dentro, y `""` como comilla literal. Un apellido compuesto con coma no puede partir una fila.
- **Entiende los dos finales de línea**, `\r\n` y `\n`.

Una celda de Excel no es siempre una cadena, y ahí hay una trampa concreta: **al teclear un correo, Excel lo convierte en un hipervínculo**, y `exceljs` devuelve entonces un objeto `{ text, hyperlink }`, no un texto. Lo mismo con texto enriquecido (`{ richText }`), con fórmulas (`{ formula, result }`) y con números. Toda celda pasa por un único normalizador que convierte esos casos a su texto y **rechaza** lo que no sepa convertir —una fecha, un error de fórmula—, en vez de dejar que un `String(objeto)` meta `[object Object]` en un correo. Es el fallo que se cazaría en producción y no en desarrollo, porque en desarrollo uno escribe el archivo con un script y no tecleando en Excel.

## Los veredictos de la revisión

Tres, y solo tres:

| Veredicto | Significa |
|---|---|
| `SE_INVITARA` | Se le creará una invitación y se le mandará el correo. Incluye la **reactivación** de un desactivado no administrador de esta empresa (decisión 12 de R4), y el motivo lo dice. |
| `SE_REINVITARA` | Ya tiene una invitación viva en esta empresa. Se le mandará un **enlace nuevo** y **el anterior dejará de funcionar**. |
| `RECHAZADA` | No se le mandará nada. El motivo, escrito. |

Motivos de rechazo, todos en español y todos explícitos (decisión 10):

- El correo no tiene un formato válido / el nombre está vacío / alguno de los dos pasa de 180 caracteres — los mismos límites que `InvitePortalUserDto`, no unos nuevos.
- **Repetido dentro del mismo archivo** (se queda la primera aparición; la segunda dice en qué fila estaba la primera). Se compara con el correo **ya normalizado** —minúsculas, recortado, dominio codificado, con `normalizeEmailAddress`—, porque `Ana@X.com` y `ana@x.com` son la misma persona y dos filas para la misma persona son un error del archivo, no dos invitaciones.
- Ya es usuario **activo** de esta empresa.
- Ya es usuario de **otra empresa** — y se dice cuál. Decisión 10: el operador puede leer esa lista igualmente.
- Es **administrador** de esta empresa (activo o desactivado): la carga no toca administradores.
- Tiene una **invitación viva en otra empresa**: no se puede invitar hasta que caduque, y la ajena no se toca.

Y un rechazo que **no es de fila sino del archivo entero**, comprobado antes de mirar ninguna: **la empresa no puede ser `FORMER_CLIENT`**. Una invitación a una empresa que dejó de ser cliente nace muerta —`accept` la rechazaría— así que mandar 22 correos con enlaces que no van a funcionar sería peor que no dejar hacerlo. Un `PROSPECT` **sí** puede recibirlas, exactamente como en R4.

## Zona horaria

Ha habido **siete** fallos de zona en esta serie de proyectos. En esta funcionalidad hay tres sitios donde podría entrar un octavo, y los tres se cierran por construcción:

1. **La plantilla no lleva ninguna fecha.** Ni en el contenido, ni en el nombre del archivo. Es la forma más barata de no tener el problema, y no cuesta nada: el nombre lleva la empresa, no el día.
2. **La caducidad de la revisión es aritmética sobre milisegundos absolutos**, con el instante actual entrando **por argumento** a una función pura, igual que `isInvitationExpired` en `domain/invitation-secret.ts`. Nunca `setMinutes` ni `getHours`, que leen la zona del proceso. Y falla cerrada: un instante ilegible por cualquiera de los dos lados cuenta como **caducada**.
3. **El único texto con hora** —«esta revisión vale hasta las …»— se formatea con `timeZone: PERU_TIME_ZONE` **explícito**, como `invitation-email.ts`, porque quien lo lee está en Lima y el servidor en UTC.

**Y sobre las pruebas:** `jest.config.js` fuerza `process.env.TZ = 'UTC'` desde la CLI, antes de bifurcar a los workers. Eso significa que **ejecutar las pruebas en esta máquina no demuestra nada sobre la zona por sí solo**: pasan igual con el código correcto y con uno que lea la zona del proceso, porque la zona del proceso *es* UTC ahí. Lo que sí lo demuestra es la forma de la prueba:

- **La caducidad** se prueba con **números de época construidos a mano**, sin ninguna cadena de fecha en medio. Una cadena sin desfase explícito la interpreta `Date.parse` en la zona del proceso, y eso es precisamente lo que no queremos que la prueba haga.
- **El texto con hora** se prueba contra un instante fijo y **la cadena exacta en hora de Lima**. Esa aserción **falla** si alguien quita el `timeZone` del formateador, justo porque el proceso está en UTC: la salida saldría cinco horas movida. La prueba caza la omisión gracias a `TZ=UTC`, no a pesar de él.

## Lo que no se salta el tachado de la auditoría

`AuditInterceptor` escribe todo POST/PATCH/PUT/DELETE en `audit_log` y tacha **por patrón** cualquier clave que contenga `password`, `secret` o `token`. Lo que esta funcionalidad manda por ahí:

- **La revisión** (`POST …/revision`) es multipart y **lleva el `clientId` en la query, no en el cuerpo**. Así que su `req.body` está vacío: los 22 nombres y correos **no se copian a `audit_log` en el paso que no hace nada**. El archivo tampoco: multer lo deja en `file`, no en `body`.
- **La confirmación** (`POST …/envio`) sí escribe: el bloque `revision` y su `mac`, y en la respuesta las filas con su resultado. Eso **se quiere**: el asiento tiene que decir qué se hizo y a quién.
- **No hay nada sensible que tachar**, y esa es la propiedad que hay que fijar con una prueba: por esta funcionalidad **no pasa ninguna contraseña** (no se crea ninguna: se crean invitaciones) y **ningún secreto de invitación**. El secreto nace y muere dentro de `deliver`, como en R4, y la proyección de vuelta es `PortalInvitationView`, lista blanca campo a campo sin huella ni secreto. La prueba lo comprueba de la única forma que no se queda vieja: **que en el cuerpo auditado de la confirmación no aparezca ninguna cadena con la forma de un secreto** —43 caracteres del alfabeto `base64url`—, no que no aparezca una clave concreta.
- **`mac` no cae bajo el patrón de tachado, y es correcto que no caiga.** No es una credencial: no da acceso a nada, solo autentica un dato que quien lo tiene ya tiene entero. Que quede legible en el asiento es lo que permite reconstruir qué revisión se confirmó. La contrapartida queda escrita aquí: **`mac` no puede convertirse nunca en un portador de autoridad.** El día que alguien quiera que una revisión firmada valga por sí sola para hacer algo sin sesión, esa firma pasa a ser una credencial y tiene que cambiar de nombre para que el patrón la tache.

## Cómo se prueba

- **La frontera de la subida**, caso a caso: un `.png` renombrado a `.xlsx`, un `.docx` (ZIP válido sin `xl/workbook.xml`), un ZIP con demasiadas entradas, un ZIP que declara 4 GB sin comprimir, un ZIP con la marca de ZIP64, un CSV con un byte nulo, un archivo de 201 filas, y un archivo con las columnas cambiadas de nombre o de orden. **Todos rechazan, y ninguno escribe nada.** El tope de 512 KB es el único que no se prueba rechazando —lo aplica `multer` antes de que corra ningún código nuestro—: se prueba comprobando que el número llega de verdad a sus `limits`, como ya se prueba el de los adjuntos.
- **El texto separado**, por sus cuatro ejes: separador `,`, `;` y tabulador; con marca de codificación y sin ella; en UTF-8 y en `latin1` con tildes; con campos entrecomillados que llevan el separador dentro.
- **Las celdas raras de Excel**: el correo convertido en hipervínculo, el texto enriquecido, la fórmula, el número, la fecha (que se rechaza).
- **La correspondencia revisión/confirmación**: que un `mac` cambiado se rechace; que un bloque cambiado con su `mac` viejo se rechace; que una revisión del cliente A no se pueda confirmar contra el cliente B; que a los 31 minutos ya no valga; y que **una fila cuyo veredicto cambió entre los dos pasos salga `OMITIDA` y no se invite**.
- **Que una fila mala no tumbe las buenas**: un lote donde la tercera revienta al escribir termina con dos invitadas, una fallida y las demás invitadas, y con los cuatro contadores cuadrando.
- **La autoría honesta**: que una invitación creada desde el panel lleve `invited_by_user_id` y **no** `invited_by_client_user_id`; que al aceptarla el usuario nazca con `created_by` puesto y `created_by_client_user_id` vacío; y que las de R4 sigan naciendo al revés, sin cambiar.
- **La invalidación por autor desactivado, en las dos ramas**: que desactivar al empleado que lanzó la carga invalide sus invitaciones, y que **`accept` y `preview` respondan lo mismo** en ese caso — que es la propiedad que la decisión 10 de R4 exige y que un autor de otro tipo podría haber roto.
- **Las guardas**: que `RolesGuard` deje pasar a un `ADMIN` por las tres rutas y **no deje pasar** a un `DEVELOPER` por ninguna, y que el tope de frecuencia esté **solo** en la de envío. La sesión (`JwtAuthGuard`) y la frontera personal/cliente (`StaffOnlyGuard`) van a nivel de clase y ya las cubre lo que hay: lo que estas rutas estrenan es el `@Roles`, y es lo que se prueba.
- **El tachado de la auditoría**, con la prueba de forma descrita arriba.
- **La zona horaria**, con las dos formas de prueba descritas arriba.

## Fuera de alcance

- **Reenviar una invitación desde el panel.** Hoy solo el portal reenvía, y solo un administrador de cliente. La recuperación de un `INVITADA_SIN_CORREO` es volver a pasar esa fila por la carga (decisión 13). Un botón de reenvío en el panel es una funcionalidad razonable y **no es esta**: tendría su propia superficie, su propio tope de frecuencia y su propia pantalla.
- **Ascender a administrador desde el archivo.** Decisión 6. Una columna «es administrador» en la plantilla sería una tercera vía de nombrar administradores, y ya hay una que funciona.
- **Cargar clientes, o crear la empresa desde el archivo.** La empresa se elige en el desplegable que ya existe y tiene que estar dada de alta antes.
- **Deshacer una carga.** Los correos ya salieron; no hay nada que deshacer que sirva de algo. Lo que se puede hacer con una invitación indeseada es lo de siempre: dejarla caducar, o —cuando la empresa ya tenga administrador— que él la reemplace.
- **Recuperar contraseña olvidada.** Sigue fuera, como en R4. Esta funcionalidad **reduce** su urgencia (ya nadie nace con una contraseña que otro tecleó) pero no la sustituye.

## Riesgos

1. **Veintidós correos de golpe parecen una campaña.** Es el riesgo 1 de R4 multiplicado: un envío en ráfaga a un mismo dominio corporativo es exactamente el patrón que miran los filtros. Mitiga: envío **en serie**, el mismo texto sobrio de R4, y el tope de frecuencia de la decisión 12. No lo resuelve: depende de la reputación del dominio. Lo que sí da esta funcionalidad es **visibilidad** — el operador ve cuántos salieron y cuántos no.

2. **El archivo trae direcciones equivocadas y nadie lo nota.** La revisión valida la *forma* de un correo y si está libre; no puede saber si `jperez@` es Juan Pérez o Julia Pérez. Una dirección bien formada pero equivocada recibe una invitación válida a los datos de otra empresa. Mitiga: la revisión enseña las 22 filas con nombre y correo antes de mandar nada, que es justo el momento de leerlas. Es el motivo de fondo de la decisión 3.

3. **La restricción `CHECK` sobre una tabla en producción.** `client_user_invitations` tiene filas reales, todas con `invited_by_client_user_id` puesto y la columna nueva vacía, así que la satisfacen. Pero un `CHECK` se valida contra lo existente al crearse: si alguna fila no la cumpliera, la migración **falla en el arranque del despliegue**. Es la dirección correcta del fallo —ruidosa e inmediata— y no se relaja. Requiere MySQL 8.0.16 o superior, que es lo que corre.

4. **La dependencia nueva.** `exceljs` publica despacio. Mitiga: la superficie que la alimenta está acotada por la decisión 9 (512 KB, ADMIN, guarda de ZIP), y el módulo que la importa es **uno solo** —`bulk-users-workbook.ts`—, así que cambiarla por otra el día que haga falta es reescribir un archivo, no buscarla por el proyecto.
