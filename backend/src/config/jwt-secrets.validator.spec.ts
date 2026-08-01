import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { JwtSecretsValidator } from './jwt-secrets.validator';

/** ConfigService de mentira: solo resuelve el mapa que se le pasa. */
const cfgWith = (vars: Record<string, string | undefined>): ConfigService =>
  ({ get: (key: string) => vars[key] }) as unknown as ConfigService;

const REALES = {
  JWT_ACCESS_SECRET: 'aaaa1111bbbb2222cccc3333dddd4444',
  JWT_REFRESH_SECRET: 'eeee5555ffff6666gggg7777hhhh8888',
  JWT_CLIENT_ACCESS_SECRET: 'iiii9999jjjj0000kkkk1111llll2222',
  JWT_CLIENT_REFRESH_SECRET: 'mmmm3333nnnn4444oooo5555pppp6666',
};

const build = (vars: Record<string, string | undefined>) =>
  new JwtSecretsValidator(cfgWith(vars));

describe('JwtSecretsValidator', () => {
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('deja arrancar si los cuatro secretos estan presentes y son distintos', () => {
    expect(() =>
      build({ ...REALES, NODE_ENV: 'production' }).onApplicationBootstrap(),
    ).not.toThrow();
    expect(log).toHaveBeenCalled();
  });

  it('aborta si dos secretos son iguales', () => {
    expect(() =>
      build({
        ...REALES,
        JWT_CLIENT_ACCESS_SECRET: REALES.JWT_ACCESS_SECRET,
        NODE_ENV: 'production',
      }).onApplicationBootstrap(),
    ).toThrow(/distintos/i);
  });

  it('aborta si dos secretos son iguales incluso en desarrollo', () => {
    // La distincion entre personal y cliente no se relaja en ningun entorno:
    // si se repiten, un token de cliente valida contra JwtStrategy.
    expect(() =>
      build({
        ...REALES,
        JWT_CLIENT_ACCESS_SECRET: REALES.JWT_ACCESS_SECRET,
        NODE_ENV: 'development',
      }).onApplicationBootstrap(),
    ).toThrow(/distintos/i);
  });

  it('aborta si falta alguno de los cuatro', () => {
    expect(() =>
      build({
        ...REALES,
        JWT_CLIENT_REFRESH_SECRET: undefined,
        NODE_ENV: 'production',
      }).onApplicationBootstrap(),
    ).toThrow(/JWT_CLIENT_REFRESH_SECRET/);
  });

  it('aborta si alguno esta vacio o solo espacios', () => {
    expect(() =>
      build({ ...REALES, JWT_CLIENT_ACCESS_SECRET: '   ', NODE_ENV: 'production' }).onApplicationBootstrap(),
    ).toThrow(/JWT_CLIENT_ACCESS_SECRET/);
  });

  it('aborta si alguno conserva su valor placeholder', () => {
    expect(() =>
      build({
        ...REALES,
        JWT_CLIENT_ACCESS_SECRET: 'change-me-client',
        NODE_ENV: 'production',
      }).onApplicationBootstrap(),
    ).toThrow(/placeholder/i);
  });

  it('aborta por placeholder tambien si NODE_ENV no esta definido (falla cerrado)', () => {
    expect(() =>
      build({ ...REALES, JWT_ACCESS_SECRET: 'cambiar-con-openssl-rand-base64-48' }).onApplicationBootstrap(),
    ).toThrow(/placeholder/i);
  });

  it('en desarrollo el placeholder avisa pero no aborta', () => {
    expect(() =>
      build({
        ...REALES,
        JWT_ACCESS_SECRET: 'change-me-access',
        NODE_ENV: 'development',
      }).onApplicationBootstrap(),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('JWT_ACCESS_SECRET'));
  });
});
