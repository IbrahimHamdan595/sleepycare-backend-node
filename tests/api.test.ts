import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/database';
import { getPasswordHash } from '../src/utils/security';
import { orderBody, resetDatabase } from './helpers';

// End-to-end checks of the API against a real Postgres (TEST_DATABASE_URL).
// They pin the JSON shapes the frontend relies on, so the move from MongoDB
// to Postgres doesn't change what the site receives.

const api = request(app);

async function adminToken(): Promise<string> {
  await prisma.user.create({
    data: {
      name: 'Admin',
      email: 'admin@test.dev',
      passwordHash: await getPasswordHash('admin-pass'),
      role: 'admin',
    },
  });
  const res = await api
    .post('/auth/login')
    .type('form')
    .send({ username: 'admin@test.dev', password: 'admin-pass' });
  return res.body.access_token;
}

async function userToken(email = 'shopper@test.dev'): Promise<string> {
  const res = await api.post('/auth/register').send({ name: 'Shopper', email, password: 'secret1' });
  return res.body.access_token;
}

async function makeProduct(admin: string, fields: Record<string, string> = {}) {
  const req = api.post('/admin/products').set('Authorization', `Bearer ${admin}`);
  const data = { name: 'Baby Wipes', price: '4.5', stock: '10', description: 'Soft', ...fields };
  for (const [key, value] of Object.entries(data)) req.field(key, value);
  const res = await req;
  expect(res.status).toBe(201);
  return res.body;
}

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('health', () => {
  it('responds on /', async () => {
    const res = await api.get('/');
    expect(res.body).toEqual({ status: 'ok', service: 'sleepy-care' });
  });
});

describe('auth', () => {
  it('registers, logs in and returns the current user', async () => {
    const reg = await api
      .post('/auth/register')
      .send({ name: 'Rana', email: 'Rana@Test.dev', password: 'secret1' });
    expect(reg.status).toBe(200);
    expect(reg.body).toMatchObject({ token_type: 'bearer' });
    expect(reg.body.access_token).toBeTruthy();
    expect(reg.body.refresh_token).toBeTruthy();

    const login = await api
      .post('/auth/login')
      .type('form')
      .send({ username: 'rana@test.dev', password: 'secret1' });
    expect(login.status).toBe(200);

    const me = await api.get('/auth/me').set('Authorization', `Bearer ${login.body.access_token}`);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      name: 'Rana',
      email: 'rana@test.dev',
      role: 'user',
      provider: 'local',
    });
    expect(typeof me.body.id).toBe('string');
    expect(new Date(me.body.created_at).toISOString()).toBe(me.body.created_at);
  });

  it('rejects a duplicate email and a wrong password', async () => {
    await userToken('dup@test.dev');
    const dup = await api
      .post('/auth/register')
      .send({ name: 'X', email: 'DUP@test.dev', password: 'secret1' });
    expect(dup.status).toBe(400);
    expect(dup.body.detail).toBe('Email already registered');

    const bad = await api
      .post('/auth/login')
      .type('form')
      .send({ username: 'dup@test.dev', password: 'wrong-pass' });
    expect(bad.status).toBe(400);
  });

  it('protects routes by token and role', async () => {
    expect((await api.get('/auth/me')).status).toBe(401);
    expect((await api.get('/cart')).status).toBe(401);

    const user = await userToken();
    const res = await api.get('/admin/users').set('Authorization', `Bearer ${user}`);
    expect(res.status).toBe(403);

    const admin = await adminToken();
    const cart = await api.get('/cart').set('Authorization', `Bearer ${admin}`);
    expect(cart.status).toBe(403);
  });

  it('resets a password once per token', async () => {
    await userToken('forgot@test.dev');
    const forgot = await api.post('/auth/forgot-password').send({ email: 'forgot@test.dev' });
    expect(forgot.status).toBe(204);

    const { token } = await prisma.passwordResetToken.findFirstOrThrow();
    const reset = await api.post('/auth/reset-password').send({ token, new_password: 'newpass1' });
    expect(reset.status).toBe(204);

    const again = await api.post('/auth/reset-password').send({ token, new_password: 'other11' });
    expect(again.status).toBe(400);

    const login = await api
      .post('/auth/login')
      .type('form')
      .send({ username: 'forgot@test.dev', password: 'newpass1' });
    expect(login.status).toBe(200);
  });

  it('does not reveal whether an email is registered', async () => {
    const res = await api.post('/auth/forgot-password').send({ email: 'nobody@test.dev' });
    expect(res.status).toBe(204);
    expect(await prisma.passwordResetToken.count()).toBe(0);
  });
});

