import { z } from 'zod';
import { MAX_MONEY, MAX_QUANTITY } from './limits';

export const orderItemInSchema = z.object({
  product_id: z.string(),
  quantity: z.number().int().min(1).max(MAX_QUANTITY),
  unit_price: z.number().finite().min(0).max(MAX_MONEY),
});

export const orderCreateSchema = z.object({
  items: z.array(orderItemInSchema).max(100),
});

export const orderUpdateStatusSchema = z.object({
  status: z.string(),
});

export type OrderItemIn = z.infer<typeof orderItemInSchema>;
export type OrderCreate = z.infer<typeof orderCreateSchema>;
export type OrderUpdateStatus = z.infer<typeof orderUpdateStatusSchema>;

export interface OrderItemOut {
  product_id: string;
  quantity: number;
  unit_price: number;
}

export interface OrderRead {
  id: string;
  user_id: string;
  status: string;
  total_amount: number;
  created_at: string;
  items: OrderItemOut[];
}
