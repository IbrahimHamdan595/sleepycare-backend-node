import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';

// Applies the Prisma migrations to the test database before any test runs.
// The tests wipe every table, so they only ever use TEST_DATABASE_URL, and
// refuse to start if it points at the same database as DATABASE_URL.
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'Set TEST_DATABASE_URL to an empty Postgres database before running the tests. ' +
        'The tests delete all data in it.'
    );
  }

  const appUrls = [process.env.DATABASE_URL];
  if (existsSync('.env')) appUrls.push(parse(readFileSync('.env')).DATABASE_URL);
  if (appUrls.includes(url)) {
    throw new Error('TEST_DATABASE_URL is the same as DATABASE_URL; refusing to wipe it.');
  }

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
