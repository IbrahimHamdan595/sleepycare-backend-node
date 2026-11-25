// One-off: copies the SleepyCare data from MongoDB into an empty, migrated Postgres.
// It only reads from MongoDB; nothing there is changed.
//
//   npm run db:import-mongo -- --dry-run   reads and checks everything, writes nothing
//   npm run db:import-mongo                writes into DATABASE_URL (must be empty)
//
// Reads MONGODB_URI, MONGODB_DB (default "sleepycare") and DATABASE_URL from .env.
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { PrismaClient } from '@prisma/client';
import { MongoCollections, transformMongoData, writeImportPlan } from './mongo-import';

// Collection names used by both the FastAPI and the Mongoose backends.
const COLLECTIONS: Record<keyof MongoCollections, string> = {
  users: 'users',
  categories: 'categories',
  products: 'products',
  orders: 'orders',
  transactions: 'transactions',
  partners: 'partners',
};
// Deliberately not copied: reset links expire after an hour, and carts now
// live in the shopper's browser.
const SKIPPED = ['password_reset_tokens', 'carts'];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Set MONGODB_URI (the old database) in .env or the environment.');
  if (!dryRun && !process.env.DATABASE_URL) throw new Error('Set DATABASE_URL (the new Postgres database).');

  const mongo = new MongoClient(uri);
  await mongo.connect();
  try {
    const db = mongo.db(process.env.MONGODB_DB || 'sleepycare');

    const present = (await db.listCollections().toArray()).map((c) => c.name);
    const known = [...Object.values(COLLECTIONS), ...SKIPPED];
    const unknown = present.filter((name) => !known.includes(name));
    if (unknown.length > 0) {
      console.warn(`Not imported (unknown collections, check them by hand): ${unknown.join(', ')}`);
    }

    const data = {} as MongoCollections;
    for (const [key, name] of Object.entries(COLLECTIONS) as [keyof MongoCollections, string][]) {
      data[key] = await db.collection(name).find().toArray();
    }

    const plan = transformMongoData(data);

    console.log('\nRead from MongoDB:');
    for (const [key, name] of Object.entries(COLLECTIONS) as [keyof MongoCollections, string][]) {
      console.log(`  ${name.padEnd(14)} ${data[key].length}`);
    }
    console.log('\nRows for Postgres:');
    for (const key of ['users', 'categories', 'products', 'orders', 'orderItems', 'transactions', 'partners'] as const) {
      console.log(`  ${key.padEnd(14)} ${plan[key].length}`);
    }
    if (plan.notes.length > 0) {
      console.log(`\n${plan.notes.length} note(s):`);
      for (const note of plan.notes) console.log(`  - ${note}`);
    }

    if (dryRun) {
      console.log('\nDry run: nothing was written.');
      return;
    }

    const prisma = new PrismaClient();
    try {
      const counts = await writeImportPlan(prisma, plan);
      console.log('\nImported into Postgres:', counts);
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    await mongo.close();
  }
}

main().catch((error) => {
  console.error(`\nImport stopped: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
