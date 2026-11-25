// Turns the SleepyCare MongoDB collections into Postgres rows and writes them.
// Used once, by prisma/import-from-mongo.ts, when moving the live data.
//
// MongoDB ids are kept (as 24-character hex text), so links, bookmarks and
// login tokens issued before the move keep working.

import { Prisma, PrismaClient } from '@prisma/client';
import { roundMoney } from '../src/utils/mappers';

type MongoDoc = Record<string, any>;

export interface MongoCollections {
  users: MongoDoc[];
  categories: MongoDoc[];
  products: MongoDoc[];
  orders: MongoDoc[];
  transactions: MongoDoc[];
  partners: MongoDoc[];
}

export interface ImportPlan {
  users: Prisma.UserCreateManyInput[];
  categories: Prisma.CategoryCreateManyInput[];
  products: (Prisma.ProductCreateManyInput & { price: number })[];
  orders: (Prisma.OrderCreateManyInput & { totalAmount: number })[];
  orderItems: Prisma.OrderItemCreateManyInput[];
  transactions: Prisma.TransactionCreateManyInput[];
  partners: Prisma.PartnerCreateManyInput[];
  /** Records left out or changed, with the reason, for the person running the import. */
  notes: string[];
}

/** ObjectId -> hex text; anything else as text. */
const idOf = (value: any): string =>
  typeof value?.toHexString === 'function' ? value.toHexString() : String(value);

/** created_at when the document has one, otherwise the time inside its ObjectId. */
function createdAt(doc: MongoDoc): Date {
  if (doc.created_at) return new Date(doc.created_at);
  if (typeof doc._id?.getTimestamp === 'function') return doc._id.getTimestamp();
  return new Date();
}

const money = (value: unknown): number => roundMoney(Number(value ?? 0));
const whole = (value: unknown, fallback: number): number => Math.trunc(Number(value ?? fallback));

/** Values that more than one row uses, e.g. `email "a@b.c" (ids x, y)`. */
function duplicates(rows: { id?: string }[], field: string, valueOf: (row: any) => string): string[] {
  const idsByValue = new Map<string, string[]>();
  for (const row of rows) {
    const value = valueOf(row);
    idsByValue.set(value, [...(idsByValue.get(value) ?? []), String(row.id)]);
  }
  return [...idsByValue]
    .filter(([, ids]) => ids.length > 1)
    .map(([value, ids]) => `${field} "${value}" (ids ${ids.join(', ')})`);
}

