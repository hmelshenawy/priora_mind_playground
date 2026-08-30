import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Global exception filter (FR-037, FR-030).
 *
 * - Never echoes the submitted request body or sensitive path/params.
 * - Maps HttpException → its status + safe response shape (ValidationPipe and
 *   all domain errors arrive as HttpExceptions carrying the 400/4xx bodies).
 * - Maps everything else → 500 `INTERNAL` with no stack/message leak to the
 *   client; the redacted context is logged server-side only.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: unknown = { error: { code: 'INTERNAL' } };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      body = typeof response === 'string' ? { error: { code: 'ERROR', message: response } } : response;
    } else {
      // Log only non-sensitive context; never the request body.
      this.logger.error(
        `Unhandled exception on ${req.method} ${req.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    if (!res.headersSent) {
      res.status(status).json(body);
    }
  }
}