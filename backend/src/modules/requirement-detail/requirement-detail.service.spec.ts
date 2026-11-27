import { RequirementDetailService } from './requirement-detail.service';

const RQ = {
  id: 3, code: 'RQ-0003', title: 'Agregar en reporte compromiso', clientId: 4, clientSystemId: null,
  status: 'SOLICITADO', descriptionMd: 'Agregar columna', acceptanceCriteria: null, requestType: 'CAMBIO',
  createdByClientUserId: 21,
};

function build(over: { rq?: object; user?: object | null; emailFails?: boolean; llm?: string; clientDocs?: object[] } = {}) {
  const rq = { ...RQ, ...(over.rq ?? {}) };
  const intake = { requestDetail: jest.fn().mockResolvedValue({ ...rq, status: 'FALTA_INFO' }) };
  const items = { findByIdOrFail: jest.fn().mockResolvedValue(rq) };
  const clientUsers = {
    findById: jest.fn().mockResolvedValue(
      over.user === null ? null : { id: 21, email: 'eduardo@cliente.pe', fullName: 'Eduardo Rojas', isActive: 1, ...(over.user ?? {}) },
    ),
  };
  const email = {
    send: over.emailFails ? jest.fn().mockRejectedValue(new Error('SMTP')) : jest.fn().mockResolvedValue({ messageId: 'x' }),
  };
  const config = { get: jest.fn().mockReturnValue('https://docs.kuboti.com') };
  const clients = { findByIdOrFail: jest.fn().mockResolvedValue({ razonSocial: 'Cobros Seguros' }) };
  const data = { query: jest.fn().mockResolvedValue([{ name: 'Kubo CRM' }]) };
  const llm = { chat: jest.fn().mockResolvedValue(over.llm ?? '## Objetivo\nX\n\n## Preguntas abiertas\n- ¿Qué reporte?') };
  const docs = {
    renderManualPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF')),
    upload: jest.fn().mockImplementation(async (i: { kind: string }) => ({ id: i.kind === 'OTRO' ? 61 : 60, kind: i.kind })),
    listBySource: jest.fn().mockResolvedValue(over.clientDocs ?? []),
    readText: jest.fn().mockImplementation(async (_w: number, id: number) => (id === 70 ? 'Agrupar por gestor.' : null)),
  };
  const service = new RequirementDetailService(
    intake as never, items as never, clientUsers as never, email as never, config as never,
    clients as never, data as never, llm as never, docs as never,
  );
  return { service, intake, email, llm, docs };
}

describe('RequirementDetailService.requestDetail', () => {
  it('lo pasa a falta información y le escribe a quien lo pidió', async () => {
    const { service, intake, email } = build();
    const out = await service.requestDetail(3, 5, '¿Qué reporte?');
    expect(intake.requestDetail).toHaveBeenCalledWith(3, 5, '¿Qué reporte?');
    const [msg] = email.send.mock.calls[0];
    expect(msg.to).toBe('eduardo@cliente.pe');
    expect(msg.subject).toContain('RQ-0003');
    expect(msg.html).toContain('¿Qué reporte?');
    expect(msg.html).toContain('https://docs.kuboti.com/portal/requerimientos/3');
    expect(out).toMatchObject({ notified: true });
  });

  it('escapa el HTML de la pregunta', async () => {
    const { service, email } = build();
    await service.requestDetail(3, 5, '<script>x</script>');
    expect(email.send.mock.calls[0][0].html).not.toContain('<script>');
  });

  it('un requerimiento interno (sin autor cliente) no manda correo', async () => {
    const { service, email } = build({ rq: { createdByClientUserId: null } });
    const out = await service.requestDetail(3, 5, '¿?');
    expect(email.send).not.toHaveBeenCalled();
    expect(out.notified).toBe(false);
  });

  it('un usuario inactivo no recibe correo', async () => {
    const { service, email } = build({ user: { isActive: 0 } });
    await service.requestDetail(3, 5, '¿?');
    expect(email.send).not.toHaveBeenCalled();
  });

  it('si el correo falla, el estado ya cambió y lo informa', async () => {
    const { service } = build({ emailFails: true });
    const out = await service.requestDetail(3, 5, '¿?');
    expect(out.notified).toBe(false);
    expect(out.emailError).toMatch(/no se pudo enviar/i);
  });
});

describe('RequirementDetailService.draftSpec', () => {
  it('genera la Especificación como borrador en Documentos y devuelve las preguntas', async () => {
    const { service, llm, docs } = build();
    const out = await service.draftSpec(3, 5);
    expect(llm.chat).toHaveBeenCalledTimes(1);
    expect(docs.upload).toHaveBeenCalledWith(
      expect.objectContaining({ workItemId: 3, kind: 'ESPECIFICACION', status: 'BORRADOR', actorUserId: 5 }),
    );
    expect(docs.upload).toHaveBeenCalledTimes(1);
    expect(out.preguntas).toEqual(['¿Qué reporte?']);
    expect(out.brief).toBeNull();
  });

  it('en un proyecto nuevo guarda también el brief de prototipo', async () => {
    const { service, docs } = build({
      rq: { requestType: 'PROYECTO' },
      llm: '## Objetivo\nX\n\n## Brief de prototipo\n**[1. Idea]**\nDashboard',
    });
    const out = await service.draftSpec(3, 5);
    expect(docs.upload).toHaveBeenCalledTimes(2);
    expect(docs.upload).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'OTRO', filename: 'RQ-0003 - Brief de prototipo.pdf' }));
    expect(out.brief).toContain('[1. Idea]');
  });

  it('le pasa a la IA el texto de los Word que adjuntó el cliente', async () => {
    const { service, llm, docs } = build({
      clientDocs: [
        { id: 70, filename: 'detalle.docx' },
        { id: 71, filename: 'pantalla.png' },
      ],
    });
    await service.draftSpec(3, 5);
    expect(docs.listBySource).toHaveBeenCalledWith(3, 'CLIENTE');
    const user = llm.chat.mock.calls[0][1][0].content as string;
    expect(user).toContain('Agrupar por gestor.');
    expect(user).toContain('«pantalla.png»');
  });

  it('una respuesta vacía de la IA no deja documento', async () => {
    const { service, docs } = build({ llm: '   ' });
    await expect(service.draftSpec(3, 5)).rejects.toThrow(/no devolvió/i);
    expect(docs.upload).not.toHaveBeenCalled();
  });
});
