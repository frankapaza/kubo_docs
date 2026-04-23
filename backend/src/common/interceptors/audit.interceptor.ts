import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../../modules/audit/entities/audit-log.entity';

/**
 * Registra toda acción mutante (POST/PATCH/PUT/DELETE) en `audit_log`.
 * Lee `user` inyectado por `JwtAuthGuard` y resuelve la acción desde la ruta.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: { id: number } }>();
    const method = req.method.toUpperCase();
    const isMutation = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);

    return next.handle().pipe(
      tap(async (response) => {
        if (!isMutation) return;
        try {
          const entry = this.repo.create({
            userId: req.user?.id ?? null,
            action: `${method} ${req.route?.path ?? req.url}`,
            entityType: this.resolveEntity(req.url),
            entityId: (response as { id?: number | string })?.id?.toString() ?? null,
            payloadJson: this.safePayload(req.body, response),
            ipAddress: req.ip ?? null,
            userAgent: req.headers['user-agent']?.toString() ?? null,
          });
          await this.repo.save(entry);
        } catch (err) {
          this.logger.warn(`Audit log write failed: ${(err as Error).message}`);
        }
      }),
    );
  }

  private resolveEntity(url: string): string {
    const m = url.match(/\/api\/v1\/([^/?]+)/);
    return (m?.[1] ?? 'unknown').toUpperCase();
  }

  private safePayload(body: unknown, response: unknown): Record<string, unknown> {
    const scrub = (o: unknown): unknown => {
      if (!o || typeof o !== 'object') return o;
      const clone: Record<string, unknown> = { ...(o as Record<string, unknown>) };
      for (const k of ['password', 'passwordHash', 'accessToken', 'refreshToken']) {
        if (k in clone) clone[k] = '***';
      }
      return clone;
    };
    return { request: scrub(body), response: scrub(response) };
  }
}
