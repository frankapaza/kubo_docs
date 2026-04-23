-- Seed: plantillas iniciales de documentos comerciales
-- Usa {{variable_key}} como placeholders. Todas las plantillas traen un membrete
-- que se autorrellena desde Configuración → Datos del emisor ({{emisor_*}}).
-- IMPORTANTE: fuerza utf8mb4 para que caracteres españoles y emojis se guarden bien.
SET NAMES utf8mb4;

-- ============================================================
-- 1) Cotización KUBO — Por posición
-- ============================================================
INSERT INTO document_templates (name, type, description, variables_schema, content_markdown) VALUES (
'Cotización KUBO — Por posición',
'QUOTE',
'Modelo clásico: precio por puesto × cantidad de posiciones. Ideal para clientes con número definido de agentes.',
JSON_OBJECT(
  'variables', JSON_ARRAY(
    JSON_OBJECT('key', 'cliente_razon_social', 'label', 'Razón social del cliente', 'type', 'text', 'source', 'client', 'required', true),
    JSON_OBJECT('key', 'cliente_contacto', 'label', 'Nombre del contacto', 'type', 'text', 'source', 'manual', 'required', false),
    JSON_OBJECT('key', 'fecha_emision', 'label', 'Fecha de emisión', 'type', 'date', 'source', 'auto', 'required', true),
    JSON_OBJECT('key', 'referencia', 'label', 'Referencia / número de cotización', 'type', 'text', 'source', 'manual', 'required', true),
    JSON_OBJECT('key', 'posiciones', 'label', 'Cantidad de posiciones', 'type', 'number', 'source', 'manual', 'required', true),
    JSON_OBJECT('key', 'precio_por_puesto', 'label', 'Precio por puesto (S/.)', 'type', 'number', 'source', 'manual', 'required', true),
    JSON_OBJECT('key', 'costo_instalacion', 'label', 'Costo de instalación única (S/.)', 'type', 'number', 'source', 'manual', 'required', true, 'defaultValue', '1500'),
    JSON_OBJECT('key', 'costo_infraestructura', 'label', 'Costo mensual de infraestructura (S/.)', 'type', 'number', 'source', 'manual', 'required', false, 'defaultValue', '800'),
    JSON_OBJECT('key', 'total_mensual', 'label', 'Total mensual (S/.)', 'type', 'number', 'source', 'manual', 'required', true)
  )
),
'**{{emisor_razon_social}}**\nRUC {{emisor_ruc}} · {{emisor_direccion}}\n📱 {{emisor_telefono}} · 📧 {{emisor_email}} · 🌐 {{emisor_website}}\n\n---\n\n# 📘 Propuesta Comercial\n### Sistema de Gestión Integral de Cobranza\n\n| | |\n|---|---|\n| **Cliente** | {{cliente_razon_social}} |\n| **Contacto** | {{cliente_contacto}} |\n| **Fecha** | {{fecha_emision}} |\n| **Referencia** | {{referencia}} |\n| **Modelo de cotización** | Por posición |\n| **Validez** | 15 días calendario |\n\n---\n\n## 🎯 Resumen ejecutivo\n\n{{cliente_razon_social}} requiere una plataforma para gestionar campañas de cobranza con trazabilidad por agente y reportería automatizada.\n\n- ✅ Licenciamiento hasta **{{posiciones}} posiciones**\n- ✅ Instalación, configuración y capacitación **incluidas**\n- ✅ **SLA 98.8%** con penalidad por incumplimiento\n- ✅ **Soporte 24/7** remoto + presencial\n\n> 💰 **Total mensual estimado:** S/ {{total_mensual}} + IGV\n> ⏱️ **Implementación:** 5 días hábiles\n\n---\n\n## 💰 Inversión\n\n| Concepto | Detalle | Monto |\n|---|---|---|\n| Licencia KUBO | {{posiciones}} posiciones × S/ {{precio_por_puesto}} | S/ {{total_mensual}} |\n| Infraestructura cloud | Servidor + BD | S/ {{costo_infraestructura}} |\n| Setup inicial (único) | Instalación + capacitación | S/ {{costo_instalacion}} |\n\n*Todos los montos en soles peruanos, no incluyen IGV. Post-pago mensual a 30 días.*\n\n---\n\n## 🔧 Alcance del servicio\n\n### Incluido\n\n- 📞 Campañas Inbound, Outbound y mixtas, ilimitadas\n- 👥 Skills por agente con distribución inteligente\n- 🏷️ Tipificaciones completas del ciclo de llamada\n- 📊 Reportes por nivel (agente, supervisor, BO)\n- ⚖️ Módulo de cobranza judicial\n- 🔌 Integraciones con la BD del cliente\n- 🛠️ Módulos a medida bajo demanda\n- 🎓 Capacitación a usuarios y supervisores\n- 🆘 Soporte 24/7 remoto + presencial\n\n### No incluye\n\n- Central telefónica (propiedad del cliente)\n- Tarificación de telefonía\n- Licencias de terceros no pactadas\n\n---\n\n## 🛡️ SLA\n\n- Disponibilidad: **98.8%** mensual garantizado\n- Backup: diario, cifrado, retención 90 días\n- Penalidad: 10% de descuento sobre factura del mes afectado ante incumplimiento\n\n---\n\n**{{emisor_representante}}**\nGerente Comercial — {{emisor_razon_social}}\n📧 {{emisor_email}} · 📱 {{emisor_telefono}}'
);

