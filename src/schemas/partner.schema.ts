import { z } from 'zod';

// The icon is an uploaded logo's URL, or text the admin typed: an emoji or an https link.
export const partnerCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  icon: z.string({ required_error: 'An icon or logo is required' }).min(1),
});

export const partnerUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  icon: z.string().min(1).optional(),
});

export type PartnerCreate = z.infer<typeof partnerCreateSchema>;
export type PartnerUpdate = z.infer<typeof partnerUpdateSchema>;

export interface PartnerRead {
  id: string;
  name: string;
  icon: string;
  created_at: string;
  updated_at: string;
}
