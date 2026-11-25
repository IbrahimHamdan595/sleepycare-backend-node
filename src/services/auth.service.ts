import crypto from 'crypto';
import axios from 'axios';
import { User } from '@prisma/client';
import { prisma, isUniqueViolation } from '../database';
import {
  getPasswordHash,
  verifyPassword,
  createAccessToken,
  createRefreshToken,
} from '../utils/security';
import { HttpException } from '../middleware/error.middleware';
import { UserCreate, TokenResponse } from '../schemas/user.schema';
import { config } from '../config';

export async function registerUser(data: UserCreate): Promise<User> {
  const email = data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new HttpException(400, 'Email already registered');
  }

  try {
    return await prisma.user.create({
      data: {
        name: data.name,
        email,
        passwordHash: getPasswordHash(data.password),
        role: 'user',
        provider: 'local',
      },
    });
  } catch (error) {
    // Two sign-ups with the same email at the same moment.
    if (isUniqueViolation(error)) {
      throw new HttpException(400, 'Email already registered');
    }
    throw error;
  }
}

export async function authenticateUser(email: string, password: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !user.passwordHash) {
    throw new HttpException(400, 'Invalid credentials');
  }

  if (!verifyPassword(password, user.passwordHash)) {
    throw new HttpException(400, 'Invalid credentials');
  }

  return user;
}

export function generateTokensForUser(user: User): TokenResponse {
  const accessToken = createAccessToken(user.id, user.role);
  const refreshToken = createRefreshToken(user.id, user.role);
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'bearer',
  };
}

export async function createPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) {
    // Silently return to prevent email enumeration
    return;
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await prisma.passwordResetToken.create({
    data: { userId: user.id, token, expiresAt },
  });

  // Build reset link
  const frontendUrl = config.frontendUrl || 'https://sleepycare.com';
  const resetLink = `${frontendUrl}/reset-password?token=${token}`;

  // Send email via frontend API
  try {
    await axios.post(
      `${frontendUrl}/api/auth/forgot-password`,
      {
        email: user.email,
        resetToken: token,
        resetLink,
        userName: user.name,
      },
      { timeout: 30000 }
    );
  } catch (error) {
    // Log error but don't fail the request - token is still created
    console.error(`Failed to send password reset email to ${user.email}:`, error);
  }
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const resetDoc = await prisma.passwordResetToken.findUnique({ where: { token } });
  if (!resetDoc) {
    throw new HttpException(400, 'Invalid token');
  }

  if (resetDoc.used || resetDoc.expiresAt < new Date()) {
    throw new HttpException(400, 'Expired token');
  }

  // Hash first: bcrypt is slow and shouldn't run while the transaction is open.
  const passwordHash = getPasswordHash(newPassword);

  // Mark the token used only if it is still unused, so two requests with the
  // same token cannot both succeed; the password changes in the same transaction.
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: resetDoc.id, used: false },
      data: { used: true },
    });
    if (claimed.count === 0) {
      throw new HttpException(400, 'Expired token');
    }

    await tx.user.update({
      where: { id: resetDoc.userId },
      data: { passwordHash },
    });
  });
}

// OAuth functions (disabled but kept for future use)
export async function loginWithGoogle(idToken: string): Promise<User> {
  throw new HttpException(501, 'Google OAuth is not implemented');
}

export async function loginWithApple(idToken: string): Promise<User> {
  throw new HttpException(501, 'Apple OAuth is not implemented');
}
