import { ROLES_KEY } from '../../common/decorators/roles.decorator';

import { CLIENT_VARIABLES, TEAM_VARIABLES } from './domain/template-renderer';
import { NotificationTemplatesController } from './notification-templates.controller';

/** Doble mínimo del servicio: cada método es un `jest.fn` propio. */
function makeController() {
  const service = {
    list: jest.fn(),
    update: jest.fn(),
    preview: jest.fn(),
    sendTest: jest.fn(),
  };
  const controller = new NotificationTemplatesController(service as any);
  return { controller, service };
}

const PLANTILLA_BASE = {
  subject: 's',
  bodyMd: 'b',
  isActive: 1,
  updatedBy: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('NotificationTemplatesController.sendTest', () => {
  it('sin destinatario en el cuerpo, la prueba va al correo del usuario del token', async () => {
    const { controller, service } = makeController();
    service.sendTest.mockResolvedValue({ to: 'admin@kubo.pe' });
    await controller.sendTest(6, { id: 9, email: 'admin@kubo.pe', role: 'ADMIN' }, {});
    expect(service.sendTest).toHaveBeenCalledWith(6, 'admin@kubo.pe');
  });

  it('un ADMIN puede elegir otra dirección para la prueba (una sola, ya validada por el DTO)', async () => {
    const { controller, service } = makeController();
    service.sendTest.mockResolvedValue({ to: 'yo@gmail.com' });
    await controller.sendTest(6, { id: 9, email: 'admin@kubo.pe', role: 'ADMIN' }, { to: '  yo@gmail.com ' });
    expect(service.sendTest).toHaveBeenCalledWith(6, 'yo@gmail.com');
  });
});

describe('NotificationTemplatesController.preview', () => {
  it('delega en el servicio sin pasarle ningún destinatario: no se envía nada', async () => {
    const { controller, service } = makeController();
    service.preview.mockResolvedValue({ subject: 's', html: 'h', text: 't' });

    const result = await controller.preview(6);

    expect(service.preview).toHaveBeenCalledWith(6);
    expect(service.preview.mock.calls[0]).toHaveLength(1);
    expect(result).toEqual({ subject: 's', html: 'h', text: 't' });
  });
});

describe('NotificationTemplatesController.list', () => {
  it('añade a cada plantilla el catálogo de variables de su propio público', async () => {
    const { controller, service } = makeController();
    service.list.mockResolvedValue([
      { id: 1, triggerKey: 'TICKET_CREATED', audience: 'CLIENT', ...PLANTILLA_BASE },
      { id: 6, triggerKey: 'TICKET_CREATED_PORTAL', audience: 'TEAM', ...PLANTILLA_BASE },
    ]);

    const rows = await controller.list();

    expect(rows[0].variables).toEqual(CLIENT_VARIABLES);
    expect(rows[1].variables).toEqual(TEAM_VARIABLES);
  });

  it('convierte isActive (0/1 de la fila) a booleano en la vista', async () => {
    const { controller, service } = makeController();
    service.list.mockResolvedValue([
      { id: 7, triggerKey: 'SLA_AT_RISK', audience: 'TEAM', ...PLANTILLA_BASE, isActive: 0 },
    ]);

    const rows = await controller.list();
    expect(rows[0].isActive).toBe(false);
  });
});

describe('NotificationTemplatesController.update', () => {
  it('pasa el id del usuario autenticado como editor, no algo del cuerpo', async () => {
    const { controller, service } = makeController();
    service.update.mockResolvedValue({ id: 1, triggerKey: 'TICKET_CREATED', audience: 'CLIENT', ...PLANTILLA_BASE });

    await controller.update(1, { id: 42, email: 'admin@kubo.pe', role: 'ADMIN' }, { subject: 'nuevo' } as any);

    expect(service.update).toHaveBeenCalledWith(1, 42, { subject: 'nuevo' });
  });
});

/**
 * Estas plantillas son los textos que salen en nombre de Kubo hacia clientes
 * reales, con las variables internas que cada publico puede ver. Leerlas no es
 * una operacion neutra: quien las lee sabe exactamente que se le cuenta a cada
 * lado y por que canal.
 *
 * La pantalla ya lo trata asi -- se cierra entera con `canManageUsers` -- pero
 * el backend dejaba el `GET` abierto a cualquier miembro del equipo
 * autenticado. Un permiso que solo vive en el frontend no es un permiso: basta
 * un `curl` con el token de cualquier tecnico. El sitio donde tiene que
 * coincidir es el backend, no al reves.
 */
describe('los permisos del controlador', () => {
  const rolesDe = (metodo: string): string[] | undefined =>
    Reflect.getMetadata(
      ROLES_KEY,
      (NotificationTemplatesController.prototype as any)[metodo],
    );

  it.each(['list', 'update', 'preview', 'sendTest'])(
    '%s exige rol ADMIN',
    (metodo) => {
      expect(rolesDe(metodo)).toEqual(['ADMIN']);
    },
  );
});

describe('SendTestDto', () => {
  it('acepta vacío o un correo; rechaza lo que no es un correo o trae varios', async () => {
    const { validate } = await import('class-validator');
    const { plainToInstance } = await import('class-transformer');
    const { SendTestDto } = await import('./dto/send-test.dto');
    const errs = async (o: object) => (await validate(plainToInstance(SendTestDto, o))).length;
    expect(await errs({})).toBe(0);
    expect(await errs({ to: 'yo@gmail.com' })).toBe(0);
    expect(await errs({ to: 'no-es-correo' })).toBeGreaterThan(0);
    expect(await errs({ to: 'a@x.com,b@y.com' })).toBeGreaterThan(0);
  });
});
