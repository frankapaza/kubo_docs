import { INestApplication, ValidationPipe } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';

import { HttpExceptionFilter } from '../common/filters/http-exception.filter';

/**
 * Utilidad para pruebas de integración: levanta un `TestingModule` como una
 * aplicación HTTP real, en un puerto efímero de loopback, y hace peticiones
 * contra ella con `fetch`.
 *
 * Existe porque un `ExecutionContext` simulado no prueba nada de lo que de
 * verdad importa aquí: el orden guard → pipe → controlador, el `AuthGuard` de
 * passport verificando una firma JWT real, o la forma final del cuerpo de
 * error tras pasar por el `HttpExceptionFilter`. Todo eso solo se ejerce
 * atravesando el ciclo completo de la petición.
 *
 * El pipe y el filtro se configuran igual que en `main.ts` a propósito: si la
 * prueba no monta lo mismo que producción, comprueba otra aplicación.
 *
 * No es un fichero `.spec.ts`, así que jest no lo recoge como suite.
 */
export interface TestHttpResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export interface TestRequestOptions {
  /** Se envía como `Authorization: Bearer <token>`. */
  token?: string;
  /** Se serializa como JSON. `undefined` no envía cuerpo. */
  body?: unknown;
}

export class TestHttpApp {
  constructor(
    private readonly app: INestApplication,
    private readonly baseUrl: string,
  ) {}

  get(path: string, options: TestRequestOptions = {}): Promise<TestHttpResponse> {
    return this.request('GET', path, options);
  }

  post(path: string, options: TestRequestOptions = {}): Promise<TestHttpResponse> {
    return this.request('POST', path, options);
  }

  async request(
    method: string,
    path: string,
    options: TestRequestOptions = {},
  ): Promise<TestHttpResponse> {
    const headers: Record<string, string> = {};
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }

    return { status: res.status, body, headers: res.headers };
  }

  close(): Promise<void> {
    return this.app.close();
  }
}

/**
 * Arranca el módulo de pruebas en `127.0.0.1:0` — puerto efímero, para no
 * chocar nunca con el backend de desarrollo que ya escucha en el 3003.
 */
export async function startTestHttpApp(moduleRef: TestingModule): Promise<TestHttpApp> {
  const app = moduleRef.createNestApplication();

  // Misma configuración que `main.ts`.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.init();
  await app.listen(0, '127.0.0.1');

  return new TestHttpApp(app, await app.getUrl());
}
