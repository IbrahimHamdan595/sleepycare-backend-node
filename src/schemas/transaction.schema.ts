import { z } from 'zod';
import { MAX_MONEY } from './limits';

export const transactionCreateSchema = z.object({
  order_id: z.string(),
  amount: z.number().finite().min(0).max(MAX_MONEY),
  payment_method: z.string(),
  status: z.string(),
});

export type TransactionCreate = z.infer<typeof transactionCreateSchema>;

export interface TransactionRead {
  id: string;
  order_id: string;
  user_id: string;
  amount: number;
  payment_method: string;
  status: string;
  created_at: string;
}
