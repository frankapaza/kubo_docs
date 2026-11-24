import * as net from 'node:net';
import * as https from 'node:https';
import * as tls from 'node:tls';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { CheckErrorCode, CheckKind, CheckResult, Protocol, ServiceTarget } from './types';

export const DEFAULT_TIMEOUTS_MS: Record<Protocol, number> = { TCP: 5000, HTTPS: 10000, ICMP: 5000 };

export interface RunCheckOptions {
  timeoutsMs?: Partial<Record<Protocol, number>>;
  orderId?: number | null;
  now?: () => Date;
  /** CA PEM adicional de confianza (la validación TLS siempre queda activa). */
  ca?: string;
}

type Outcome = { ok: true; httpStatus?: number } | { ok: false; errorCode: CheckErrorCode; httpStatus?: number };

const TLS_CODES = /^(DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|CERT_[A-Z_]+|ERR_TLS_[A-Z_]+|ERR_SSL_[A-Z_]+|HOSTNAME_MISMATCH|EPROTO)$/;

function mapError(err: unknown): CheckErrorCode {
  const code = String((err as { code?: unknown } | null)?.code ?? '');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_NODATA') return 'DNS';
  if (code === 'ECONNREFUSED') return 'REFUSED';
  if (code === 'ETIMEDOUT' || code === 'ABORT_ERR' || code === 'ERR_TIMEOUT') return 'TIMEOUT';
  if (TLS_CODES.test(code)) return 'TLS';
  return 'NETWORK';
}

function tcpCheck(host: string, port: number | null, timeoutMs: number): Promise<Outcome> {
  return new Promise((resolve) => {
    if (port === null || !Number.isInteger(port) || port < 1 || port > 65535) {
      return resolve({ ok: false, errorCode: 'NETWORK' });
    }
    let done = false;
    const sock = net.connect({ host, port });
    const finish = (o: Outcome) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(o);
    };
    const timer = setTimeout(() => finish({ ok: false, errorCode: 'TIMEOUT' }), timeoutMs);
    sock.once('connect', () => finish({ ok: true }));
    sock.once('error', (e) => finish({ ok: false, errorCode: mapError(e) }));
  });
}

function httpsCheck(target: string, timeoutMs: number, ca?: string): Promise<Outcome> {
  return new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      return resolve({ ok: false, errorCode: 'NETWORK' });
    }
    if (url.protocol !== 'https:') return resolve({ ok: false, errorCode: 'NETWORK' });
    let done = false;
    const finish = (o: Outcome) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      req.destroy();
      resolve(o);
    };
    // GET sin seguir redirecciones (node:https no las sigue).
    const req = https.request(
      url,
      { method: 'GET', ...(ca ? { ca: [...tls.rootCertificates, ca] } : {}) },
      (res) => {
        const status = res.statusCode ?? 0;
        res.resume();
        finish(
          status >= 200 && status < 400
            ? { ok: true, httpStatus: status }
            : { ok: false, errorCode: 'HTTP_STATUS', httpStatus: status },
        );
      },
    );
    const timer = setTimeout(() => finish({ ok: false, errorCode: 'TIMEOUT' }), timeoutMs);
    req.on('error', (e) => finish({ ok: false, errorCode: mapError(e) }));
    req.end();
  });
}

function icmpCheck(host: string, timeoutMs: number): Promise<Outcome> {
  return new Promise((resolve) => {
    // Un destino con forma de opción no debe llegar a `ping` como flag.
    if (!host || host.startsWith('-') || /\s/.test(host)) return resolve({ ok: false, errorCode: 'NETWORK' });
    const win = process.platform === 'win32';
    const args = win
      ? ['-n', '1', '-w', String(timeoutMs), host]
      : ['-c', '1', '-W', String(Math.max(1, Math.ceil(timeoutMs / 1000))), host];
    execFile('ping', args, { timeout: timeoutMs + 2000, windowsHide: true }, (err, stdout, stderr) => {
      const out = `${stdout}\n${stderr}`;
      if (!err) {
        // Windows devuelve 0 también con "Destination host unreachable"; exige respuesta real.
        if (win && !/TTL=/i.test(out)) return resolve({ ok: false, errorCode: 'TIMEOUT' });
        return resolve({ ok: true });
      }
      if ((err as { code?: unknown }).code === 'ENOENT') return resolve({ ok: false, errorCode: 'NETWORK' });
      if ((err as { killed?: boolean }).killed) return resolve({ ok: false, errorCode: 'TIMEOUT' });
      if (/could not find host|unknown host|name or service not known|temporary failure in name resolution|cannot resolve|no address associated/i.test(out)) {
        return resolve({ ok: false, errorCode: 'DNS' });
      }
      if (/general failure|network is unreachable|transmit failed/i.test(out)) {
        return resolve({ ok: false, errorCode: 'NETWORK' });
      }
      resolve({ ok: false, errorCode: 'TIMEOUT' });
    });
  });
}

/** Ejecuta una prueba de disponibilidad. Nunca lanza: todo fallo es `ok: false` con `errorCode`. */
export async function runCheck(
  target: ServiceTarget,
  kind: CheckKind,
  cycleAt: Date,
  opts: RunCheckOptions = {},
): Promise<CheckResult> {
  const now = opts.now ?? (() => new Date());
  const timeoutMs = opts.timeoutsMs?.[target.protocol] ?? DEFAULT_TIMEOUTS_MS[target.protocol];
  const startedAt = now();
  const t0 = performance.now();
  let outcome: Outcome;
  try {
    if (target.protocol === 'TCP') outcome = await tcpCheck(target.target, target.port, timeoutMs);
    else if (target.protocol === 'HTTPS') outcome = await httpsCheck(target.target, timeoutMs, opts.ca);
    else if (target.protocol === 'ICMP') outcome = await icmpCheck(target.target, timeoutMs);
    else outcome = { ok: false, errorCode: 'NETWORK' };
  } catch {
    outcome = { ok: false, errorCode: 'NETWORK' };
  }
  return {
    id: randomUUID(),
    serviceId: target.id,
    kind,
    cycleAt: cycleAt.toISOString(),
    startedAt: startedAt.toISOString(),
    durationMs: Math.max(0, Math.round(performance.now() - t0)),
    ok: outcome.ok,
    errorCode: outcome.ok ? null : outcome.errorCode,
    httpStatus: outcome.httpStatus ?? null,
    orderId: opts.orderId ?? null,
  };
}

export type CheckFn = typeof runCheck;
