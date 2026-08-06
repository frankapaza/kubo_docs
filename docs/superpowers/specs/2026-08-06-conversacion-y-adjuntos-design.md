# Conversación y adjuntos en tickets — Diseño

**Fecha:** 2026-08-06
**Estado:** propuesta, pendiente de aprobación
**Depende de:** la mesa de servicio, el portal de clientes y las notificaciones por correo, ya en producción

## 1. El problema

Un cliente abre un ticket en el portal y a partir de ahí se queda mudo. No puede añadir un dato, no puede responder a una pregunta, no puede mandar la captura de la pantalla donde sale el error. Y el equipo tampoco puede escribirle: el controlador de tickets tiene transiciones, asignación, escalado, prioridad y triaje, pero **ningún endpoint de comentario**.

El tipo de evento `COMMENT` existe en el esquema, pero lo escribe solo `TicketAIService` como marcador interno de «empujado a Jira» o «documento de cierre generado». No es una conversación y no debe confundirse con una.

Resultado práctico: para preguntarle algo al cliente hay que llamarle por teléfono, y lo que se hable ahí no queda en ninguna parte.

## 2. Qué se construye

Un **hilo de mensajes** por ticket, con dos tipos, y **adjuntos** en el alta y en cada mensaje, subibles arrastrando o pegando con Ctrl+V, en el panel y en el portal.

### Los dos tipos de mensaje

| Tipo | Quién lo escribe | Quién lo ve | Avisa por correo a |
|---|---|---|---|
| **Respuesta** | Equipo o cliente | Los dos lados | El otro lado |
| **Nota interna** | Solo el equipo | Solo el equipo | Nadie |

La nota interna es lo que hoy se hace en el motivo de una transición, que ya es invisible para el cliente. La diferencia es que ahora se puede escribir sin tener que mover el ticket de estado.

**El riesgo de este diseño es equivocarse de tipo**, y es un riesgo real: escribir «esto lo rompió el becario» creyendo que es privado. La interfaz tiene que hacer la diferencia imposible de pasar por alto — no un desplegable pequeño, sino dos botones distintos y el mensaje ya escrito con un color que diga a quién va. No basta con que el backend lo respete.

### Adjuntos

- Cuelgan del **ticket**, con referencia opcional al mensaje. Los del alta no tienen mensaje; los de una respuesta, sí.
- **Un adjunto hereda la visibilidad de su mensaje.** El de una nota interna no lo ve el cliente ni lo puede descargar. Es la misma disciplina que con el motivo de las transiciones, y es la regla que más fácil se cae si no está escrita.
- Se reutiliza `IStorageService` (`backend/src/modules/audio/interfaces/storage.interface.ts`), que ya está abstraído tras un símbolo, con implementación local y un hueco previsto para S3. No se inventa almacenamiento nuevo.

## 3. Qué se acepta, y por qué eso quita el antivirus

**Imágenes** — PNG, JPEG, WebP, GIF — **y PDF**. Nada más.

Con esa lista no hace falta escanear ficheros, **siempre que se cumplan las tres condiciones de abajo**. Sin ellas, la lista es decorativa.

1. **Se validan los bytes, no la extensión ni el tipo declarado.** Los dos los pone quien sube el fichero: `captura.png` anunciado como `image/png` puede ser un ejecutable por dentro. La comprobación es sobre la firma real del fichero, en el servidor, y lo que no case se rechaza.
2. **El SVG queda fuera.** Es XML y admite `<script>`. Es la trampa clásica de una lista de «imágenes», porque todo el mundo lo cuenta como imagen.
3. **Todo se descarga forzado, con `nosniff`.** Existen ficheros que son un PNG válido y un HTML válido a la vez; la lista de tipos no los ve. La descarga forzada sí. No es una alternativa a validar, es la segunda barrera.

Lo que queda fuera a propósito: comprimidos, ejecutables y ofimática. Con macros de Excel volvería a hacer falta escanear, y eso es otra pieza.

### Las capturas se ven en el hilo, y por eso hay un detalle de diseño

Si lo que se sube son capturas, la gente espera **verlas**, no descargarlas de una en una. Pero una etiqueta `<img>` **no puede mandar la cabecera de sesión**, así que apuntar su `src` a un endpoint protegido no funciona.

La salida: el navegador pide el fichero por JavaScript, con su sesión, y lo pinta desde memoria. Se ve la captura en el hilo, el guard sigue en medio, y **nunca se sirve nada en línea**.

**No se generan miniaturas en el servidor.** Hacerlo obliga a decodificar imágenes que manda gente de fuera, y los fallos en librerías de imagen son de los que se explotan de verdad. Si el navegador es quien pinta, ese riesgo no existe. Las capturas pesan poco; no compensa.

## 4. Las reglas de seguridad

Es la primera vez que **gente de fuera de la empresa sube ficheros al servidor**. Las cinco reglas, por orden de gravedad si se incumplen:

1. **El nombre que manda el cliente no se usa jamás como ruta.** Se guarda como dato, para mostrarlo; la clave del almacenamiento la genera el servidor. Un nombre con `../` escribiendo fuera del directorio es la forma más antigua de tomar un servidor.
2. **La descarga comprueba el cliente del token**, igual que el detalle del ticket, y lo ajeno devuelve **404, no 403**. Un 403 confirma que el fichero existe.
3. **Los ficheros no los sirve Caddy.** Los sirve el backend, detrás del guard. En una carpeta pública la URL sería la contraseña.
4. **Un adjunto de nota interna no llega al portal** ni en la lista, ni en la descarga, ni en el conteo. La proyección va campo por campo, como todo lo que ve un cliente.
5. **Límite de tamaño por fichero y por ticket**, comprobado en el servidor. El del navegador es una comodidad, no una defensa.

