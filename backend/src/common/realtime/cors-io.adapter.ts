import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';

/**
 * Adaptador de socket.io con el mismo CORS que la API REST (`CORS_ORIGINS`).
 *
 * Va aquí y no en el decorador `@WebSocketGateway`: el decorador se evalúa al
 * cargar el módulo, antes de que `ConfigModule` haya leído el `.env`, así que
 * en desarrollo vería `process.env.CORS_ORIGINS` vacío.
 */
export class CorsIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origins: string[],
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    return super.createIOServer(port, {
      ...options,
      // `'*'` literal no casa con ningún origen cuando va dentro de una lista;
      // `true` refleja el origen de la petición, que es lo que significa aquí.
      cors: { origin: this.origins.includes('*') ? true : this.origins, credentials: true },
    });
  }
}
