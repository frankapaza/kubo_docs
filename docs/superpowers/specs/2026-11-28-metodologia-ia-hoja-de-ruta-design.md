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
| 2 | **En curso (rama feat/reunion-ipad): backend listo** — firma en pantalla, por correo o ambas; notas en el acta IA; anexos en PDF. Falta web. · Reunión en iPad: firma manuscrita con nombre/DNI, notas durante la grabación (nota/acuerdo/tarea con minuto), acta IA que usa las notas, transcripción por tramos | Siguiente |
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

## Decisión añadida (usuario, 2026-11-28)

- Cada firmante elige: **dibujar en pantalla**, **confirmar por correo** (enlace de un solo uso, 7 días) o **ambos** (vale al completar los dos).

## Entrega 3 — Expediente del proyecto (diseño)

Prototipo aprobado: «Expediente del proyecto» (canvas Main.dc.html).

- **Tipo de trabajo por proyecto:** TRADICIONAL | AGIL | CORRECTIVO (columna `projects.work_type`, migración 043). Al elegirlo se crea el expediente con el catálogo.
- **Catálogo** (de la metodología PRODUCE, obligatoriedad [tradicional, ágil, correctivo]; O=obligatorio, OP=opcional, NA=no aplica):
  - INICIO: ACT-INI Acta de inicio [O,O,NA]
  - PLANIFICACIÓN: CRO-PRO Cronograma [O,NA,NA]; DOC-ANA Documento de análisis [O,OP,NA]; HIS-USU Historias de usuario [O,O,NA]; ACT-APRO Acta de aprobación de prototipos [O,OP,NA]; ARQ-TIC Arquitectura de TI [OP,OP,NA]; DOC-SER Documento de servicios [OP,OP,NA]
  - EJECUCIÓN: EVD-PUN Evidencia de pruebas unitarias [OP,OP,OP]; MAN-USU Manual de usuario [O,O,NA]; PRU-FUN Pruebas funcionales [O,O,OP]; INF-PRU Informe de pruebas [O,O,OP]; ACT-USU Acta de conformidad de usuario [O,O,OP]; MAN-DES Manual de despliegue [O,O,O]; SOL-PAP Solicitud de pase a producción [O,O,O]
  - MONITOREO Y CONTROL: ACT-REU Acta de reunión [OP,OP,NA]; INF-GES Informe de gestión [OP,OP,NA]; SOL-CAM Solicitud de cambio [OP,OP,NA]
  - CIERRE: ACT-CIE Acta de cierre [O,O,NA]; ACT-CAP Acta de capacitación [OP,OP,NA]; ACT-TRA Acta de transferencia [OP,OP,NA]
- **Entregable:** estado PENDIENTE → BORRADOR → EN_REVISION → APROBADO → FIRMADO, o NO_APLICA con motivo. Versión x.y: subir una versión de trabajo suma 0.1; aprobar sube a la siguiente entera (0.3 → 1.0).
- **Historial de revisiones** por versión: E (elaborado) / R (revisado) / A (aprobado), quién y cuándo, nota; archivo adjunto (docx/pdf/xlsx/mpp) en el almacenamiento existente.
- **Nomenclatura automática:** `KUBO-{CODIGO_PROYECTO}-{NNNN}-{TIPO} V{x.y}` (NNNN correlativo de 4 dígitos por proyecto).
- **Descarga del expediente (.zip):** última versión de cada entregable con archivo, con su nombre de nomenclatura, + índice CSV.
- **Resumen:** totales, aprobados/firmados, en borrador/revisión, pendientes; avance por fase.
- **Fuera de esta entrega:** borradores con IA y editor (entrega 4); vínculo automático de actas y documentos de RQ (después, ya que la entrega 4 los genera).

**Decisiones de construcción:** también se aceptan .xlsx, .pptx y .mpp (un OLE solo si se llama .mpp), 20 MB por archivo; aprobar, observar, firmar, «no aplica» y elegir el tipo de trabajo son de ADMIN, PRODUCT_OWNER o SCRUM_MASTER; se pueden agregar más entregables del catálogo (otra acta de reunión, otra solicitud de cambio) y borrar solo esos mientras no tengan historial; el .zip tiene un tope de 150 MB, se arma uno a la vez por proceso y no recomprime PDF, Office ni imágenes y el índice usa «;» y BOM para Excel.

## Entrega 4 — Editor con ajuste IA y plantillas (diseño)

Prototipo aprobado: «Editor del documento con ajuste IA» (canvas Editor.dc.html).

- **Documento en línea de un entregable:** además de subir un archivo, un entregable del expediente se puede redactar en la plataforma. El documento es una lista de secciones (número, título, cuerpo en Markdown). Guardar crea una versión de trabajo (E, +0.1) con el contenido en el historial; aprobar y firmar siguen el ciclo de la entrega 3. Si el documento en línea es más reciente que el último archivo subido, el .zip lleva su PDF.
- **Plantillas por tipo de entregable:** estructura Kubo por defecto en el código (secciones con guía); se puede editar la de Kubo y crear una por cliente (p. ej. PRODUCE). Al empezar un documento vacío se usa la del cliente del proyecto, si existe; si no, la de Kubo. Página de administración «Plantillas de entregables».
- **Editor (web):** índice con estado por sección (completa, editada en esta versión, pendiente — vacía o con «[Completar]»), «Estás en», barra de formato que inserta Markdown (negrita, cursiva, títulos, lista, tabla), vista previa, imágenes por sección.
- **Imágenes por sección:** foto con leyenda, en la sección («Figura n.») o movida a «Anexos» al final («Anexo n (de 1.2)»), numeradas solas. Mismo criterio que los anexos del acta (JPEG/PNG reales, 5 MB, dimensiones razonables). Solo editables mientras el entregable no esté aprobado ni firmado.
- **Ajuste con IA:** alcance «esta sección» o «todo el documento»; pedidos rápidos (más formal, más breve, completar lo pendiente, ajustar al formato del cliente, corregir ortografía) o texto libre. La IA devuelve solo las secciones del alcance; el servidor calcula el antes y después por palabras. Nada se guarda sin aceptar: aceptar todo o elegir sección por sección y luego guardar crea la versión nueva. La IA no inventa datos: lo que falta queda como «[Completar]».
- **PDF del documento:** carátula con logo Kubo, nomenclatura y versión; historial de revisiones (E/R/A/F); índice; secciones; figuras; anexos.
- **Concurrencia:** guardar envía la versión sobre la que se editó; si otra persona guardó antes, 409 y no se pisa.
