# Usuarios desde el portal — Diseño

**Fecha:** 2026-08-26
**Estado:** propuesto
**Alcance:** R4. R1 (requerimientos desde el portal), R2 (informe mensual) y R3 (tickets por correo) están terminados y desplegados.

## Problema

El administrador de una empresa cliente no puede dar de alta a su propia gente. Hoy crear un usuario de cliente está reservado a personal de la casa con rol administrador (`ClientUsersController`, con `StaffOnlyGuard` y `@Roles('ADMIN')`), y desde el portal no existe ninguna ruta que lo haga.

Consecuencia: cada vez que entra alguien nuevo en el equipo del cliente, o se va, hay que pedírnoslo. Para un administrador de empresa eso no tiene sentido, y para nosotros es trabajo manual que no aporta nada.

## Decisiones ya tomadas

Acordadas antes de escribir este documento:

1. **La contraseña no la teclea nadie por otro.** El administrador solo pone nombre y correo; el sistema manda una invitación y la persona elige su propia contraseña. Nadie transmite contraseñas ajenas por ningún canal.
2. **El administrador de cliente no puede nombrar administradores.** Quién manda requerimientos y quién gestiona gente en esa empresa lo sigue decidiendo la casa. El administrador crea usuarios normales, nada más. (Ver también la decisión 9 más abajo, que aplica el mismo criterio a desactivar: si no los crea, tampoco los quita.)

## Decisiones que se toman aquí

Estas las tomo yo y quedan registradas para poder revertirse:

3. **La invitación es la tercera superficie de este sistema abierta a internet, y la primera sin autenticar.** La página que acepta una invitación se abre sin haber iniciado sesión, y lo que da a cambio es una credencial. Se diseña con ese peso: el enlace es un secreto de 32 bytes aleatorios, **en la base solo vive su huella**, caduca, y se invalida al usarse.

   *Por qué la huella y no el cifrado:* un enlace cifrado se puede descifrar con la clave de la aplicación; una huella no se puede deshacer. Quien lea la base —un respaldo filtrado, una consulta de más— no obtiene ningún enlace utilizable.

4. **Desactivar, no borrar.** El administrador puede quitarle el acceso a quien se fue, pero el usuario no se elimina: sus tickets, sus mensajes y su rastro en los informes tienen que seguir siendo legibles. Un usuario desactivado no puede entrar y no aparece en los desplegables, pero su historia queda.

5. **El administrador no puede desactivarse a sí mismo.** Si pudiera, una empresa podría quedarse sin ningún administrador y sin forma de recuperarlo salvo llamándonos. Se rechaza en el servidor, no solo en la pantalla.

   Esta guarda es **independiente** de la que impide desactivar a otro administrador (decisión 9, más abajo). Hoy las dos cubren siempre a la misma clase de persona —quien llega a esta pantalla es administrador por definición—, pero son dos comprobaciones distintas y las dos quedan en el servidor: si el día de mañana se afloja una, la otra sigue en pie por sí sola.

6. **La invitación se manda en el acto, no por la cola de avisos.** El despachador de notificaciones recorre `ticket_events`, y una invitación no es un evento de ticket; meterla ahí obligaría a inventar un evento falso. Se manda directamente por el mismo transporte SMTP ya configurado.

   *Consecuencia conocida:* sin cola no hay reintento automático. A cambio, la invitación **queda creada aunque el correo falle**, y la pantalla ofrece **reenviar**. El reenvío es el reintento, y es visible: el administrador ve que la invitación sigue pendiente.

   *Reenviar no repite el envío: emite un enlace nuevo y anula el anterior.* No hay alternativa — del enlace viejo solo existe su huella (decisión 3), así que no se puede volver a mandar el mismo secreto ni aunque quisiéramos. Consecuencia visible para quien ya recibió el primer correo: si el administrador reenvía, ese enlace deja de funcionar, aunque la persona no haya hecho nada malo con él.

7. **Los mensajes de error no dicen si un correo existe.** Invitar a una dirección que ya pertenece a otra empresa, o que ya está en la propia, devuelve un texto genérico. Decir «ese correo ya está registrado» convierte el portal en un comprobador de quiénes son nuestros clientes.

   *Consecuencia conocida:* un administrador que se equivoque tecleando no sabrá exactamente por qué falla. Se acepta: el texto explica qué hacer («revisa la dirección, o escríbenos si crees que debería poder entrar»).

