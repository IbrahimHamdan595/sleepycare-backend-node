import { z } from 'zod';
import { MAX_QUANTITY } from './limits';

export const cartItemCreateSchema = z.object({
  product_id: z.string(),
  quantity: z.number().int().min(1).max(MAX_QUANTITY).default(1),
});

export const cartItemUpdateSchema = z.object({
  quantity: z.number().int().min(1).max(MAX_QUANTITY).default(1),
});

export type CartItemCreate = z.infer<typeof cartItemCreateSchema>;
export type CartItemUpdate = z.infer<typeof cartItemUpdateSchema>;

export interface CartItemRead {
  id: string;
  user_id: string;
  product_id: string;
  quantity: number;
}
