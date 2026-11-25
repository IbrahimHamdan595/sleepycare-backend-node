import request from 'supertest';
import { ObjectId } from 'mongodb';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/database';
import { createAccessToken, getPasswordHash } from '../src/utils/security';
import { MongoCollections, transformMongoData, writeImportPlan } from '../prisma/mongo-import';
import { resetDatabase } from './helpers';

// The one-off copy of the live MongoDB data into Postgres.
// Documents below have the shapes the FastAPI and Mongoose backends wrote.

const empty = (): MongoCollections => ({
  users: [],
  categories: [],
  products: [],
  carts: [],
  orders: [],
  transactions: [],
  partners: [],
});

function shop() {
  const user = { _id: new ObjectId(), name: 'Rana', email: 'Rana@Test.dev', password_hash: getPasswordHash('secret1'), role: 'user', provider: 'local', created_at: new Date('2025-12-01T10:00:00Z') };
  const category = { _id: new ObjectId(), name: 'Wipes', description: null, icon: null };
  const product = { _id: new ObjectId(), name: 'Baby Wipes', description: 'Soft', price: 4.5, stock: 10, image_url: null, category_id: category._id };
  const order = {
    _id: new ObjectId(),
    user_id: user._id,
    status: 'pending',
    total_amount: 9,
    created_at: new Date('2025-12-02T10:00:00Z'),
    items: [{ product_id: product._id, quantity: 2, unit_price: 4.5 }],
  };
  const data: MongoCollections = {
    ...empty(),
    users: [user],
    categories: [category],
    products: [product],
    carts: [{ _id: new ObjectId(), user_id: user._id, product_id: product._id, quantity: 1 }],
    orders: [order],
    transactions: [{ _id: new ObjectId(), order_id: order._id, user_id: user._id, amount: 9, payment_method: 'cash_on_delivery', status: 'pending', created_at: new Date('2025-12-02T10:00:01Z') }],
    partners: [{ _id: new ObjectId(), name: 'Pharma', icon: '💊', created_at: new Date('2025-11-01T00:00:00Z'), updated_at: new Date('2025-11-02T00:00:00Z') }],
  };
  return { data, user, category, product, order };
}

describe('transformMongoData', () => {
  it('keeps the MongoDB ids as text so links between records survive', () => {
    const { data, user, category, product, order } = shop();
    const plan = transformMongoData(data);

    expect(plan.users[0].id).toBe(user._id.toHexString());
    expect(plan.products[0]).toMatchObject({ id: product._id.toHexString(), categoryId: category._id.toHexString() });
    expect(plan.orders[0]).toMatchObject({ id: order._id.toHexString(), userId: user._id.toHexString() });
    expect(plan.orderItems[0]).toMatchObject({ orderId: order._id.toHexString(), productId: product._id.toHexString(), quantity: 2, unitPrice: 4.5 });
    expect(plan.transactions[0]).toMatchObject({ orderId: order._id.toHexString(), paymentMethod: 'cash_on_delivery' });
    expect(plan.cartItems).toHaveLength(1);
    expect(plan.partners[0].updatedAt).toEqual(new Date('2025-11-02T00:00:00Z'));
    expect(plan.notes).toEqual([]);
  });

  it('stores emails in lowercase', () => {
    const plan = transformMongoData(shop().data);
    expect(plan.users[0].email).toBe('rana@test.dev');
  });

  it('refuses two accounts whose emails differ only by case', () => {
    const data = shop().data;
    data.users.push({ _id: new ObjectId(), name: 'Copy', email: 'rana@test.DEV', password_hash: 'x', role: 'user' });
    expect(() => transformMongoData(data)).toThrow(/rana@test\.dev/);
  });

  it('refuses duplicate product or category names, naming them', () => {
    const data = shop().data;
    data.products.push({ _id: new ObjectId(), name: 'Baby Wipes', price: 1, stock: 1 });
    data.categories.push({ _id: new ObjectId(), name: 'Wipes' });
    expect(() => transformMongoData(data)).toThrow(/Baby Wipes[\s\S]*Wipes|Wipes[\s\S]*Baby Wipes/);
  });

  it('dates records without created_at from their ObjectId, keeping list order', () => {
    const data = empty();
    const older = ObjectId.createFromTime(1_700_000_000);
    const newer = ObjectId.createFromTime(1_700_000_100);
    data.categories = [
      { _id: newer, name: 'B' },
      { _id: older, name: 'A' },
    ];
    const plan = transformMongoData(data);
    expect(plan.categories.map((c) => c.createdAt)).toEqual([
      new Date(1_700_000_100_000),
      new Date(1_700_000_000_000),
    ]);
  });

  it('drops records that point at missing data and says why', () => {
    const { data, user, product } = shop();
    const ghost = new ObjectId();
    data.carts.push({ _id: new ObjectId(), user_id: user._id, product_id: ghost, quantity: 1 });
    data.products.push({ _id: new ObjectId(), name: 'Orphan', price: 1, stock: 1, category_id: ghost });
    const lostOrder = { _id: new ObjectId(), user_id: ghost, items: [{ product_id: product._id, quantity: 1, unit_price: 4.5 }] };
    data.orders.push(lostOrder);
    data.transactions.push({ _id: new ObjectId(), order_id: lostOrder._id, user_id: ghost, amount: 4.5, payment_method: 'cash', status: 'pending' });

    const plan = transformMongoData(data);

    expect(plan.cartItems).toHaveLength(1);
    expect(plan.products.find((p) => p.name === 'Orphan')!.categoryId).toBeNull();
    expect(plan.orders).toHaveLength(1);
    expect(plan.transactions).toHaveLength(1);
    expect(plan.notes).toHaveLength(4);
    expect(plan.notes.join('\n')).toContain(lostOrder._id.toHexString());
  });

  it('merges duplicate cart rows for the same user and product', () => {
    const { data, user, product } = shop();
    data.carts.push({ _id: new ObjectId(), user_id: user._id, product_id: product._id, quantity: 4 });
    const plan = transformMongoData(data);
    expect(plan.cartItems).toHaveLength(1);
    expect(plan.cartItems[0].quantity).toBe(5);
  });

  it('rounds money to cents', () => {
    const { data } = shop();
    data.products[0].price = 4.499999999;
    data.orders[0].total_amount = 0.1 + 0.2;
    const plan = transformMongoData(data);
    expect(plan.products[0].price).toBe(4.5);
    expect(plan.orders[0].totalAmount).toBe(0.3);
  });
});

