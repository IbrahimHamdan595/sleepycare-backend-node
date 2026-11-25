import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/database';
import { adminToken, api, makeProduct, orderBody, resetDatabase, userToken } from './helpers';

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function placedOrder() {
  const admin = await adminToken();
  const product = await makeProduct(admin, { stock: '10' });
  const shopper = { Authorization: `Bearer ${await userToken()}` };
  const order = await api.post('/orders').set(shopper).send(orderBody([{ product_id: product.id, quantity: 3 }]));
  const setStatus = (status: string) =>
    api.put(`/admin/orders/${order.body.id}`).set('Authorization', `Bearer ${admin}`).send({ status });
  const stock = async () => (await api.get(`/products/${product.id}`)).body.stock;
  return { order: order.body, setStatus, stock };
}

describe('order status', () => {
  it('accepts only the shared status list', async () => {
    const { setStatus } = await placedOrder();
    for (const status of ['processing', 'shipped', 'delivered']) {
      expect((await setStatus(status)).body.status).toBe(status);
    }
    expect((await setStatus('completed')).status).toBe(422);
    expect((await setStatus('lost in space')).status).toBe(422);
  });

  it('puts the stock back when an order is cancelled', async () => {
    const { setStatus, stock } = await placedOrder();
    expect(await stock()).toBe(7);
    const res = await setStatus('cancelled');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expect(await stock()).toBe(10);
  });

  it('puts the stock back only once when cancelled twice at the same moment', async () => {
    const { setStatus, stock } = await placedOrder();
    const results = await Promise.all([setStatus('cancelled'), setStatus('cancelled')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await stock()).toBe(10);
  });

  it('keeps a cancelled order cancelled', async () => {
    const { setStatus, stock } = await placedOrder();
    await setStatus('cancelled');
    const res = await setStatus('processing');
    expect(res.status).toBe(409);
    expect(res.body.detail).toBe("Cancelled orders can't be changed");
    expect(await stock()).toBe(10);
  });
});