## 5. Qué engancha con lo que ya existe

**El estado y el reloj de SLA.** Si el cliente responde a un ticket en `ESPERA_CLIENTE`, el ticket vuelve solo a `EN_ATENCION`. Eso **no se implementa a mano**: `SlaService` ya tiene el camino de reanudación, que devuelve un parche desplazando los vencimientos por lo que duró la pausa, y la transición ya sabe escribir su evento. La respuesta del cliente pasa por ahí. Escribir el mensaje y mover el ticket son **una sola transacción**: un mensaje guardado con el ticket todavía en espera es un ticket dormido con la respuesta dentro, que es justo el fallo que esto viene a evitar.

**Los avisos por correo.** Se apoyan en la bandeja de salida ya construida sobre `ticket_events`, sin tocar ninguno de sus puntos de escritura. Dos plantillas nuevas, sembradas y editables desde el panel:

- Mensaje del cliente → al buzón del equipo, o al responsable si lo hay.
- Respuesta pública del equipo → al autor del ticket.
- **Nota interna → a nadie.** Esto tiene que estar sujeto por un test, no por el cuidado de quien lo escriba.

**El tipo de evento.** No se reutiliza `COMMENT`, que ya significa otra cosa —marcadores de la IA— y está excluido del timeline del portal. Se añade un tipo propio, que entra en la lista blanca del portal solo para los mensajes públicos.

## 6. Estructura

**Backend** — módulo nuevo `backend/src/modules/ticket-messages/`, y no dentro de `tickets/`, que ya es el módulo más grande del proyecto:

| Fichero | Responsabilidad |
|---|---|
| `domain/attachment-rules.ts` | Tipos permitidos, validación por firma de bytes, límites. **Puro**, sin DI |
| `entities/ticket-message.entity.ts` · `ticket-attachment.entity.ts` | Mapeo |
| `ticket-messages.repository.ts` · `.service.ts` | Escritura transaccional del mensaje, el evento y la transición |
| `ticket-attachments.service.ts` | Subida, validación y descarga |
| `ticket-messages.controller.ts` | Panel: escribir de los dos tipos, listar, subir, descargar |
| `portal-messages.controller.ts` | Portal: solo públicos, solo del cliente del token |

**Migración 018**: `ticket_messages`, `ticket_attachments`, el tipo de evento nuevo y las dos plantillas sembradas. Guardada con `information_schema`, en los dos compose, y en `PortalSchemaValidator`.

**Web:** un componente de subida compartido —arrastrar, pegar, elegir— usado por el panel y por el portal, y el hilo en las dos pantallas de detalle.

## 7. Pruebas

Lo que tiene que quedar sujeto por un test y no por una comprobación manual:

- **Una nota interna no aparece nunca en la respuesta del portal**, ni ella ni sus adjuntos, comprobado sobre el cuerpo serializado.
- **Una nota interna no genera ningún correo.**
- Un adjunto de otro cliente devuelve 404, indistinguible de uno que no existe.
- Un fichero con extensión y tipo declarado de imagen pero **bytes de otra cosa** se rechaza.
- Un SVG se rechaza, aunque se anuncie como imagen.
- Un nombre con `../` no escribe fuera del directorio.
- La respuesta del cliente sobre un ticket en espera deja **el mensaje y el cambio de estado**, o ninguno de los dos.
- Los vencimientos de SLA quedan desplazados por la pausa, no recalculados desde cero.

## 8. Lo que no entra

- Antivirus, y por eso la lista de tipos es corta.
- Miniaturas en el servidor.
- Comprimidos, ejecutables y ofimática.
- Editar o borrar un mensaje ya enviado. Un hilo de soporte es un registro.
- Menciones, reacciones, borradores, o escritura en tiempo real.
- Retención y borrado automático de adjuntos. Ver riesgos.
- Adjuntos en requerimientos: esto es solo para tickets.

## 9. Riesgos

**El disco.** Los audios ya tienen política de retención; los adjuntos no tendrían ninguna, y ahora los llenan personas de fuera. Con límite por fichero y por ticket el crecimiento está acotado, pero es acumulativo. **Hay que mirar cuánto disco le queda al VPS antes de desplegar esto**, y decidir la retención antes de que haga falta con prisa.

**Equivocarse de tipo de mensaje.** Es el riesgo de producto, no técnico: una nota interna escrita como respuesta pública ya no se puede retirar. Se mitiga con la interfaz, no con el backend, y por eso la interfaz es parte del diseño y no un detalle de implementación.

**Los ficheros pasan por vosotros.** Sin antivirus, alguien puede subir un PDF infectado y otro descargarlo. Con la lista corta y la descarga forzada el sistema no corre riesgo, pero la responsabilidad de haberlo transportado sí es vuestra. Es una decisión tomada a conciencia, no un olvido.

**Es una funcionalidad grande**, comparable al portal de clientes: migración, backend con subida y descarga, avisos, y dos interfaces. No es un rato.
