import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  Optional,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { RuleError } from '@sanad/core';
import type { Request, Response } from 'express';
import { TelemetryService } from '../telemetry/telemetry.service.js';

/** A business error raised by the API layer (not the core engine). */
export class ApiError extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
  ) {
    super({ code, message }, status);
  }
}

export const notFound = (what: string) =>
  new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} not found`);
export const forbidden = (code: string, message: string) =>
  new ApiError(HttpStatus.FORBIDDEN, code, message);
export const conflict = (code: string, message: string) =>
  new ApiError(HttpStatus.CONFLICT, code, message);
export const unprocessable = (code: string, message: string) =>
  new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, code, message);

/**
 * Maps errors to `{ code, message }`. Engine RuleErrors become 422. Unknown errors become 500
 * without leaking details (and are logged without request bodies — spec §15: no PII in logs).
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  constructor(@Optional() private readonly telemetry?: TelemetryService) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (error instanceof RuleError) {
      res
        .status(422)
        .json({ code: error.code, message: error.message.replace(/^\[[A-Z_]+\] /, '') });
      return;
    }
    if (error instanceof HttpException) {
      const body = error.getResponse();
      const status = error.getStatus();
      if (typeof body === 'object' && body !== null && 'code' in body) {
        res.status(status).json(body);
        return;
      }
      const message =
        typeof body === 'string'
          ? body
          : ((body as { message?: unknown }).message ?? error.message);
      res.status(status).json({ code: HttpStatus[status] ?? 'ERROR', message });
      return;
    }
    if (isDatabaseDown(error)) {
      // Log only the driver code: the wrapped query text includes parameters (PII).
      this.logger.error(
        pgCode(error) === '28P01'
          ? 'Database rejected the sanad login (28P01): another Postgres is answering on this port ' +
              '(another project or a local install). Check DATABASE_URL / docker compose ports.'
          : `Database unavailable (${pgCode(error) ?? 'unknown'}). Is Postgres running? Try "pnpm infra:up".`,
      );
      res
        .status(503)
        .json({ code: 'DATABASE_UNAVAILABLE', message: 'The database is not reachable' });
      return;
    }
    if (isSchemaMissing(error)) {
      this.logger.error('Database schema missing (42P01) — run pnpm db:migrate');
      res
        .status(503)
        .json({ code: 'DATABASE_NOT_MIGRATED', message: 'The database is not set up' });
      return;
    }
    this.logger.error(safeLogText(error));
    const req = host.switchToHttp().getRequest<Request>();
    const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
    void this.telemetry?.recordError({
      source: 'api',
      message: safeLogText(error).split('\n')[0] ?? 'error',
      stack: error instanceof Error && !('params' in error) ? (error.stack ?? null) : null,
      context: `${req.method} ${route}`,
    });
    res.status(500).json({ code: 'INTERNAL', message: 'Something went wrong' });
  }
}

/** pg errors carry a SQLSTATE `code`; Drizzle wraps them in `cause`. */
function pgCode(error: unknown): string | undefined {
  for (let e: unknown = error, i = 0; e && i < 4; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

function isDatabaseDown(error: unknown): boolean {
  const code = pgCode(error);
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === '57P03' || // cannot connect now
    code === '3D000' || // database does not exist
    code === '28P01' // password authentication failed
  );
}

/** 42P01 = undefined table (migrations not applied). */
function isSchemaMissing(error: unknown): boolean {
  return pgCode(error) === '42P01';
}

/**
 * Drizzle query errors embed the SQL parameters (phones, names…) in their message. Log the
 * driver's own error instead so no personal data reaches the logs (spec §15).
 */
function safeLogText(error: unknown): string {
  if (error instanceof Error && 'params' in error) {
    const cause = (error as { cause?: unknown }).cause;
    const why = cause instanceof Error ? cause.message : 'query failed';
    return `Database query failed (${pgCode(error) ?? 'unknown'}): ${why}`;
  }
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