export function transformMongoData(data: MongoCollections): ImportPlan {
  const notes: string[] = [];

  // Users. Postgres stores emails in lowercase with a unique index.
  const users = data.users.map((u) => {
    const id = idOf(u._id);
    const email = String(u.email ?? '').trim().toLowerCase();
    return {
      id,
      name: String(u.name ?? ''),
      email,
      passwordHash: u.password_hash ?? null,
      role: u.role === 'admin' ? ('admin' as const) : ('user' as const),
      provider: u.provider ?? 'local',
      providerUserId: u.provider_user_id ?? null,
      createdAt: createdAt(u),
    };
  });
  const userIds = new Set(users.map((u) => u.id));

  const categories = data.categories.map((c) => ({
    id: idOf(c._id),
    name: String(c.name),
    description: c.description ?? null,
    icon: c.icon ?? null,
    createdAt: createdAt(c),
  }));
  const categoryIds = new Set(categories.map((c) => c.id));

  const products = data.products.map((p) => {
    const id = idOf(p._id);
    let categoryId: string | null = p.category_id ? idOf(p.category_id) : null;
    if (categoryId && !categoryIds.has(categoryId)) {
      notes.push(`Product ${id} (${p.name}): its category ${categoryId} no longer exists, so it comes over without a category.`);
      categoryId = null;
    }
    return {
      id,
      name: String(p.name),
      description: p.description ?? null,
      price: money(p.price),
      stock: whole(p.stock, 0),
      imageUrl: p.image_url ?? null,
      categoryId,
      createdAt: createdAt(p),
    };
  });
  const productIds = new Set(products.map((p) => p.id));

  // These are unique in Postgres. Rather than let the insert fail with a
  // vague error, stop here and name every clash so it can be fixed in MongoDB.
  const clashes = [
    ...duplicates(users, 'email', (u) => u.email),
    ...duplicates(categories, 'category name', (c) => c.name),
    ...duplicates(products, 'product name', (p) => p.name),
  ];
  if (clashes.length > 0) {
    throw new Error(
      `Some values must be unique in Postgres but are used more than once in MongoDB. Merge or rename these, then run the import again: ${clashes.join('; ')}`
    );
  }

  // Orders keep their lines even if a product was deleted since, as before.
  const orders: ImportPlan['orders'] = [];
  const orderItems: ImportPlan['orderItems'] = [];
  for (const o of data.orders) {
    const id = idOf(o._id);
    const userId = idOf(o.user_id);
    if (!userIds.has(userId)) {
      notes.push(`Order ${id}: its customer ${userId} no longer exists, so it is left out.`);
      continue;
    }
    orders.push({
      id,
      userId,
      status: o.status ?? 'pending',
      totalAmount: money(o.total_amount),
      createdAt: createdAt(o),
    });
    for (const item of o.items ?? []) {
      orderItems.push({
        orderId: id,
        productId: idOf(item.product_id),
        quantity: whole(item.quantity, 1),
        unitPrice: money(item.unit_price),
      });
    }
  }
  const orderIds = new Set(orders.map((o) => o.id));

  const transactions: ImportPlan['transactions'] = [];
  for (const t of data.transactions) {
    const id = idOf(t._id);
    const orderId = idOf(t.order_id);
    const userId = idOf(t.user_id);
    if (!orderIds.has(orderId) || !userIds.has(userId)) {
      notes.push(`Transaction ${id}: its order ${orderId} or customer was left out or no longer exists, so it is left out too.`);
      continue;
    }
    transactions.push({
      id,
      orderId,
      userId,
      amount: money(t.amount),
      paymentMethod: String(t.payment_method ?? ''),
      status: String(t.status ?? ''),
      createdAt: createdAt(t),
    });
  }

  const partners = data.partners.map((p) => ({
    id: idOf(p._id),
    name: String(p.name),
    icon: String(p.icon ?? ''),
    createdAt: createdAt(p),
    updatedAt: p.updated_at ? new Date(p.updated_at) : createdAt(p),
  }));

  return {
    users,
    categories,
    products,
    orders,
    orderItems,
    transactions,
    partners,
    notes,
  };
}

/**
 * Writes the plan into an empty Postgres database in one transaction:
 * either everything is imported or nothing is.
 */
export async function writeImportPlan(prisma: PrismaClient, plan: ImportPlan) {
  const existing = await Promise.all([
    prisma.user.count(),
    prisma.category.count(),
    prisma.product.count(),
    prisma.order.count(),
    prisma.partner.count(),
  ]);
  if (existing.some((n) => n > 0)) {
    throw new Error('The Postgres database is not empty. Import only into a freshly migrated, empty database.');
  }

  return prisma.$transaction(
    async (tx) => ({
      // Parents before children, so every foreign key already has its row.
      users: (await tx.user.createMany({ data: plan.users })).count,
      categories: (await tx.category.createMany({ data: plan.categories })).count,
      products: (await tx.product.createMany({ data: plan.products })).count,
      orders: (await tx.order.createMany({ data: plan.orders })).count,
      orderItems: (await tx.orderItem.createMany({ data: plan.orderItems })).count,
      transactions: (await tx.transaction.createMany({ data: plan.transactions })).count,
      partners: (await tx.partner.createMany({ data: plan.partners })).count,
    }),
    { maxWait: 10_000, timeout: 10 * 60_000 }
  );
}
