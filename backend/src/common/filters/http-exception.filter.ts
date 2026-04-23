import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const payload =
      exception instanceof HttpException
        ? (exception.getResponse() as Record<string, unknown>)
        : { message: 'Internal server error' };

    const body = {
      statusCode: status,
      code: this.resolveCode(status, payload),
      message:
        typeof payload === 'string'
          ? payload
          : (payload.message as string) ?? 'Error',
      details: typeof payload === 'object' ? (payload as any).details : undefined,
      path: req.url,
      timestamp: new Date().toISOString(),
    };

    if (status >= 500) {
      this.logger.error(`${req.method} ${req.url} → ${status}`, exception as Error);
    }

    res.status(status).json(body);
  }

  private resolveCode(status: number, payload: Record<string, unknown>): string {
    if (typeof payload === 'object' && typeof payload.code === 'string') {
      return payload.code;
    }
    const map: Record<number, string> = {
      400: 'VALIDATION_ERROR',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      413: 'PAYLOAD_TOO_LARGE',
      415: 'UNSUPPORTED_MEDIA_TYPE',
    };
    return map[status] ?? 'INTERNAL_ERROR';
  }
}
