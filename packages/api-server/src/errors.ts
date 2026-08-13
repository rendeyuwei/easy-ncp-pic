import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_CREDENTIALS'
  | 'UNAUTHORIZED'
  | 'CSRF_INVALID'
  | 'NOT_FOUND'
  | 'DUPLICATE_NCP'
  | 'SLUG_CONFLICT'
  | 'INVALID_NCP'
  | 'UNSUPPORTED_NCP'
  | 'CATEGORY_IN_USE'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly errors?: Array<{ field: string; message: string }>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  code: ApiErrorCode;
  message: string;
  errors?: Array<{ field: string; message: string }>;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof ApiError) {
      const body: ErrorBody = { code: err.code, message: err.message };
      if (err.errors) body.errors = err.errors;
      return reply.status(err.statusCode).send(body);
    }
    if (err.validation) {
      const errors = err.validation.map((v) => ({
        field: v.instancePath?.replace(/^\//, '') || (v.params as { missingProperty?: string } | undefined)?.missingProperty || 'body',
        message: v.message ?? 'invalid value',
      }));
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'Request validation failed', errors });
    }
    if (err.statusCode === 429) {
      return reply.status(429).send({ code: 'RATE_LIMITED', message: 'Too many requests' });
    }
    if (err.statusCode === 413) {
      return reply.status(413).send({ code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' });
    }
    req.log.error(err);
    return reply.status(500).send({ code: 'INTERNAL', message: 'Internal server error' });
  });

  app.setNotFoundHandler((_req: FastifyRequest, reply: FastifyReply) => {
    reply.status(404).send({ code: 'NOT_FOUND', message: 'Route not found' });
  });
}
