import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/database';
import { getPasswordHash } from '../src/utils/security';

export const api = request(app);

/** Empties every table in the test database. */
export async function resetDatabase() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
}

/** Creates the admin account and returns a fresh access token for it. */
export async function adminToken(): Promise<string> {
  await prisma.user.create({
    data: {
      name: 'Admin',
      email: 'admin@test.dev',
      passwordHash: await getPasswordHash('admin-pass'),
      role: 'admin',
    },
  });
  const res = await api.post('/auth/login').type('form').send({ username: 'admin@test.dev', password: 'admin-pass' });
  return res.body.access_token;
}

/** Creates a product through the admin API and returns it. */
export async function makeProduct(admin: string, fields: Record<string, string> = {}) {
  const req = api.post('/admin/products').set('Authorization', `Bearer ${admin}`);
  const data = { name: 'Baby Wipes', price: '4.5', stock: '10', description: 'Soft', ...fields };
  for (const [key, value] of Object.entries(data)) req.field(key, value);
  const res = await req;
  if (res.status !== 201) throw new Error(`makeProduct failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export const SHIPPING = {
  full_name: 'Rana Test',
  phone: '+961 70 123 456',
  address: 'Hamra Street 12',
  city: 'Beirut',
  governorate: 'Beirut',
  notes: 'Building B, 3rd floor, next to the pharmacy',
};

/** A valid cash-on-delivery order body for these items. */
export function orderBody(items: { product_id: string; quantity: number }[]) {
  return { items, shipping: SHIPPING, payment_method: 'cash_on_delivery' };
}

/** Registers a shopper and returns their access token. */
export async function userToken(email = 'shopper@test.dev'): Promise<string> {
  const res = await api.post('/auth/register').send({ name: 'Shopper', email, password: 'secret1' });
  return res.body.access_token;
}