8. **Quién creó a quién se guarda sin mentir.** Hoy `client_users.created_by` es obligatorio y apunta a la tabla de personal. Cuando quien da el alta es un administrador de cliente, no hay ningún miembro del personal a quien apuntar. Se añade una columna aparte para el administrador de cliente que invitó, y `created_by` pasa a admitir vacío. Nunca se rellena con un identificador de personal inventado ni con el primer administrador que haya.

   *Por qué importa:* es exactamente el defecto recurrente de este proyecto —decidir por la ausencia de un valor en lugar de por el hecho que lo determina—. Un `created_by` apuntando a personal que no hizo nada es peor que un vacío honesto.

9. **Un administrador de cliente no puede desactivar a otro administrador.** Es la misma frontera que la decisión 2: si no puede nombrar administradores, tampoco puede quitarles el acceso — solo a los usuarios normales que sí puede crear. Se añade una guarda propia en la operación de desactivar, con su propia prueba, y **no sustituye** a la de la decisión 5 (nadie se desactiva a sí mismo): son dos comprobaciones distintas que hoy coinciden porque quien pide siempre es administrador, pero si el día de mañana alguien afloja una, la otra tiene que seguir en pie por sí sola.

10. **La página de aceptar saluda antes de pedir nada.** No es un formulario a ciegas: muestra el nombre de la persona invitada y el nombre de su empresa, para que sepa qué está creando y no termine poniendo una contraseña en la cuenta equivocada. Eso exige una ruta pública nueva, de solo lectura, que devuelva esos dos datos sin consumir la invitación ni modificarla de ninguna forma.

    Reglas, tan estrictas como las de aceptar:
    - Devuelve **exactamente el mismo cuerpo genérico** ante cualquiera de los motivos que invalidan el enlace al aceptar —no existe, caducada, ya usada, revocada, quien invitó está desactivado, la empresa dejó de ser cliente, o la dirección ya es de un usuario que no admite reinvitación (decisión 12)—: la misma uniformidad que ya rige al aceptar (decisión 3). Si la vista previa distinguiera alguno de esos casos y aceptar no, la diferencia delataría cuál ocurrió. Vale también al revés: si aceptar admite una reinvitación, la vista previa **tiene que saludar** en ese mismo caso.
    - Comprueba la **forma** del secreto con la misma regla que aceptar —43 caracteres del alfabeto `base64url`— y con el mismo cuerpo genérico. Aquí el secreto llega por la ruta, así que no hay ningún `ValidationPipe` que lo mire; sin esa comprobación había dos disciplinas para el mismo valor, y las dos disciplinas para un mismo valor terminan divergiendo. No es una defensa por sí sola —lo que separa a un desconocido de una credencial son los 32 bytes al azar—: es una regla escrita una sola vez.
    - Devuelve **solo** el nombre de la persona y el de la empresa. Nunca el correo completo, ningún identificador, quién invitó, ni ninguna fecha.
    - Lleva el **mismo tope de intentos** que la ruta de aceptar, descrito más abajo.

    *Por qué el coste es aceptable:* el enlace son 32 bytes al azar (decisión 3), así que no se puede enumerar. Y quien ya tiene el enlace va a ver esos mismos dos datos un segundo después, en cuanto entre a la página: esta ruta no le enseña nada que no fuera a ver de todas formas.

    *Consecuencia conocida y aceptada: el secreto queda escrito en los registros de acceso.* Esta ruta lleva el secreto **en el path** —no en la query, porque los intermediarios registran la query con más alegría—, pero el path tampoco es invisible. La página que la persona abre **es** la dirección `/portal/invitacion/<secreto>`, así que el registro de acceso del servidor web (Caddy, y cualquier intermediario que haya en medio) apunta esa URL en **cada apertura del enlace**, con éxito o sin él. No hace falta ningún error: quien tenga esos registros tiene enlaces vivos durante los siete días que dura la invitación.

    A eso se suman dos sitios más, del lado del backend: `HttpExceptionFilter` copia `req.url` en el campo `path` de todo cuerpo de error —inofensivo, porque quien lo recibe es quien acaba de mandar el secreto—, y escribe una traza con esa URL cuando el estado es 5xx. Decir, como decía el comentario del controlador, que el secreto solo llega al log «ante un 500» es cierto para el backend e **incompleto para el conjunto**.

    Se acepta a cambio del saludo de esta decisión, y porque esos registros son el mismo sitio donde ya viven los datos de la petición; lo que lo acota es la caducidad de siete días y el uso único. Lo que no se acepta es que aparezca por sorpresa: queda escrito aquí y en el controlador. **Si mañana el secreto no puede tocar ningún registro, lo que hay que mover es la ruta —el secreto al cuerpo de un POST—, no el filtro.**

