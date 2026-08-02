import { variablesFor, validateTemplate, render, sampleValuesFor } from './template-renderer';

describe('variablesFor', () => {
  it('el publico CLIENT expone exactamente las seis variables del portal', () => {
    expect(variablesFor('CLIENT')).toEqual([
      'codigo',
      'asunto',
      'estado',
      'fecha',
      'razon_social',
      'enlace_portal',
    ]);
  });

  it('el publico TEAM incluye las de CLIENT mas las cinco internas', () => {
    expect(variablesFor('TEAM')).toEqual([
      'codigo',
      'asunto',
      'estado',
      'fecha',
      'razon_social',
      'enlace_portal',
      'prioridad',
      'sla',
      'responsable',
      'motivo',
      'enlace_panel',
    ]);
  });
});

describe('sampleValuesFor', () => {
  it('CLIENT trae valor para cada una de sus seis variables, ninguna vacía', () => {
    const values = sampleValuesFor('CLIENT');
    for (const nombre of variablesFor('CLIENT')) {
      expect(values[nombre]).toBeTruthy();
    }
  });

  it('CLIENT no trae ninguna variable de equipo: no sugiere que se puedan usar', () => {
    const values = sampleValuesFor('CLIENT');
    expect(values.prioridad).toBeUndefined();
    expect(values.sla).toBeUndefined();
    expect(values.responsable).toBeUndefined();
    expect(values.motivo).toBeUndefined();
    expect(values.enlace_panel).toBeUndefined();
  });

  it('TEAM trae valor para las once variables, ninguna vacía', () => {
    const values = sampleValuesFor('TEAM');
    for (const nombre of variablesFor('TEAM')) {
      expect(values[nombre]).toBeTruthy();
    }
  });

  it('renderizar una plantilla sembrada con estos valores no deja ninguna variable como "(no disponible)"', () => {
    const plantillaEquipo = '{{codigo}} {{asunto}} {{estado}} {{fecha}} {{razon_social}} ' +
      '{{enlace_portal}} {{prioridad}} {{sla}} {{responsable}} {{motivo}} {{enlace_panel}}';
    const out = render(plantillaEquipo, 'TEAM', sampleValuesFor('TEAM'));
    expect(out).not.toContain('no disponible');
    expect(out).not.toContain('{{');
  });
});

