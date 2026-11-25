import { z } from 'zod';
import { GOVERNORATES, PAYMENT_METHOD } from '../constants';
import { MAX_QUANTITY } from './limits';

// Prices are never taken from the browser: an old client's `unit_price`
// is simply dropped by zod, and the server uses the product's own price.
export const orderItemInSchema = z.object({
  product_id: z.string().min(1),
  quantity: z.number().int().min(1).max(MAX_QUANTITY),
});

export const shippingSchema = z.object({
  full_name: z.string().trim().min(1).max(100),
  phone: z
    .string()
    .trim()
    .min(6)
    .max(30)
    .regex(/^\+?[\d\s-]+$/, 'Use digits, spaces, + or -'),
  address: z.string().trim().min(1).max(200),
  city: z.string().trim().min(1).max(100),
  governorate: z.enum(GOVERNORATES),
  notes: z.string().trim().max(300).nullish(),
});

export const orderCreateSchema = z.object({
  items: z.array(orderItemInSchema).min(1).max(100),
  shipping: shippingSchema,
  payment_method: z.literal(PAYMENT_METHOD),
});

export const orderUpdateStatusSchema = z.object({
  status: z.string(),
});

export type OrderItemIn = z.infer<typeof orderItemInSchema>;
export type ShippingIn = z.infer<typeof shippingSchema>;
export type OrderCreate = z.infer<typeof orderCreateSchema>;
export type OrderUpdateStatus = z.infer<typeof orderUpdateStatusSchema>;

export interface OrderItemOut {
  product_id: string;
  product_name: string | null;
  quantity: number;
  unit_price: number;
}

export interface ShippingOut {
  full_name: string;
  phone: string;
  address: string;
  city: string;
  governorate: string;
  notes: string | null;
}

export interface OrderRead {
  id: string;
  user_id: string;
  status: string;
  subtotal: number;
  delivery_fee: number;
  tax: number;
  total_amount: number;
  payment_method: string;
  shipping: ShippingOut | null;
  created_at: string;
  items: OrderItemOut[];
  /** Only in admin responses. */
  customer?: { name: string; email: string };
}
