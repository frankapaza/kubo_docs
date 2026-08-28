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
    - Devuelve **exactamente el mismo cuerpo genérico** ante cualquiera de los motivos que invalidan el enlace al aceptar —no existe, caducada, ya usada, revocada, quien invitó está desactivado, o la empresa dejó de ser cliente—: la misma uniformidad que ya rige al aceptar (decisión 3). Si la vista previa distinguiera alguno de esos casos y aceptar no, la diferencia delataría cuál ocurrió.
    - Devuelve **solo** el nombre de la persona y el de la empresa. Nunca el correo completo, ningún identificador, quién invitó, ni ninguna fecha.
    - Lleva el **mismo tope de intentos** que la ruta de aceptar, descrito más abajo.

    *Por qué el coste es aceptable:* el enlace son 32 bytes al azar (decisión 3), así que no se puede enumerar. Y quien ya tiene el enlace va a ver esos mismos dos datos un segundo después, en cuanto entre a la página: esta ruta no le enseña nada que no fuera a ver de todas formas.

11. **Aceptar la invitación no inicia sesión.** La ruta pública pone la contraseña y devuelve el correo con el que entrar; no emite ningún token. La persona pasa por el login como cualquier otra. Es una decisión, no una implicación técnica: una ruta sin autenticar que además entregara una sesión sería una segunda puerta de entrada al portal, y esta funcionalidad ya tiene bastante peso encima (decisión 3) como para sumarle esa.

## El recorrido de una invitación

1. **El administrador invita.** Pone nombre y correo. Se comprueba que el correo no esté ya en uso; si lo está, mensaje genérico y no se crea nada.
2. **Se crea la invitación.** Se genera el secreto, se guarda su huella junto a la empresa, el correo, el nombre, quién invitó y cuándo caduca.
3. **Se manda el correo** con el enlace. Si el envío falla, la invitación queda igualmente y la pantalla lo muestra como pendiente, con opción de reenviar.
4. **La persona abre el enlace.** Antes de pedir nada, la página saluda: consulta la ruta pública de solo lectura (decisión 10) y muestra el nombre de la persona y el de su empresa. Después pide contraseña y su confirmación. No pide el correo: ya lo lleva la invitación, y pedirlo permitiría probar direcciones.
5. **Se acepta.** En una sola transacción: se crea el usuario de cliente con `is_admin` en falso, se marca la invitación como usada, y se anota quién la aceptó. Si algo falla, no queda ni usuario ni invitación consumida. El servidor no emite ningún token en este paso (decisión 11): devuelve el correo con el que entrar, nada más.
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
- **Todos los fallos al aceptar responden lo mismo**: enlace no válido o caducado. No se distingue «no existe» de «caducado» de «ya usado», porque la diferencia solo le sirve a quien está probando.
- **Hay tope de intentos** por dirección de origen, con **el mismo mecanismo que ya protege el inicio de sesión del portal** —el guard que cuenta por dirección de origen—, no un módulo de dominio paralelo como el de los topes del correo entrante. Reutilizar el guard que ya existe evita mantener dos disciplinas de conteo distintas para el mismo problema, y la propiedad que importa —fallar cerrado— la hereda de él.

## La contraseña

Se aplican las mismas reglas que ya rigen para el resto del portal, sin inventar unas nuevas. El mínimo de longitud, el cifrado con la misma función y el mismo coste. Si el portal ya valida algo más, se valida igual aquí.

Lo único propio de esta pantalla: se pide dos veces y se comparan **en el servidor**, no solo en el navegador.

## Fuera de alcance

- **Recuperar contraseña olvidada.** Es un flujo hermano y muy parecido, y la tentación de hacerlo «ya que estamos» es fuerte. Pero tiene sus propias decisiones —qué se le dice a quien pide recuperar una dirección que no existe, si se invalidan las sesiones abiertas— y mezclarlo duplica lo que hay que verificar. Queda para después, y el trabajo de esta fase le deja el camino hecho.
- **Que el administrador edite datos de sus usuarios.** Puede invitar y desactivar. Cambiar el nombre de otro, o su correo, no.
- **Reactivar a un usuario desactivado.** Si vuelve, se le invita otra vez.
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
- **La ruta de solo lectura de la pantalla de aceptar**: que no consuma la invitación, que devuelva el mismo cuerpo genérico ante los mismos motivos de fallo que aceptar, que no devuelva más que los dos nombres, y que respete el mismo tope de intentos que aceptar.
- **La empresa viene de la sesión**: una petición que traiga otra empresa en el cuerpo debe ignorarla, y hay que probarlo con la petición manipulada, no confiando en el tipo.
