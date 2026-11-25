import { Request, Response, NextFunction } from 'express';

export class HttpException extends Error {
  statusCode: number;
  detail: string;

  constructor(statusCode: number, detail: string) {
    super(detail);
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

export function errorHandler(
  err: Error | HttpException,
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (err instanceof HttpException) {
    return res.status(err.statusCode).json({ detail: err.detail });
  }

  // Errors from Express's own parts carry a 4xx status: broken JSON (400),
  // a body that is too large (413), a blocked CORS origin (403).
  const status = (err as { status?: number; statusCode?: number }).status ?? (err as { statusCode?: number }).statusCode;
  if (status && status >= 400 && status < 500) {
    const detail =
      status === 400 ? 'The request body is not valid JSON' : status === 413 ? 'The request is too large' : err.message;
    return res.status(status).json({ detail });
  }

  console.error('Unhandled error:', err);
  return res.status(500).json({ detail: 'Internal server error' });
}