describe('render', () => {
  const baseValues = {
    codigo: 'TCK-001',
    asunto: 'No carga el reporte',
    estado: 'EN_ATENCION',
    fecha: '2026-08-02',
    razon_social: 'Comercial Andina SpA',
    enlace_portal: 'https://portal.kubo.cl/tickets/TCK-001',
  };

  it('sustituye una variable conocida', () => {
    expect(render('Codigo: {{codigo}}', 'CLIENT', baseValues)).toBe('Codigo: TCK-001');
  });

  it('sustituye la misma variable varias veces', () => {
    expect(render('{{codigo}} - {{codigo}}', 'CLIENT', baseValues)).toBe('TCK-001 - TCK-001');
  });

  it('tolera espacios dentro de las llaves: {{ codigo }} y {{codigo}} son la misma variable', () => {
    expect(render('{{ codigo }} / {{codigo}}', 'CLIENT', baseValues)).toBe('TCK-001 / TCK-001');
  });

  it('escapa el HTML del valor sustituido: el asunto lo escribe el cliente', () => {
    const out = render('Asunto: {{asunto}}', 'CLIENT', {
      ...baseValues,
      asunto: '<script>alert(1)</script> & "comillas" \'simples\'',
    });
    expect(out).toBe(
      'Asunto: &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;comillas&quot; &#39;simples&#39;',
    );
    expect(out).not.toContain('<script>');
  });

  it('sustituye un valor ausente por un texto legible, nunca por undefined ni la llave cruda', () => {
    const out = render('Motivo: {{motivo}}', 'TEAM', { ...baseValues });
    expect(out).not.toContain('undefined');
    expect(out).not.toContain('{{motivo}}');
    expect(out).toBe('Motivo: (no disponible)');
  });

  it('sustituye un valor nulo por el mismo texto legible', () => {
    const out = render('Motivo: {{motivo}}', 'TEAM', { ...baseValues, motivo: null });
    expect(out).toBe('Motivo: (no disponible)');
  });

  it('una llave suelta que no forma una variable no revienta el renderizado', () => {
    const text = 'Precio: { 100 } y objeto { { doble } } y sin cerrar {{codigo';
    expect(render(text, 'CLIENT', baseValues)).toBe(text);
  });

  it('no sustituye una variable de equipo cuando el publico es CLIENT: la deja literal', () => {
    // Defensa en profundidad: aunque llegue un valor para 'motivo', el publico
    // CLIENT no debe imprimirlo. validateTemplate ya rechaza esta plantilla al
    // guardarla, pero render no debe fugarla si por error se le pasa igual.
    const values = { ...baseValues, motivo: 'informacion interna del equipo' };
    expect(render('Motivo: {{motivo}}', 'CLIENT', values as Record<string, string>)).toBe(
      'Motivo: {{motivo}}',
    );
  });

  it('invariante de no reinyeccion: un valor que contiene {{motivo}} no se reinterpreta como variable', () => {
    // El asunto de un ticket lo escribe el cliente. Si un cliente escribe
    // literalmente "{{motivo}}" en el asunto de su propio ticket, la salida no
    // puede convertirse en el motivo interno de una transicion: eso es
    // exactamente la fuga que este modulo existe para impedir. La sustitucion
    // debe hacerse en una sola pasada sobre el texto original, nunca releyendo
    // el resultado ya sustituido en busca de nuevas variables.
    const values = {
      ...baseValues,
      asunto: 'Por favor revisen {{motivo}} del ticket anterior',
      motivo: 'el cliente incumplio el contrato',
    };
    const out = render('Asunto: {{asunto}}', 'CLIENT', values as Record<string, string>);
    expect(out).toBe('Asunto: Por favor revisen {{motivo}} del ticket anterior');
    expect(out).not.toContain('el cliente incumplio el contrato');
  });

  it('invariante de no reinyeccion: un valor que contiene una variable del propio publico tampoco se sustituye', () => {
    // El peligro no es solo cruzar publicos: es que el contenido del usuario
    // controle la plantilla. Si el asunto trae "{{codigo}}" con el valor de
    // OTRO codigo, ese texto debe salir literal, no como el codigo real.
    const values = {
      ...baseValues,
      codigo: 'TCK-001',
      asunto: 'Referencia al ticket {{codigo}} de la semana pasada',
    };
    const out = render('Asunto: {{asunto}}', 'CLIENT', values as Record<string, string>);
    expect(out).toBe('Asunto: Referencia al ticket {{codigo}} de la semana pasada');
  });
});

describe('validateTemplate', () => {
  it('acepta una plantilla CLIENT que solo usa variables de cliente', () => {
    const text =
      '[{{codigo}}] {{asunto}} - {{razon_social}} - {{enlace_portal}} - {{estado}} - {{fecha}}';
    expect(validateTemplate(text, 'CLIENT')).toEqual({ ok: true });
  });

  it('acepta una plantilla TEAM que usa variables de cliente y de equipo', () => {
    const text = '{{codigo}} {{prioridad}} {{sla}} {{responsable}} {{motivo}} {{enlace_panel}}';
    expect(validateTemplate(text, 'TEAM')).toEqual({ ok: true });
  });

  it('rechaza una variable de equipo en una plantilla de cliente, y devuelve cual', () => {
    const result = validateTemplate('Prioridad: {{prioridad}}', 'CLIENT');
    expect(result).toEqual({ ok: false, unknown: [], wrongAudience: ['prioridad'] });
  });

  it('rechaza una variable que no existe en ningun publico, sin confundirla con la de otro publico', () => {
    const result = validateTemplate('{{prioridad}} {{no_existe}}', 'CLIENT');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.wrongAudience).toEqual(['prioridad']);
      expect(result.unknown).toEqual(['no_existe']);
    }
  });

  it('no repite una variable de equipo que aparece varias veces en el reporte de error', () => {
    const result = validateTemplate('{{motivo}} ... {{ motivo }} ... {{prioridad}}', 'CLIENT');
    expect(result).toEqual({ ok: false, unknown: [], wrongAudience: ['motivo', 'prioridad'] });
  });

  it('tolera espacios dentro de las llaves al validar', () => {
    expect(validateTemplate('{{ codigo }}', 'CLIENT')).toEqual({ ok: true });
  });

  it('no marca como invalida una llave suelta que no es variable', () => {
    expect(validateTemplate('precio { 100 } sin cerrar {{codigo', 'CLIENT')).toEqual({
      ok: true,
    });
  });
});