describe('catalogue and admin', () => {
  it('creates, updates and deletes categories', async () => {
    const admin = await adminToken();
    const auth = { Authorization: `Bearer ${admin}` };

    const created = await api.post('/admin/categories').set(auth).field('name', 'Wipes');
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      id: expect.any(String),
      name: 'Wipes',
      description: null,
      icon: null,
    });

    const dup = await api.post('/admin/categories').set(auth).field('name', 'Wipes');
    expect(dup.status).toBe(400);

    const updated = await api
      .put(`/admin/categories/${created.body.id}`)
      .set(auth)
      .field('description', 'All wipes');
    expect(updated.body.description).toBe('All wipes');

    const list = await api.get('/categories');
    expect(list.body).toHaveLength(1);

    // Deleting a category leaves its products uncategorised.
    const product = await makeProduct(admin, { category_id: created.body.id });
    expect((await api.delete(`/admin/categories/${created.body.id}`).set(auth)).status).toBe(204);
    const after = await api.get(`/products/${product.id}`);
    expect(after.body.category_id).toBeNull();
  });

  it('creates and updates products with numeric prices', async () => {
    const admin = await adminToken();
    const auth = { Authorization: `Bearer ${admin}` };
    const category = (await api.post('/admin/categories').set(auth).field('name', 'Baby')).body;

    const product = await makeProduct(admin, {
      category_id: category.id,
      image_url: 'https://cdn.test/wipes.png',
    });
    expect(product).toEqual({
      id: expect.any(String),
      name: 'Baby Wipes',
      description: 'Soft',
      price: 4.5,
      stock: 10,
      image_url: 'https://cdn.test/wipes.png',
      category_id: category.id,
    });

    const bad = await api
      .post('/admin/products')
      .set(auth)
      .field('name', 'Other')
      .field('price', '1')
      .field('stock', '1')
      .field('category_id', 'missing-category');
    expect(bad.status).toBe(400);

    const dupName = await api
      .post('/admin/products')
      .set(auth)
      .field('name', 'Baby Wipes')
      .field('price', '1')
      .field('stock', '1');
    expect(dupName.status).toBe(400);

    const updated = await api
      .put(`/admin/products/${product.id}`)
      .set(auth)
      .field('price', '5.25')
      .field('stock', '7')
      .field('name', 'Baby Wipes XL');
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: 'Baby Wipes XL', price: 5.25, stock: 7 });

    expect((await api.get(`/products/category/${category.id}`)).body).toHaveLength(1);
    expect((await api.get('/products/does-not-exist')).status).toBe(404);
    expect((await api.get('/admin/products').set(auth)).body).toHaveLength(1);

    expect((await api.delete(`/admin/products/${product.id}`).set(auth)).status).toBe(204);
    expect((await api.get('/products')).body).toHaveLength(0);
  });

  it('manages partners', async () => {
    const admin = await adminToken();
    const auth = { Authorization: `Bearer ${admin}` };

    const created = await api.post('/admin/partners').set(auth).send({ name: 'Pharma', icon: '💊' });
    expect(created.status).toBe(201);

    const updated = await api
      .put(`/admin/partners/${created.body.id}`)
      .set(auth)
      .send({ name: 'Pharma One' });
    expect(updated.body).toMatchObject({ name: 'Pharma One', icon: '💊' });
    expect(updated.body.updated_at >= created.body.updated_at).toBe(true);

    expect((await api.get('/partners')).body).toHaveLength(1);
    expect((await api.get(`/partners/${created.body.id}`)).status).toBe(200);
    expect((await api.delete(`/admin/partners/${created.body.id}`).set(auth)).status).toBe(204);
    expect((await api.get(`/partners/${created.body.id}`)).status).toBe(404);
  });
});

