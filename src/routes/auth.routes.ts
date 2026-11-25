import { Router, Request, Response } from 'express';
import { validate } from '../middleware/validate.middleware';
import { getCurrentUser } from '../middleware/auth.middleware';
import { authLimiter } from '../middleware/rate-limit';
import {
  userCreateSchema,
  loginFormSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../schemas/user.schema';
import {
  registerUser,
  authenticateUser,
  generateTokensForUser,
  createPasswordReset,
  resetPassword,
} from '../services/auth.service';
import { toUserRead } from '../utils/mappers';

const router = Router();

// POST /auth/register
router.post('/register', authLimiter, validate(userCreateSchema), async (req: Request, res: Response) => {
  try {
    const user = await registerUser(req.body);
    const tokens = generateTokensForUser(user);
    return res.status(200).json(tokens);
  } catch (error: any) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ detail: error.detail });
    }
    console.error('Register error:', error);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

// POST /auth/login (expects form data with username and password)
router.post('/login', authLimiter, validate(loginFormSchema), async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body; // username is actually email
    const user = await authenticateUser(username, password);
    const tokens = generateTokensForUser(user);
    return res.status(200).json(tokens);
  } catch (error: any) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ detail: error.detail });
    }
    console.error('Login error:', error);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

// POST /auth/forgot-password
router.post(
  '/forgot-password',
  authLimiter,
  validate(forgotPasswordSchema),
  async (req: Request, res: Response) => {
    try {
      await createPasswordReset(req.body.email);
      return res.status(204).send();
    } catch (error: any) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ detail: error.detail });
      }
      console.error('Forgot password error:', error);
      return res.status(500).json({ detail: 'Internal server error' });
    }
  }
);

// POST /auth/reset-password
router.post(
  '/reset-password',
  authLimiter,
  validate(resetPasswordSchema),
  async (req: Request, res: Response) => {
    try {
      await resetPassword(req.body.token, req.body.new_password);
      return res.status(204).send();
    } catch (error: any) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ detail: error.detail });
      }
      console.error('Reset password error:', error);
      return res.status(500).json({ detail: 'Internal server error' });
    }
  }
);

// GET /auth/me
router.get('/me', getCurrentUser, async (req: Request, res: Response) => {
  return res.status(200).json(toUserRead(req.user!));
});

export default router;
