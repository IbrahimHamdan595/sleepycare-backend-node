import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/database';
import { SHIPPING, adminToken, api, makeProduct, orderBody, resetDatabase, userToken } from './helpers';

// Checkout: the server sets prices and totals, saves the delivery address,
// and records the cash-on-delivery payment, all in one request.

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function shop() {
  const admin = await adminToken();
  const wipes = await makeProduct(admin, { name: 'Wipes', price: '4.5', stock: '10' });
  const shopper = { Authorization: `Bearer ${await userToken()}` };
  return { admin, wipes, shopper };
}

describe('POST /orders', () => {
  it('charges the product price, whatever price the browser sends', async () => {
    const { wipes, shopper } = await shop();
    const res = await api
      .post('/orders')
      .set(shopper)
      .send({ ...orderBody([]), items: [{ product_id: wipes.id, quantity: 2, unit_price: 0.01 }] });
    expect(res.status).toBe(201);
    expect(res.body.items).toEqual([{ product_id: wipes.id, product_name: 'Wipes', quantity: 2, unit_price: 4.5 }]);
    expect(res.body.subtotal).toBe(9);
  });

  it('calculates delivery, tax and total from the store settings', async () => {
    const { admin, wipes, shopper } = await shop();
    const first = await api.post('/orders').set(shopper).send(orderBody([{ product_id: wipes.id, quantity: 2 }]));
    expect(first.body).toMatchObject({ subtotal: 9, delivery_fee: 9.99, tax: 0.72, total_amount: 19.71 });

    await api
      .put('/admin/settings')
      .set('Authorization', `Bearer ${admin}`)
      .send({ delivery_fee: 3, free_delivery_threshold: 40, tax_rate_percent: 0 });
    const second = await api.post('/orders').set(shopper).send(orderBody([{ product_id: wipes.id, quantity: 2 }]));
    expect(second.body).toMatchObject({ subtotal: 9, delivery_fee: 3, tax: 0, total_amount: 12 });
  });

  it('saves the delivery address and records a pending cash-on-delivery payment', async () => {
    const { wipes, shopper } = await shop();
    const res = await api.post('/orders').set(shopper).send(orderBody([{ product_id: wipes.id, quantity: 1 }]));
    expect(res.body.shipping).toEqual(SHIPPING);
    expect(res.body.payment_method).toBe('cash_on_delivery');

    const payment = await prisma.transaction.findFirstOrThrow({ where: { orderId: res.body.id } });
    expect(payment.paymentMethod).toBe('cash_on_delivery');
    expect(payment.status).toBe('pending');
    expect(payment.amount.toNumber()).toBe(res.body.total_amount);
  });

  it('rejects empty orders, missing addresses and other payment methods', async () => {
    const { wipes, shopper } = await shop();
    const item = [{ product_id: wipes.id, quantity: 1 }];
    const bodies = [
      orderBody([]),
      { items: item, payment_method: 'cash_on_delivery' },
      { ...orderBody(item), shipping: { ...SHIPPING, governorate: 'Paris' } },
      { ...orderBody(item), shipping: { ...SHIPPING, phone: 'call me' } },
      { ...orderBody(item), payment_method: 'credit_card' },
    ];
    for (const body of bodies) {
      expect((await api.post('/orders').set(shopper).send(body)).status).toBe(422);
    }
    expect(await prisma.order.count()).toBe(0);
  });

  it('says an item is no longer sold, with its id so the shop can name it from the cart', async () => {
    const { shopper } = await shop();
    const res = await api.post('/orders').set(shopper).send(orderBody([{ product_id: 'gone-123', quantity: 1 }]));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ detail: 'An item in your cart is no longer sold.', product_id: 'gone-123' });
  });

  it('no longer accepts payments from the browser', async () => {
    const { shopper } = await shop();
    const me = await api.get('/auth/me').set(shopper);
    await prisma.$executeRaw`
      INSERT INTO orders (id, user_id, status, total_amount, created_at)
      VALUES ('own-order', ${me.body.id}, 'pending', 5, now())`;
    const res = await api
      .post('/transactions')
      .set(shopper)
      .send({ order_id: 'own-order', amount: 0.01, payment_method: 'credit_card', status: 'completed' });
    expect(res.status).toBe(404);
    expect(await prisma.transaction.count()).toBe(0);
  });
});

describe('orders made before this change', () => {
  it('still list, with no address and the old total', async () => {
    const { shopper } = await shop();
    const me = await api.get('/auth/me').set(shopper);
    await prisma.$executeRaw`
      INSERT INTO orders (id, user_id, status, total_amount, created_at)
      VALUES ('legacy-1', ${me.body.id}, 'pending', 12.5, now())`;

    const res = await api.get('/orders').set(shopper);
    expect(res.body[0]).toMatchObject({
      id: 'legacy-1',
      subtotal: 12.5,
      delivery_fee: 0,
      tax: 0,
      total_amount: 12.5,
      payment_method: 'cash_on_delivery',
      shipping: null,
    });
  });
});

describe('admin orders', () => {
  it('show who placed the order', async () => {
    const { admin, wipes, shopper } = await shop();
    await api.post('/orders').set(shopper).send(orderBody([{ product_id: wipes.id, quantity: 1 }]));
    const res = await api.get('/admin/orders').set('Authorization', `Bearer ${admin}`);
    expect(res.body[0].customer).toEqual({ name: 'Shopper', email: 'shopper@test.dev' });
    expect(res.body[0].shipping.phone).toBe(SHIPPING.phone);
  });
});
