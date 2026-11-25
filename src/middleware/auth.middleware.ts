import { Request, Response, NextFunction } from 'express';
import { decodeToken } from '../utils/security';
import { prisma } from '../database';

export async function getCurrentUser(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({
      detail: 'Could not validate credentials',
    });
  }

  // Only a bad or expired token means "not logged in" (401). A database error
  // is a server problem (500): answering 401 would make the site log everyone out.
  let userId: string | undefined;
  try {
    userId = decodeToken(authHeader.substring(7), 'access').sub;
  } catch {
    userId = undefined;
  }
  if (!userId) {
    return res.status(401).json({
      detail: 'Could not validate credentials',
    });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(401).json({
        detail: 'Could not validate credentials',
      });
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({
      detail: 'Could not validate credentials',
    });
  }

  if (req.user.role !== 'user') {
    return res.status(403).json({
      detail: 'Insufficient permissions',
    });
  }

  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({
      detail: 'Could not validate credentials',
    });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({
      detail: 'Insufficient permissions',
    });
  }

  next();
}