-- ============================================================
-- 2) Cotización KUBO — Por rango de posiciones
-- ============================================================
INSERT INTO document_templates (name, type, description, variables_schema, content_markdown) VALUES (
'Cotización KUBO — Por rango de posiciones',
'QUOTE',
'Pricing escalonado por rangos (tiered). El cliente paga según el rango en el que caen sus posiciones activas.',
JSON_OBJECT(
  'variables', JSON_ARRAY(
    JSON_OBJECT('key', 'cliente_razon_social', 'label', 'Razón social del cliente', 'type', 'text', 'source', 'client', 'required', true),
    JSON_OBJECT('key', 'cliente_contacto', 'label', 'Nombre del contacto', 'type', 'text', 'source', 'manual', 'required', false),
    JSON_OBJECT('key', 'fecha_emision', 'label', 'Fecha de emisión', 'type', 'date', 'source', 'auto', 'required', true),
    JSON_OBJECT('key', 'referencia', 'label', 'Referencia / número de cotización', 'type', 'text', 'source', 'manual', 'required', true),
    JSON_OBJECT('key', 'tabla_rangos', 'label', 'Tabla de rangos (Markdown)', 'type', 'longtext', 'source', 'manual', 'required', true, 'defaultValue', '| Rango de posiciones | Precio mensual |\n|---|---|\n| 0 – 10 | S/ 1,500 |\n| 11 – 20 | S/ 2,000 |\n| 21 – 50 | S/ 3,500 |\n| 51 – 100 | S/ 5,500 |\n| 101 o más | a cotizar |'),
    JSON_OBJECT('key', 'costo_instalacion', 'label', 'Costo de instalación única (S/.)', 'type', 'number', 'source', 'manual', 'required', true, 'defaultValue', '1500'),
    JSON_OBJECT('key', 'costo_infraestructura', 'label', 'Costo mensual de infraestructura (S/.)', 'type', 'number', 'source', 'manual', 'required', false, 'defaultValue', '800')
  )
),
'**{{emisor_razon_social}}**\nRUC {{emisor_ruc}} · {{emisor_direccion}}\n📱 {{emisor_telefono}} · 📧 {{emisor_email}} · 🌐 {{emisor_website}}\n\n---\n\n# 📘 Propuesta Comercial\n### Sistema de Gestión Integral de Cobranza\n\n| | |\n|---|---|\n| **Cliente** | {{cliente_razon_social}} |\n| **Contacto** | {{cliente_contacto}} |\n| **Fecha** | {{fecha_emision}} |\n| **Referencia** | {{referencia}} |\n| **Modelo de cotización** | Por rango de posiciones |\n| **Validez** | 15 días calendario |\n\n---\n\n## 🎯 Resumen ejecutivo\n\n{{cliente_razon_social}} requiere una plataforma de cobranza flexible que acompañe su crecimiento. Nuestra modalidad **por rangos de posiciones** permite pagar solo por el nivel que usas, sin sobrecostos al empezar pequeño.\n\n- ✅ Escalas según tu necesidad real\n- ✅ Instalación, configuración y capacitación **incluidas**\n- ✅ **SLA 98.8%** con penalidad por incumplimiento\n- ✅ **Soporte 24/7** remoto + presencial\n\n---\n\n## 💰 Tarifas por rango\n\n{{tabla_rangos}}\n\n*Montos en soles peruanos, no incluyen IGV. Se aplica el rango correspondiente a las posiciones activas al cierre de cada mes.*\n\n---\n\n## 🏗️ Costos adicionales\n\n| Concepto | Monto |\n|---|---|\n| Setup inicial (único) | S/ {{costo_instalacion}} |\n| Infraestructura cloud mensual | S/ {{costo_infraestructura}} |\n\n---\n\n## 🔧 Alcance del servicio\n\n### Incluido\n\n- 📞 Campañas Inbound, Outbound y mixtas, ilimitadas\n- 👥 Skills por agente con distribución inteligente\n- 🏷️ Tipificaciones completas del ciclo de llamada\n- 📊 Reportes por nivel (agente, supervisor, BO)\n- ⚖️ Módulo de cobranza judicial\n- 🔌 Integraciones con la BD del cliente\n- 🛠️ Módulos a medida bajo demanda\n- 🎓 Capacitación a usuarios y supervisores\n- 🆘 Soporte 24/7 remoto + presencial\n\n---\n\n## 🛡️ SLA\n\n- Disponibilidad: **98.8%** mensual garantizado\n- Backup: diario, cifrado, retención 90 días\n\n---\n\n**{{emisor_representante}}**\nGerente Comercial — {{emisor_razon_social}}\n📧 {{emisor_email}} · 📱 {{emisor_telefono}}'
);

