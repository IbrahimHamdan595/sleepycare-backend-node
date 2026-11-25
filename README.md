# SleepyCare backend

Express + TypeScript API for the SleepyCare shop, using PostgreSQL through Prisma.

## Setup

1. Copy `.env.example` to `.env` and set at least `DATABASE_URL` and `JWT_SECRET`.
2. Install and create the tables:

   ```bash
   npm install
   npm run db:deploy      # applies prisma/migrations to DATABASE_URL
   npm run seed:admin     # creates the admin from ADMIN_EMAIL / ADMIN_PASSWORD
   ```

3. Run it: `npm run dev` (port 8000 by default).

## Changing the database schema

Edit `prisma/schema.prisma`, then run `npm run db:migrate -- --name <what-changed>`
against a development database. Commit the new folder under `prisma/migrations/`.
In production, `npm run db:deploy` applies pending migrations.

## Moving the data from MongoDB (one time)

The live data used to be in MongoDB. `npm run db:import-mongo` copies it into Postgres.
It only reads from MongoDB and writes nothing there. It keeps the MongoDB ids, so
existing links and logged-in sessions keep working.

1. Create an empty Postgres database and run `npm run db:deploy` against it.
2. In `.env`, set `DATABASE_URL` to that database and keep `MONGODB_URI` (and
   `MONGODB_DB` if it isn't `sleepycare`) pointing at the old one.
3. Check first. This reads everything, reports what will be copied and anything
   left out, and writes nothing:

   ```bash
   npm run db:import-mongo -- --dry-run
   ```

4. Stop the old backend (so no new orders arrive in MongoDB), then run it for real:

   ```bash
   npm run db:import-mongo
   ```

   It refuses to write into a database that already has data, and either copies
   everything or nothing.

Not copied: password reset links (they expire after an hour).

## Tests

The tests run the real API against a real Postgres database and **delete all data in it**,
so they only use `TEST_DATABASE_URL`, never `DATABASE_URL`:

```bash
TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/sleepycare_test npm test
```

## Deploying

Build command: `npm install && npm run build && npm run db:deploy`
Start command: `npm start`
