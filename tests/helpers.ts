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

/** Registers a shopper and returns their access token. */
export async function userToken(email = 'shopper@test.dev'): Promise<string> {
  const res = await api.post('/auth/register').send({ name: 'Shopper', email, password: 'secret1' });
  return res.body.access_token;
}
