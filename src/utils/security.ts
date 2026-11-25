import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config';

// Async versions: the sync ones block every other request for ~100 ms each.
export function getPasswordHash(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

interface TokenPayload {
  sub: string;
  role: string;
  type: 'access';
  exp?: number;
}

function createToken(data: Omit<TokenPayload, 'exp'>, expiresInMinutes: number): string {
  return jwt.sign(data, config.jwtSecret, {
    expiresIn: `${expiresInMinutes}m`,
  });
}

export function createAccessToken(subject: string, role: string): string {
  return createToken(
    { sub: subject, role, type: 'access' },
    config.accessTokenExpiresMinutes
  );
}

export function decodeToken(token: string, verifyType?: 'access'): TokenPayload {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as TokenPayload;
    if (verifyType && payload.type !== verifyType) {
      throw new Error('Invalid token type');
    }
    return payload;
  } catch (error) {
    throw error;
  }
}
