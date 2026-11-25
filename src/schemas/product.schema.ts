import { z } from 'zod';
import { MAX_MONEY } from './limits';

// Admin product forms arrive as multipart text: numbers are coerced, and an
// empty field counts as "not sent" (so an empty price is refused on create
// and leaves the price unchanged on update).
const blankToUndefined = (value: unknown) => (value === '' ? undefined : value);
const price = z.preprocess(blankToUndefined, z.coerce.number().finite().min(0).max(MAX_MONEY));
const stock = z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(1_000_000));
// An image link typed by an admin: an https address or a path on the shop's own site.
const imageUrl = z.preprocess(blankToUndefined, z.string().max(2000).regex(/^(https:\/\/|\/)/, 'Use an https:// link'));

const productFields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000),
  category_id: z.string(),
  image_url: imageUrl,
  image_base64: z.string(),
};

export const productCreateSchema = z.object({
  ...productFields,
  description: productFields.description.optional(),
  category_id: productFields.category_id.optional(),
  image_url: productFields.image_url.optional(),
  image_base64: productFields.image_base64.optional(),
  price,
  stock,
});

export const productUpdateSchema = z.object({
  name: z.preprocess(blankToUndefined, productFields.name.optional()),
  description: productFields.description.optional(),
  category_id: productFields.category_id.optional(),
  image_url: productFields.image_url.optional(),
  image_base64: productFields.image_base64.optional(),
  price: price.optional(),
  stock: stock.optional(),
});

export type ProductCreate = z.infer<typeof productCreateSchema>;
export type ProductUpdate = z.infer<typeof productUpdateSchema>;

export interface ProductRead {
  id: string;
  name: string;
  description: string | null;
  price: number;
  stock: number;
  image_url: string | null;
  category_id: string | null;
}
