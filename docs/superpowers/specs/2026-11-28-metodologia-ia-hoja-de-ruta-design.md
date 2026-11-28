# Metodología con IA, iPad e ISO — hoja de ruta y decisiones

**Aprobado por el usuario:** 2026-11-28 («vamos por todo y afinamos al final», «Aprobado» sobre los
prototipos y la regla de documentos mínimos).

**Prototipos aprobados:** https://claude.ai/artifact/Q9BkXRb5MN63Rh8hYacVKB — Expediente
(entregables), Reunión en iPad (grabar, anotar, acta IA, firmas), Editor (formato, índice, ajuste
IA con antes/después y alcance), Requerimientos y tickets con documentos mínimos.

**Referencia:** paquete metodológico de PRODUCE (NTP-ISO/IEC 12207:2016 + PMBOK/Agile): 21
plantillas con carátula, historial de revisiones (Elaborado/Revisado/Aprobado), firmas y
nomenclatura `[ENTIDAD]-[SIGLAS]-XXXX-<TIPO> Vx.y`. Para proyectos con PRODUCE se usan sus
plantillas; para el resto, la misma estructura con marca Kubo.

## Decisiones (tomadas por el constructor, «afinamos al final»)

- **Firma en pantalla:** nombre + DNI escritos en el momento y trazo manuscrito (dedo o Apple
  Pencil) para reuniones y capacitaciones; con código al correo para conformidades y
  transferencias.
- **ISO:** módulo genérico con matriz de requisitos configurable; arranca con NTP-ISO/IEC 29110.
- **Documentos mínimos (aprobado):** un requerimiento o ticket no se cierra sin sus documentos
  mínimos, salvo «no aplica» con motivo.
  - Requerimiento: especificación y criterios de aceptación; aprobación con fecha comprometida;
    evidencia de pruebas; manual de usuario (si cambia la pantalla); solicitud de pase a
    producción; acta de conformidad.
  - Ticket: registro del incidente (automático); informe de solución con causa raíz y acción
    correctiva; evidencia de la corrección; conformidad del cliente.
  - Ticket P1, además: informe del incidente (línea de tiempo, impacto, acciones).
- **Evidencias como anexos:** cualquier documento (acta, informe, entregable) admite varias evidencias, cada una foto y/o texto; se agregan al final como «Anexos» numerados solo si existen.
- **IA siempre en borrador:** todo documento generado queda como borrador; una persona revisa,
  aprueba (nueva versión) y firma.

## Entregas

| # | Entrega | Estado |
|---|---|---|
| 1 | Base iPad: instalable (manifest, íconos) y menú plegable | Publicada (PR #20) |
| 2 | Reunión en iPad: firma manuscrita con nombre/DNI, notas durante la grabación (nota/acuerdo/tarea con minuto), acta IA que usa las notas, transcripción por tramos | Siguiente |
| 3 | Expediente del proyecto: entregables por tipo de trabajo, versiones Vx.y, estados, nomenclatura, .zip | |
| 4 | Editor con formato + ajuste IA (antes/después, alcance sección/documento) + plantillas por cliente | |
| 5 | Requerimientos y tickets con documentos mínimos y bloqueo de cierre; capacitación, conformidad y prototipos firmados (iPad y portal) | |
| 6 | Levantamiento en campo: dictado, fotos anotadas, escaneo con OCR, pruebas funcionales en sitio, manual con capturas | |
| 7 | ISO: procedimientos con versiones y «leído», matriz requisito → evidencia, no conformidades, auditorías | |

## Lo que ya existe y se reutiliza

- Reuniones: grabación web (`BrowserRecorderPage`, un solo archivo al terminar), transcripción
  (Whisper), actas generadas con IA, acuerdos y compromisos, PDF, envío a revisión y aprobación.
- Firmas de acta (`acta_signatures`): participante + usuario + hash + IP, **sin trazo**.
- Firma electrónica de documentos por enlace (`document-signatories`).
- Requerimientos: especificación, manual de usuario por el conector de Claude, panel de
  conformidad. Tickets: causa raíz y acción correctiva obligatorias al resolver.
- Plantillas de documentos, informe mensual, SLA, disponibilidad.

## Entrega 2 — alcance

1. **Firma manuscrita en pantalla** (componente reutilizable `SignaturePad`, pointer events,
   presión del Pencil): firmante con o sin usuario (nombre, DNI, cargo), trazo PNG guardado y
   puesto en el PDF del acta. Migración 042.
2. **Notas durante la grabación:** minuto, tipo (nota/acuerdo/tarea), texto; se guardan con la
   reunión y la generación del acta las recibe como insumo (acuerdos y tareas entran tal cual).
3. **Evidencias del acta:** varias fotos con texto; en el PDF, «Anexos» al final solo si hay alguna.
4. **Pantalla de reunión para iPad** según el prototipo: grabar → acta → firmas → enviado.
5. **Transcripción por tramos** (cada ~30 s) para verla mientras se graba: después de 1–3, si el
   proveedor de transcripción lo soporta sin costo desproporcionado.