11. **Aceptar la invitación no inicia sesión.** La ruta pública pone la contraseña y devuelve el correo con el que entrar; no emite ningún token. La persona pasa por el login como cualquier otra. Es una decisión, no una implicación técnica: una ruta sin autenticar que además entregara una sesión sería una segunda puerta de entrada al portal, y esta funcionalidad ya tiene bastante peso encima (decisión 3) como para sumarle esa.

12. **A quien vuelve se le reinvita, y aceptar lo reactiva.** Esto estaba en «Fuera de alcance» como *«reactivar a un usuario desactivado: si vuelve, se le invita otra vez»* — y el código lo impedía: invitar rechazaba cualquier correo ya existente **sin mirar si estaba desactivado**, y aceptar lo repetía. El administrador recibía el mensaje genérico y no sabía por qué, y volvía exactamente el trabajo manual que esta funcionalidad existe para eliminar. El documento prometía una cosa y el código hacía otra; se resuelve a favor de lo prometido.

    **Se puede reinvitar a un usuario desactivado, no administrador y de la propia empresa.** Las tres condiciones, y las tres a la vez:

    - **Desactivado.** A quien ya tiene acceso no se le reinvita: una invitación aceptada por alguien activo le reescribiría la contraseña, que es justo lo que un compañero no debe poder hacerle.
    - **No administrador.** *Un administrador desactivado sigue necesitando a la casa*, por coherencia con las decisiones 2 y 9: si el administrador de cliente no puede nombrar administradores ni quitarles el acceso, tampoco puede devolvérselo por la puerta de la invitación.
    - **De la propia empresa.** El correo es único en `client_users` para todo el sistema, así que sin esta condición una empresa podría reactivar —y ponerle contraseña a— gente de otra.

    **Aceptar reactiva esa fila, no crea otra.** Con la contraseña recién elegida y el nombre con el que se la ha invitado ahora. Crear una segunda fila chocaría contra la clave única del correo y, aunque no chocara, partiría en dos la historia de esa persona: sus tickets y sus mensajes cuelgan de la fila que ya existe, que es exactamente lo que la decisión 4 («desactivar, no borrar») conserva. La reactivación **no** toca el rol —ya se ha exigido que no sea administrador— ni la autoría: quién creó a esa persona es un hecho pasado, y reescribirlo sería la misma mentira que prohíbe la decisión 8.

    **Sin abrir ningún oráculo.** El rechazo de los demás casos —activo, administrador, de otra empresa— sigue siendo **el mismo cuerpo genérico de siempre**, indistinguible entre sí y del rechazo por invitación viva ajena (decisión 7); y la reactivación no se distingue de un alta nueva ni por el cuerpo de la respuesta —`{ email }` en los dos casos— ni por el tiempo: la contraseña se cifra con el mismo coste y antes de saber por cuál de las dos ramas se va. Sigue valiendo, entera, la regla de que **todos los motivos de invalidez responden lo mismo**, en aceptar y en la vista previa.

    *Consecuencia conocida:* la persona que vuelve conserva su historia —sus tickets siguen siendo suyos— y también su identificador. Es lo que se quiere; se anota porque significa que «reinvitar» no borra nada de lo anterior.

## El recorrido de una invitación

1. **El administrador invita.** Pone nombre y correo. Se comprueba que el correo no esté ya en uso; si lo está, mensaje genérico y no se crea nada. La única excepción es la reinvitación de la decisión 12: si esa dirección es de un usuario **desactivado, no administrador y de su propia empresa**, la invitación sigue adelante con normalidad.
2. **Se crea la invitación.** Se genera el secreto, se guarda su huella junto a la empresa, el correo, el nombre, quién invitó y cuándo caduca.
3. **Se manda el correo** con el enlace. Si el envío falla, la invitación queda igualmente y la pantalla lo muestra como pendiente, con opción de reenviar.
4. **La persona abre el enlace.** Antes de pedir nada, la página saluda: consulta la ruta pública de solo lectura (decisión 10) y muestra el nombre de la persona y el de su empresa. Después pide contraseña y su confirmación. No pide el correo: ya lo lleva la invitación, y pedirlo permitiría probar direcciones.
5. **Se acepta.** En una sola transacción: se crea el usuario de cliente con `is_admin` en falso —o, si es una reinvitación de la decisión 12, se **reactiva** la fila que ya existe con la contraseña y el nombre nuevos—, se marca la invitación como usada, y se anota quién la aceptó. Si algo falla, no queda ni usuario creado o reactivado ni invitación consumida. El servidor no emite ningún token en este paso (decisión 11): devuelve el correo con el que entrar, nada más, y el mismo cuerpo por las dos ramas.
6. **La persona entra** con su correo y su contraseña recién puesta.

