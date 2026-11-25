import { prisma } from '../src/database';

/** Empties every table in the test database. */
export async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE users, categories, products, cart_items, orders, order_items, transactions, partners, password_reset_tokens CASCADE'
  );
}
