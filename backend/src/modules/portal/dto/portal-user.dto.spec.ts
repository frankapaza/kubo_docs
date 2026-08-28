import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { InvitePortalUserDto } from './portal-user.dto';

describe('InvitePortalUserDto', () => {
  const base = { email: 'nuevo@kuboti.com', fullName: 'Nuevo Nombre' };

  const validar = async (dto: Record<string, unknown>) => {
    const instancia = plainToInstance(InvitePortalUserDto, dto);
    const errores = await validate(instancia);
    return { instancia, errores };
  };

  it('acepta el alta minima', async () => {
    const { errores } = await validar(base);
    expect(errores).toEqual([]);
  });

  /**
   * Mismo defecto que ya se arregló en `CreatePortalRequirementDto` (el alta
   * de requerimientos) y antes en los tickets: sin `trim` antes de validar,
   * un nombre de solo espacios supera `Length(1, 180)` y se guarda vacío.
   * Van tres veces.
   */
  it('un nombre de solo espacios no pasa: el trim va antes de validar', async () => {
    const { errores } = await validar({ ...base, fullName: '   ' });
    expect(errores).not.toEqual([]);
  });

  it('recorta los espacios de alrededor antes de guardar', async () => {
    const { instancia, errores } = await validar({ ...base, fullName: '  Nuevo Nombre  ' });
    expect(errores).toEqual([]);
    expect(instancia.fullName).toBe('Nuevo Nombre');
  });
});