## La frontera entre empresas

Es la misma regla que gobierna todo el portal, y aquí se aplica en cinco sitios:

- **Listar** devuelve solo los usuarios de la empresa de quien pregunta.
- **Invitar** fija la empresa desde la sesión, **nunca desde lo que llegue en la petición**.
- **Desactivar** comprueba que el usuario pertenece a la empresa de quien pide, y si no, responde **404, no 403**: un 403 confirma que ese identificador existe.
- **Consultar antes de aceptar** (la ruta de solo lectura de la decisión 10) toma la empresa de la invitación exactamente igual que aceptar, y no devuelve de ella más que los dos nombres.
- **Aceptar** toma la empresa de la invitación, no de nada que ponga quien acepta.

## El enlace, en detalle

Es la parte que merece más cuidado, porque es lo único que separa a un desconocido de una credencial válida.

- **32 bytes aleatorios de fuente criptográfica**, codificados para viajar en una dirección web. No un identificador secuencial, no una marca de tiempo, no un identificador con formato adivinable.
- **En la base solo la huella.** La búsqueda al aceptar se hace por huella, no por el secreto.
- **Caduca a los 7 días.** La comparación es contra el reloj del servidor, en tiempo universal, no contra la zona horaria del proceso.
- **Un solo uso.** El marcado de usada y la creación del usuario ocurren en la misma transacción.
- **Se invalida sola** si el administrador que invitó queda desactivado, o si su empresa queda desactivada. Se comprueba al aceptar, no por un proceso aparte.

  *Qué significa «empresa desactivada»:* `clients` no tiene ninguna columna de activo/inactivo; lo que tiene es `status`, con los valores `PROSPECT`, `CLIENT` y `FORMER_CLIENT`. «Desactivada» es exactamente `status === 'FORMER_CLIENT'`. Un prospecto (`PROSPECT`) no es una empresa desactivada: **puede tener invitaciones válidas**, igual que un cliente activo. Solo `FORMER_CLIENT` invalida el enlace.
- **Un mismo correo no acumula invitaciones vivas**: invitar de nuevo reemplaza la anterior, que deja de servir.
- **Invitar a un correo con una invitación viva de otra empresa se rechaza.** El mensaje es el mismo genérico de siempre, y la invitación ajena **no se toca**: reemplazarla o anularla sería un efecto cruzado entre empresas por la puerta de atrás, y no hay ninguna razón de negocio para que una empresa pueda afectar las invitaciones de otra.

  *Consecuencia conocida y aceptada:* mientras esa invitación siga viva —hasta siete días—, cualquier empresa puede impedir que otra invite a esa misma dirección, simplemente invitándola primero. Quien lo sufre recibe el mensaje genérico de siempre y no tiene forma de saber que el motivo es ese y no un error de tecleo. No hay arreglo dentro de este alcance: es el precio de no dejar que una empresa toque las invitaciones de otra.
- **Se invalida también si la dirección ya tiene dueño.** El alta de un usuario de cliente desde el panel no revoca las invitaciones vivas de ese correo, así que la invitación sobrevive a que la dirección deje de estar libre. La excepción, y solo esa, es la reinvitación de la decisión 12: un usuario desactivado, no administrador y de la empresa de la invitación no invalida el enlace — se reactiva al aceptar.
- **Todos los fallos al aceptar responden lo mismo**: enlace no válido o caducado. No se distingue «no existe» de «caducado» de «ya usado» de «esa dirección ya es de alguien», porque la diferencia solo le sirve a quien está probando. Una cadena que ni siquiera tiene la forma de un secreto responde también eso mismo.
- **Hay tope de intentos** por dirección de origen, con **el mismo mecanismo que ya protege el inicio de sesión del portal** —el guard que cuenta por dirección de origen—, no un módulo de dominio paralelo como el de los topes del correo entrante. Reutilizar el guard que ya existe evita mantener dos disciplinas de conteo distintas para el mismo problema, y la propiedad que importa —fallar cerrado— la hereda de él.

## La contraseña

Se aplican las mismas reglas que ya rigen para el resto del portal, sin inventar unas nuevas. El mínimo de longitud, el cifrado con la misma función y el mismo coste. Si el portal ya valida algo más, se valida igual aquí.