-- ============================================================
-- 3) Cotización KUBO — Mensual fijo (flat)
-- ============================================================
INSERT INTO document_templates (name, type, description, variables_schema, content_markdown) VALUES (
'Cotización KUBO — Mensual fijo',
'QUOTE',
'Cuota mensual única sin importar el número de posiciones. Ideal para clientes con volumen predecible o pequeños equipos.',
JSON_OBJECT(
  'variables', JSON_ARRAY(
    JSON_OBJECT('key', 'cliente_razon_social', 'label', 'Razón social del cliente', 'type', 'text', 'source', 'client', 'required', true),
    JSON_OBJECT('key', 'cliente_contacto', 'label', 'Nombre del contacto', 'type', 'text', 'source', 'manual', 'required', false),
    JSON_OBJECT('key', 'fecha_emision', 'label', 'Fecha de emisión', 'type', 'date', 'source', 'auto', 'required', true),
    JSON_OBJECT('key', 'referencia', 'label', 'Referencia / número de cotización', 'type', 'text', 'source', 'manual', 'required', true),
    JSON_OBJECT('key', 'posiciones_maximas', 'label', 'Máximo de posiciones incluidas', 'type', 'number', 'source', 'manual', 'required', true, 'defaultValue', '30'),
    JSON_OBJECT('key', 'costo_mensual', 'label', 'Costo mensual fijo (S/.)', 'type', 'number', 'source', 'manual', 'required', true, 'defaultValue', '4000'),
    JSON_OBJECT('key', 'costo_instalacion', 'label', 'Costo de instalación única (S/.)', 'type', 'number', 'source', 'manual', 'required', true, 'defaultValue', '1500'),
    JSON_OBJECT('key', 'costo_infraestructura', 'label', 'Costo mensual de infraestructura (S/.)', 'type', 'number', 'source', 'manual', 'required', false, 'defaultValue', '800')
  )
),
'**{{emisor_razon_social}}**\nRUC {{emisor_ruc}} · {{emisor_direccion}}\n📱 {{emisor_telefono}} · 📧 {{emisor_email}} · 🌐 {{emisor_website}}\n\n---\n\n# 📘 Propuesta Comercial\n### Sistema de Gestión Integral de Cobranza\n\n| | |\n|---|---|\n| **Cliente** | {{cliente_razon_social}} |\n| **Contacto** | {{cliente_contacto}} |\n| **Fecha** | {{fecha_emision}} |\n| **Referencia** | {{referencia}} |\n| **Modelo de cotización** | Mensual fijo |\n| **Validez** | 15 días calendario |\n\n---\n\n## 🎯 Resumen ejecutivo\n\n{{cliente_razon_social}} requiere una plataforma de cobranza predecible, sin sorpresas en la factura. Nuestra modalidad **mensual fijo** ofrece una tarifa plana para hasta {{posiciones_maximas}} posiciones activas.\n\n- ✅ Precio único, factura predecible\n- ✅ Incluye hasta **{{posiciones_maximas}} posiciones**\n- ✅ Instalación, configuración y capacitación **incluidas**\n- ✅ **SLA 98.8%** con penalidad por incumplimiento\n- ✅ **Soporte 24/7** remoto + presencial\n\n> 💰 **Mensualidad:** S/ {{costo_mensual}} + IGV (fija)\n> ⏱️ **Implementación:** 5 días hábiles\n\n---\n\n## 💰 Inversión\n\n| Concepto | Detalle | Monto |\n|---|---|---|\n| Licencia KUBO | Hasta {{posiciones_maximas}} posiciones | **S/ {{costo_mensual}} / mes** |\n| Infraestructura cloud | Servidor + BD | S/ {{costo_infraestructura}} / mes |\n| Setup inicial (único) | Instalación + capacitación | S/ {{costo_instalacion}} |\n\n*Todos los montos en soles peruanos, no incluyen IGV. Post-pago mensual a 30 días.*\n\n*Si superas las {{posiciones_maximas}} posiciones activas, se renegocia la tarifa con 30 días de anticipación.*\n\n---\n\n## 🔧 Alcance del servicio\n\n### Incluido\n\n- 📞 Campañas Inbound, Outbound y mixtas, ilimitadas\n- 👥 Skills por agente con distribución inteligente\n- 🏷️ Tipificaciones completas del ciclo de llamada\n- 📊 Reportes por nivel (agente, supervisor, BO)\n- ⚖️ Módulo de cobranza judicial\n- 🔌 Integraciones con la BD del cliente\n- 🛠️ Módulos a medida bajo demanda\n- 🎓 Capacitación a usuarios y supervisores\n- 🆘 Soporte 24/7 remoto + presencial\n\n---\n\n## 🛡️ SLA\n\n- Disponibilidad: **98.8%** mensual garantizado\n- Backup: diario, cifrado, retención 90 días\n- Penalidad: 10% de descuento sobre factura del mes afectado ante incumplimiento\n\n---\n\n**{{emisor_representante}}**\nGerente Comercial — {{emisor_razon_social}}\n📧 {{emisor_email}} · 📱 {{emisor_telefono}}'
);

