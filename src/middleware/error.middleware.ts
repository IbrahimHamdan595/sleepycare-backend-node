import { Request, Response, NextFunction } from 'express';

export class HttpException extends Error {
  statusCode: number;
  detail: string;
  /** Extra fields sent next to `detail`, e.g. the id of the product a message is about. */
  extra?: Record<string, unknown>;

  constructor(statusCode: number, detail: string, extra?: Record<string, unknown>) {
    super(detail);
    this.statusCode = statusCode;
    this.detail = detail;
    this.extra = extra;
  }
}

export function errorHandler(
  err: Error | HttpException,
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (err instanceof HttpException) {
    return res.status(err.statusCode).json({ detail: err.detail, ...err.extra });
  }

  // Upload problems (multer): a file over the size limit, an unexpected field.
  if (err.name === 'MulterError') {
    // An uploaded file, or an image sent as data: text, over the limit.
    const code = (err as { code?: string }).code;
    const tooLarge = code === 'LIMIT_FILE_SIZE' || code === 'LIMIT_FIELD_VALUE';
    return res.status(tooLarge ? 413 : 400).json({ detail: tooLarge ? 'Images can be at most 5 MB' : err.message });
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
