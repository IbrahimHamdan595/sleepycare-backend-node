import { z } from 'zod';

export const userCreateSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
});

// POST /auth/login is an OAuth2-style form: the email arrives as `username`.
export const loginFormSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string(),
  new_password: z.string().min(6),
});

export type UserCreate = z.infer<typeof userCreateSchema>;
export type ForgotPassword = z.infer<typeof forgotPasswordSchema>;
export type ResetPassword = z.infer<typeof resetPasswordSchema>;

export interface UserRead {
  id: string;
  name: string;
  email: string;
  role: string;
  provider: string;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
}