-- ============================================================
-- 4) NDA simple (con membrete y datos del emisor dinámicos)
-- ============================================================
INSERT INTO document_templates (name, type, description, variables_schema, content_markdown) VALUES (
'Acuerdo de Confidencialidad (NDA)',
'NDA',
'Acuerdo de confidencialidad bilateral para primeras conversaciones con prospectos.',
JSON_OBJECT(
  'variables', JSON_ARRAY(
    JSON_OBJECT('key', 'cliente_razon_social', 'label', 'Razón social del cliente', 'type', 'text', 'source', 'client', 'required', true),
    JSON_OBJECT('key', 'cliente_ruc', 'label', 'RUC del cliente', 'type', 'text', 'source', 'client', 'required', false),
    JSON_OBJECT('key', 'cliente_representante', 'label', 'Representante legal del cliente', 'type', 'text', 'source', 'client', 'required', true),
    JSON_OBJECT('key', 'cliente_dni', 'label', 'DNI del representante del cliente', 'type', 'text', 'source', 'client', 'required', false),
    JSON_OBJECT('key', 'fecha_firma', 'label', 'Fecha de firma', 'type', 'date', 'source', 'auto', 'required', true),
    JSON_OBJECT('key', 'proposito', 'label', 'Propósito de las conversaciones', 'type', 'longtext', 'source', 'manual', 'required', true, 'defaultValue', 'Evaluación comercial de los servicios de software ofrecidos por la Empresa.')
  )
),
'**{{emisor_razon_social}}**\nRUC {{emisor_ruc}} · {{emisor_direccion}}\n📱 {{emisor_telefono}} · 📧 {{emisor_email}}\n\n---\n\n# ACUERDO DE CONFIDENCIALIDAD\n\nEn la ciudad de Lima, al {{fecha_firma}}, entre:\n\n**{{emisor_razon_social}}**, identificada con RUC {{emisor_ruc}}, representada por {{emisor_representante}} (DNI {{emisor_dni_representante}}), con domicilio en {{emisor_direccion}}, en adelante **"LA EMPRESA"**;\n\ny\n\n**{{cliente_razon_social}}**, identificada con RUC {{cliente_ruc}}, representada por {{cliente_representante}} (DNI {{cliente_dni}}), en adelante **"EL CLIENTE"**;\n\nen conjunto denominadas **LAS PARTES**, acuerdan celebrar el presente **Acuerdo de Confidencialidad** bajo las siguientes cláusulas:\n\n## PRIMERO — PROPÓSITO\n\n{{proposito}}\n\n## SEGUNDO — INFORMACIÓN CONFIDENCIAL\n\nSe considerará Información Confidencial toda aquella información, sea oral, escrita, visual o electrónica, intercambiada entre LAS PARTES durante la vigencia del presente acuerdo, incluyendo sin limitarse a: tecnología, procesos, datos comerciales, financieros, clientes, proveedores, estrategias, propiedad intelectual y know-how.\n\n## TERCERO — OBLIGACIONES\n\nLAS PARTES se obligan a:\n\n1. Mantener la Información Confidencial en estricta reserva.\n2. No divulgar a terceros sin autorización escrita previa.\n3. Utilizar la Información únicamente para el propósito descrito en la cláusula Primera.\n4. Restringir el acceso solo a personal que necesite conocerla para dicho propósito.\n5. Devolver o destruir la Información al término del acuerdo.\n\n## CUARTO — EXCLUSIONES\n\nNo se considerará confidencial la información que:\n\n- Sea de dominio público al momento de la divulgación.\n- Se convierta en pública sin culpa de la parte receptora.\n- Haya sido conocida antes de la firma del presente acuerdo y pueda demostrarse.\n- Sea requerida por autoridad competente, previa notificación a la otra parte.\n\n## QUINTO — DURACIÓN\n\nEl presente acuerdo tendrá una vigencia de **dos (2) años** desde la fecha de firma. Las obligaciones de confidencialidad subsistirán por un plazo adicional de tres (3) años tras su terminación.\n\n## SEXTO — INCUMPLIMIENTO\n\nEl incumplimiento generará responsabilidad civil y, de corresponder, penal. La parte afectada podrá exigir el cese inmediato de la divulgación y la indemnización por daños y perjuicios.\n\n## SÉPTIMO — JURISDICCIÓN\n\nLAS PARTES se someten a la jurisdicción y leyes de la República del Perú. Toda controversia será resuelta en la ciudad de Lima.\n\n---\n\nEn señal de conformidad, LAS PARTES firman el presente documento en dos (2) ejemplares de igual tenor.\n\n\n**_______________________________**\n{{emisor_representante}}\nDNI: {{emisor_dni_representante}}\n{{emisor_razon_social}}\n\n\n**_______________________________**\n{{cliente_representante}}\nDNI: {{cliente_dni}}\n{{cliente_razon_social}}'
);
