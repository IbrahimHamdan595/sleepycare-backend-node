import { z } from 'zod';
import { MAX_MONEY } from './limits';

export const settingsUpdateSchema = z.object({
  delivery_fee: z.number().finite().min(0).max(MAX_MONEY),
  free_delivery_threshold: z.number().finite().min(0).max(MAX_MONEY),
  tax_rate_percent: z.number().finite().min(0).max(100),
});

export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

export interface SettingsRead {
  delivery_fee: number;
  free_delivery_threshold: number;
  tax_rate_percent: number;
}
