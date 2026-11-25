import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/database';
import { adminToken, api, resetDatabase, userToken } from './helpers';

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('store settings', () => {
  it('starts with the default delivery fee and tax', async () => {
    const res = await api.get('/settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ delivery_fee: 9.99, free_delivery_threshold: 35, tax_rate_percent: 8 });
  });

  it('lets an admin change them', async () => {
    const auth = { Authorization: `Bearer ${await adminToken()}` };
    const saved = await api
      .put('/admin/settings')
      .set(auth)
      .send({ delivery_fee: 3, free_delivery_threshold: 40, tax_rate_percent: 0 });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ delivery_fee: 3, free_delivery_threshold: 40, tax_rate_percent: 0 });
    expect((await api.get('/settings')).body).toEqual(saved.body);
  });

  it('refuses shoppers and impossible values', async () => {
    const shopper = await api
      .put('/admin/settings')
      .set('Authorization', `Bearer ${await userToken()}`)
      .send({ delivery_fee: 0, free_delivery_threshold: 0, tax_rate_percent: 0 });
    expect(shopper.status).toBe(403);

    const auth = { Authorization: `Bearer ${await adminToken()}` };
    for (const body of [
      { delivery_fee: 3, free_delivery_threshold: 40, tax_rate_percent: 120 },
      { delivery_fee: -1, free_delivery_threshold: 40, tax_rate_percent: 5 },
      { delivery_fee: 3, tax_rate_percent: 5 },
    ]) {
      expect((await api.put('/admin/settings').set(auth).send(body)).status).toBe(422);
    }
  });
});