describe('writeImportPlan', () => {
  beforeEach(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it('writes everything, and old ids, logins and tokens keep working', async () => {
    const { data, user, product } = shop();
    // Python's bcrypt (FastAPI) writes $2b$ hashes; make sure those still log in.
    data.users[0].password_hash = (data.users[0].password_hash as string).replace(/^\$2a\$/, '$2b$');

    const counts = await writeImportPlan(prisma, transformMongoData(data));
    expect(counts).toEqual({ users: 1, categories: 1, products: 1, cartItems: 1, orders: 1, orderItems: 1, transactions: 1, partners: 1 });

    const api = request(app);
    const login = await api.post('/auth/login').type('form').send({ username: 'rana@test.dev', password: 'secret1' });
    expect(login.status).toBe(200);

    // A token issued before the switch carries the MongoDB id; it must still work.
    const oldToken = createAccessToken(user._id.toHexString(), 'user');
    const me = await api.get('/auth/me').set('Authorization', `Bearer ${oldToken}`);
    expect(me.body).toMatchObject({ id: user._id.toHexString(), email: 'rana@test.dev', created_at: '2025-12-01T10:00:00.000Z' });

    expect((await api.get(`/products/${product._id.toHexString()}`)).body).toMatchObject({ name: 'Baby Wipes', price: 4.5 });
    const orders = await api.get('/orders').set('Authorization', `Bearer ${oldToken}`);
    expect(orders.body[0]).toMatchObject({ total_amount: 9, items: [{ product_id: product._id.toHexString(), quantity: 2, unit_price: 4.5 }] });
  });

  it('refuses to write into a database that already has data', async () => {
    const { data } = shop();
    await writeImportPlan(prisma, transformMongoData(data));
    await expect(writeImportPlan(prisma, transformMongoData(shop().data))).rejects.toThrow(/not empty/);
    expect(await prisma.user.count()).toBe(1);
  });

  it('writes nothing if any part fails', async () => {
    const { data } = shop();
    const plan = transformMongoData(data);
    plan.partners.push({ ...plan.partners[0] }); // same id twice: the last insert fails
    await expect(writeImportPlan(prisma, plan)).rejects.toThrow();
    expect(await prisma.user.count()).toBe(0);
  });
});