describe('cart', () => {
  it('adds, merges, updates and removes items for the owner only', async () => {
    const admin = await adminToken();
    const product = await makeProduct(admin);
    const user = await userToken();
    const auth = { Authorization: `Bearer ${user}` };

    const first = await api.post('/cart').set(auth).send({ product_id: product.id, quantity: 2 });
    expect(first.status).toBe(201);
    const second = await api.post('/cart').set(auth).send({ product_id: product.id, quantity: 3 });
    expect(second.body).toMatchObject({ id: first.body.id, quantity: 5, product_id: product.id });

    const cart = await api.get('/cart').set(auth);
    expect(cart.body).toHaveLength(1);

    const other = await userToken('other@test.dev');
    const steal = await api
      .put(`/cart/${first.body.id}`)
      .set('Authorization', `Bearer ${other}`)
      .send({ quantity: 1 });
    expect(steal.status).toBe(404);

    const updated = await api.put(`/cart/${first.body.id}`).set(auth).send({ quantity: 1 });
    expect(updated.body.quantity).toBe(1);

    // A double-click on delete: one succeeds, the other finds nothing.
    const deletes = await Promise.all([
      api.delete(`/cart/${first.body.id}`).set(auth),
      api.delete(`/cart/${first.body.id}`).set(auth),
    ]);
    expect(deletes.map((r) => r.status).sort()).toEqual([204, 404]);
    expect((await api.get('/cart').set(auth)).body).toHaveLength(0);

    const missing = await api.post('/cart').set(auth).send({ product_id: 'nope', quantity: 1 });
    expect(missing.status).toBe(404);
  });
});

