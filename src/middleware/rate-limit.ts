import { rateLimit } from 'express-rate-limit';
import { config } from '../config';

/**
 * Caps login, sign-up and password-reset attempts per address, so nobody can
 * guess passwords or flood the reset emails. In memory: right for one server
 * process; several processes would need a shared store such as Redis.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.authRateLimitMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { detail: 'Too many attempts. Please wait a few minutes and try again.' },
});
