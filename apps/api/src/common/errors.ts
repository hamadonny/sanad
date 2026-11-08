import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { RuleError } from '@sanad/core';
import type { Response } from 'express';

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
    this.logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    res.status(500).json({ code: 'INTERNAL', message: 'Something went wrong' });
  }
}