describe('orders', () => {
  it('creates an order, takes stock and records the cash-on-delivery payment', async () => {
    const admin = await adminToken();
    const wipes = await makeProduct(admin, { name: 'Wipes', price: '4.5', stock: '10' });
    const cream = await makeProduct(admin, { name: 'Cream', price: '0.1', stock: '5' });
    const user = await userToken();
    const auth = { Authorization: `Bearer ${user}` };

    const order = await api
      .post('/orders')
      .set(auth)
      .send(orderBody([
        { product_id: wipes.id, quantity: 2 },
        { product_id: cream.id, quantity: 3 },
      ]));
    expect(order.status).toBe(201);
    // 9.30 of items, 9.99 delivery (under 35) and 8% tax (0.74).
    expect(order.body).toMatchObject({ status: 'pending', subtotal: 9.3, delivery_fee: 9.99, tax: 0.74, total_amount: 20.03 });
    expect(order.body.items).toEqual(
      expect.arrayContaining([
        { product_id: wipes.id, product_name: 'Wipes', quantity: 2, unit_price: 4.5 },
        { product_id: cream.id, product_name: 'Cream', quantity: 3, unit_price: 0.1 },
      ])
    );
    expect((await api.get(`/products/${wipes.id}`)).body.stock).toBe(8);
    expect(await prisma.transaction.count({ where: { orderId: order.body.id } })).toBe(1);
    expect((await api.get('/orders').set(auth)).body).toHaveLength(1);

    // Admin views and updates orders; per-user counts work.
    const adminAuth = { Authorization: `Bearer ${admin}` };
    expect((await api.get('/admin/orders').set(adminAuth)).body).toHaveLength(1);
    const shipped = await api
      .put(`/admin/orders/${order.body.id}`)
      .set(adminAuth)
      .send({ status: 'shipped' });
    expect(shipped.body.status).toBe('shipped');
    const count = await api.get(`/admin/users/${order.body.user_id}/orders-count`).set(adminAuth);
    expect(count.body).toEqual({ user_id: order.body.user_id, orders_count: 1 });
    expect((await api.get('/admin/users').set(adminAuth)).body).toHaveLength(2);
  });

  it('takes no stock at all when one item is short', async () => {
    const admin = await adminToken();
    const plenty = await makeProduct(admin, { name: 'Plenty', stock: '10' });
    const scarce = await makeProduct(admin, { name: 'Scarce', stock: '1' });
    const auth = { Authorization: `Bearer ${await userToken()}` };

    const res = await api
      .post('/orders')
      .set(auth)
      .send(orderBody([
        { product_id: plenty.id, quantity: 4 },
        { product_id: scarce.id, quantity: 2 },
      ]));
    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('Insufficient stock for Scarce');
    expect((await api.get(`/products/${plenty.id}`)).body.stock).toBe(10);
    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.transaction.count()).toBe(0);
  });

  it('never sells more than the stock when orders arrive together', async () => {
    const admin = await adminToken();
    const product = await makeProduct(admin, { name: 'Last ones', stock: '3' });
    const buyers = await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((n) => userToken(`${n}@test.dev`))
    );

    const results = await Promise.all(
      buyers.map((token) =>
        api
          .post('/orders')
          .set('Authorization', `Bearer ${token}`)
          .send(orderBody([{ product_id: product.id, quantity: 1 }]))
      )
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect((await api.get(`/products/${product.id}`)).body.stock).toBe(0);
  });

  it('handles orders listing the same products in opposite order at once', async () => {
    const admin = await adminToken();
    const p1 = await makeProduct(admin, { name: 'P1', stock: '100' });
    const p2 = await makeProduct(admin, { name: 'P2', stock: '100' });
    const buyers = await Promise.all(
      Array.from({ length: 8 }, (_, i) => userToken(`buyer${i}@test.dev`))
    );

    const results = await Promise.all(
      buyers.map((token, i) => {
        const pair = [
          { product_id: p1.id, quantity: 1 },
          { product_id: p2.id, quantity: 1 },
        ];
        return api
          .post('/orders')
          .set('Authorization', `Bearer ${token}`)
          .send(orderBody(i % 2 ? pair : pair.reverse()));
      })
    );

    expect(results.map((r) => r.status)).toEqual(Array(8).fill(201));
    expect((await api.get(`/products/${p1.id}`)).body.stock).toBe(92);
    expect((await api.get(`/products/${p2.id}`)).body.stock).toBe(92);
  });

  it('checks stock against the total of repeated lines for one product', async () => {
    const admin = await adminToken();
    const product = await makeProduct(admin, { stock: '3' });
    const auth = { Authorization: `Bearer ${await userToken()}` };

    const res = await api
      .post('/orders')
      .set(auth)
      .send(orderBody([
        { product_id: product.id, quantity: 2 },
        { product_id: product.id, quantity: 2 },
      ]));
    expect(res.status).toBe(400);
    expect((await api.get(`/products/${product.id}`)).body.stock).toBe(3);
  });

  it('rejects oversized numbers with 422 instead of a database error', async () => {
    const admin = await adminToken();
    const product = await makeProduct(admin);
    const auth = { Authorization: `Bearer ${await userToken()}` };

    const qty = await api
      .post('/orders')
      .set(auth)
      .send(orderBody([{ product_id: product.id, quantity: 3_000_000_000 }]));
    expect(qty.status).toBe(422);

    const cart = await api.post('/cart').set(auth).send({ product_id: product.id, quantity: 3e9 });
    expect(cart.status).toBe(422);
  });

  it('keeps past orders when a product is deleted', async () => {
    const admin = await adminToken();
    const product = await makeProduct(admin);
    const auth = { Authorization: `Bearer ${await userToken()}` };
    await api
      .post('/orders')
      .set(auth)
      .send(orderBody([{ product_id: product.id, quantity: 1 }]));

    const del = await api.delete(`/admin/products/${product.id}`).set('Authorization', `Bearer ${admin}`);
    expect(del.status).toBe(204);
    const orders = await api.get('/orders').set(auth);
    expect(orders.body[0].items[0]).toMatchObject({ product_id: product.id, product_name: 'Baby Wipes' });
  });
});