Lo único propio de esta pantalla: se pide dos veces y se comparan **en el servidor**, no solo en el navegador.

## Fuera de alcance

- **Recuperar contraseña olvidada.** Es un flujo hermano y muy parecido, y la tentación de hacerlo «ya que estamos» es fuerte. Pero tiene sus propias decisiones —qué se le dice a quien pide recuperar una dirección que no existe, si se invalidan las sesiones abiertas— y mezclarlo duplica lo que hay que verificar. Queda para después, y el trabajo de esta fase le deja el camino hecho.
- **Que el administrador edite datos de sus usuarios.** Puede invitar, reinvitar y desactivar. Cambiar el nombre de otro, o su correo, fuera de la invitación, no.
- **Reactivar a un usuario desde la pantalla de «Mi equipo», con un botón.** Reactivar existe (decisión 12), pero solo por el camino de la invitación: se le vuelve a invitar y es la persona quien elige contraseña. No hay ningún botón de «devolver el acceso» que reactive sin que la persona haga nada, porque eso dejaría entrar con la contraseña vieja —la que tenía cuando se le quitó el acceso— sin que nadie lo haya decidido.
- **Reactivar a un administrador desactivado.** Sigue necesitando a la casa. Decisiones 2, 9 y 12.
- **Invitar administradores.** Decisión 2.

## Riesgos

1. **El correo de invitación acaba en spam.** Es el riesgo más probable, y el más molesto: la invitación existe, el administrador la ve pendiente, y la persona no recibe nada. Mitiga: la pantalla muestra el estado, permite reenviar, y el texto del correo evita el vocabulario que disparan los filtros. No lo resuelve del todo; depende de la reputación del dominio, la misma que hace falta para el correo entrante.

2. **Quien controle el buzón de la persona invitada puede entrar en su lugar.** Es inherente a cualquier invitación por correo y no tiene arreglo dentro de este alcance. Se acota con la caducidad y el uso único.

3. **Un administrador que se va sin traspasar.** Si el único administrador de una empresa deja de estar disponible, esa empresa no puede invitar a nadie hasta que la casa nombre a otro. Es la consecuencia directa y aceptada de la decisión 2.

4. **La columna nueva sobre una tabla en producción.** `client_users` tiene datos reales. La migración añade una columna y ablanda `created_by` a admitir vacío; ninguna de las dos cosas pierde información, pero es una tabla viva y la migración tiene que ser idempotente como las anteriores.

## Cómo se prueba

- **La frontera entre empresas**, en las cinco operaciones, con el caso ajeno devolviendo 404.
- **El enlace**: que no se guarde en claro, que caduque, que no sirva dos veces, que no distinga sus fallos, y que no sea adivinable.
- **La transacción de aceptar**: que un fallo a mitad no deje ni usuario creado ni invitación gastada.
- **Las guardas**: que no se pueda crear un administrador desde el portal ni aunque la petición lo pida explícitamente, que nadie pueda desactivarse a sí mismo, y que un administrador no pueda desactivar a otro administrador — las dos últimas por separado, aunque hoy coincidan siempre en la misma persona.
- **La ruta de solo lectura de la pantalla de aceptar**: que no consuma la invitación, que devuelva el mismo cuerpo genérico ante los mismos motivos de fallo que aceptar, que no devuelva más que los dos nombres, que aplique la misma regla de forma del secreto que aceptar, y que respete el mismo tope de intentos.
- **La reinvitación (decisión 12)**, por los dos extremos: que invitar acepte al desactivado no administrador de la propia empresa y siga rechazando los otros tres casos con el mismo cuerpo; que aceptar **actualice la fila que existe y no cree ninguna nueva**, con el acceso, la contraseña y el nombre nuevos y sin tocar el rol ni la autoría; que la vista previa **salude** en ese mismo caso, para que las dos rutas no diverjan; y que la respuesta de una reactivación sea idéntica a la de un alta nueva.
- **El tachado de la auditoría**, que no tenía ninguna prueba: que el cuerpo de aceptar una invitación no deje ni el secreto ni la contraseña en `audit_log`, que el tachado vaya **por patrón** —cualquier clave que contenga `password`, `secret` o `token`, sin distinguir mayúsculas— y **en todos los niveles**, y que lo que no es sensible siga guardándose tal cual, porque no es una lista blanca.
- **La empresa viene de la sesión**: una petición que traiga otra empresa en el cuerpo debe ignorarla, y hay que probarlo con la petición manipulada, no confiando en el tipo.
