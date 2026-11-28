# Correos con diseño Kubo — diseño corto

**Aprobado por el usuario:** 2026-11-28 («si me parece genial»).

## Intención

Que todos los correos que salen de DevDocs se vean profesionales y con la marca
Kubo (logo y azul de kuboti.com), en vez del texto suelto de hoy.

## Objetivos

- Un solo marco común: cabecera blanca con el logo KUBO y línea azul `#053777`,
  cuerpo, pie gris («Kubo Soluciones Tecnológicas · kuboti.com · correo automático»).
- Se aplica en `EmailService.send`, por donde pasan los ~9 tipos de correo, incluidas
  las plantillas que se editan en el panel (sin tocar su texto).
- El logo va **incrustado** (adjunto inline `cid:`), no enlazado a kuboti.com: Gmail y
  Outlook bloquean imágenes remotas por defecto.
- Enlace principal como botón azul: invitación al portal, pedido de detalle de RQ, firma
  de documento, alertas de monitoreo; en las plantillas, una línea que es solo una URL
  pasa a botón («Ver en el portal» si es del portal, si no «Abrir enlace»).
- El correo de firma pasa del morado a los colores Kubo y sigue mostrando el nombre de
  la empresa emisora.
- La parte de texto plano no cambia.

## No objetivos / anti-objetivos

- No usar fotos del personal ni imágenes de otras personas de kuboti.com (solo logo y colores).
- No cambiar el texto de las plantillas guardadas ni el escapado de los valores del cliente.
- No depender de que kuboti.com esté en línea para que el logo se vea.

## Enfoques

1. **Marco único en `EmailService.send` (elegido).** Un cambio, todos los correos iguales.
2. Marco por cada correo: más archivos tocados y se desalinean con el tiempo.
3. Logo enlazado a kuboti.com: más liviano, pero sale bloqueado hasta que el lector
   permite imágenes y depende del WordPress.

## Decisiones del constructor (mías)

- El logo (`kubo.png` de kuboti.com, 506×153) vive como base64 en un módulo TS: sin
  rutas de disco que difieran entre dev y Docker.
- La previsualización de plantillas en el panel usa el mismo marco con el logo como
  `data:` URI (un iframe no resuelve `cid:`).
- Si el HTML ya trae el marco (marca interna), no se envuelve dos veces.
- Correo responsivo con tablas e estilos en línea (compatibilidad Outlook).
