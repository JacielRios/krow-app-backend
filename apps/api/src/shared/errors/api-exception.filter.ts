import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const incoming = request.header('x-request-id');
    const requestId =
      incoming && /^[a-zA-Z0-9-]{1,64}$/.test(incoming)
        ? incoming
        : randomUUID();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const candidate =
      typeof raw === 'object'
        ? (raw as { message?: string | string[] }).message
        : raw;
    const message = Array.isArray(candidate)
      ? candidate.join(', ')
      : (candidate ??
        (exception instanceof Error ? exception.message : 'Error interno'));

    if (status >= 500)
      this.logger.error(
        JSON.stringify({
          event: 'api_request_failed',
          requestId,
          status,
          errorType:
            exception instanceof Error ? exception.name : 'UnknownError',
        }),
      );
    response.setHeader('x-request-id', requestId);
    response.status(status).json({
      code: this.codeFor(status),
      message:
        status >= 500
          ? 'KROW no pudo completar la operación. Intenta nuevamente.'
          : message,
      requestId,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }

  private codeFor(status: number): string {
    if (status === 400) return 'VALIDATION_ERROR';
    if (status === 401) return 'UNAUTHENTICATED';
    if (status === 403) return 'FORBIDDEN';
    if (status === 404) return 'NOT_FOUND';
    if (status === 409) return 'CONFLICT';
    return status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR';
  }
}
