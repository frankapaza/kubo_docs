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
2. **El administrador de cliente no puede nombrar administradores.** Quién manda requerimientos y quién gestiona gente en esa empresa lo sigue decidiendo la casa. El administrador crea usuarios normales, nada más.

## Decisiones que se toman aquí

Estas las tomo yo y quedan registradas para poder revertirse:

3. **La invitación es la tercera superficie de este sistema abierta a internet, y la primera sin autenticar.** La página que acepta una invitación se abre sin haber iniciado sesión, y lo que da a cambio es una credencial. Se diseña con ese peso: el enlace es un secreto de 32 bytes aleatorios, **en la base solo vive su huella**, caduca, y se invalida al usarse.

   *Por qué la huella y no el cifrado:* un enlace cifrado se puede descifrar con la clave de la aplicación; una huella no se puede deshacer. Quien lea la base —un respaldo filtrado, una consulta de más— no obtiene ningún enlace utilizable.

4. **Desactivar, no borrar.** El administrador puede quitarle el acceso a quien se fue, pero el usuario no se elimina: sus tickets, sus mensajes y su rastro en los informes tienen que seguir siendo legibles. Un usuario desactivado no puede entrar y no aparece en los desplegables, pero su historia queda.

5. **El administrador no puede desactivarse a sí mismo.** Si pudiera, una empresa podría quedarse sin ningún administrador y sin forma de recuperarlo salvo llamándonos. Se rechaza en el servidor, no solo en la pantalla.

6. **La invitación se manda en el acto, no por la cola de avisos.** El despachador de notificaciones recorre `ticket_events`, y una invitación no es un evento de ticket; meterla ahí obligaría a inventar un evento falso. Se manda directamente por el mismo transporte SMTP ya configurado.

   *Consecuencia conocida:* sin cola no hay reintento automático. A cambio, la invitación **queda creada aunque el correo falle**, y la pantalla ofrece **reenviar**. El reenvío es el reintento, y es visible: el administrador ve que la invitación sigue pendiente.

7. **Los mensajes de error no dicen si un correo existe.** Invitar a una dirección que ya pertenece a otra empresa, o que ya está en la propia, devuelve un texto genérico. Decir «ese correo ya está registrado» convierte el portal en un comprobador de quiénes son nuestros clientes.

   *Consecuencia conocida:* un administrador que se equivoque tecleando no sabrá exactamente por qué falla. Se acepta: el texto explica qué hacer («revisa la dirección, o escríbenos si crees que debería poder entrar»).

8. **Quién creó a quién se guarda sin mentir.** Hoy `client_users.created_by` es obligatorio y apunta a la tabla de personal. Cuando quien da el alta es un administrador de cliente, no hay ningún miembro del personal a quien apuntar. Se añade una columna aparte para el administrador de cliente que invitó, y `created_by` pasa a admitir vacío. Nunca se rellena con un identificador de personal inventado ni con el primer administrador que haya.

   *Por qué importa:* es exactamente el defecto recurrente de este proyecto —decidir por la ausencia de un valor en lugar de por el hecho que lo determina—. Un `created_by` apuntando a personal que no hizo nada es peor que un vacío honesto.

## El recorrido de una invitación

1. **El administrador invita.** Pone nombre y correo. Se comprueba que el correo no esté ya en uso; si lo está, mensaje genérico y no se crea nada.
2. **Se crea la invitación.** Se genera el secreto, se guarda su huella junto a la empresa, el correo, el nombre, quién invitó y cuándo caduca.
3. **Se manda el correo** con el enlace. Si el envío falla, la invitación queda igualmente y la pantalla lo muestra como pendiente, con opción de reenviar.
4. **La persona abre el enlace.** La página pide contraseña y su confirmación. No pide el correo: ya lo lleva la invitación, y pedirlo permitiría probar direcciones.
5. **Se acepta.** En una sola transacción: se crea el usuario de cliente con `is_admin` en falso, se marca la invitación como usada, y se anota quién la aceptó. Si algo falla, no queda ni usuario ni invitación consumida.
6. **La persona entra** con su correo y su contraseña recién puesta.

## La frontera entre empresas

Es la misma regla que gobierna todo el portal, y aquí se aplica en cuatro sitios:

- **Listar** devuelve solo los usuarios de la empresa de quien pregunta.
- **Invitar** fija la empresa desde la sesión, **nunca desde lo que llegue en la petición**.
- **Desactivar** comprueba que el usuario pertenece a la empresa de quien pide, y si no, responde **404, no 403**: un 403 confirma que ese identificador existe.
- **Aceptar** toma la empresa de la invitación, no de nada que ponga quien acepta.

## El enlace, en detalle

Es la parte que merece más cuidado, porque es lo único que separa a un desconocido de una credencial válida.

- **32 bytes aleatorios de fuente criptográfica**, codificados para viajar en una dirección web. No un identificador secuencial, no una marca de tiempo, no un identificador con formato adivinable.
- **En la base solo la huella.** La búsqueda al aceptar se hace por huella, no por el secreto.
- **Caduca a los 7 días.** La comparación es contra el reloj del servidor, en tiempo universal, no contra la zona horaria del proceso.
- **Un solo uso.** El marcado de usada y la creación del usuario ocurren en la misma transacción.
- **Se invalida sola** si el administrador que invitó queda desactivado, o si su empresa queda desactivada. Se comprueba al aceptar, no por un proceso aparte.
- **Un mismo correo no acumula invitaciones vivas**: invitar de nuevo reemplaza la anterior, que deja de servir.
- **Todos los fallos al aceptar responden lo mismo**: enlace no válido o caducado. No se distingue «no existe» de «caducado» de «ya usado», porque la diferencia solo le sirve a quien está probando.
- **Hay tope de intentos** por dirección de origen, con la misma disciplina que los topes del correo entrante: fallando cerrado.

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

- **La frontera entre empresas**, en las cuatro operaciones, con el caso ajeno devolviendo 404.
- **El enlace**: que no se guarde en claro, que caduque, que no sirva dos veces, que no distinga sus fallos, y que no sea adivinable.
- **La transacción de aceptar**: que un fallo a mitad no deje ni usuario creado ni invitación gastada.
- **Las guardas**: que no se pueda crear un administrador desde el portal ni aunque la petición lo pida explícitamente, y que nadie pueda desactivarse a sí mismo.
- **La empresa viene de la sesión**: una petición que traiga otra empresa en el cuerpo debe ignorarla, y hay que probarlo con la petición manipulada, no confiando en el tipo.
