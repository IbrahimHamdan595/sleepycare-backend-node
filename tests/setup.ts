// Runs in each test process before the app is imported.
// dotenv never overrides variables that are already set, so these win over .env.
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is not set; refusing to run tests against DATABASE_URL.');
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET = 'test-secret';
// Password-reset emails are sent to the frontend; point that at a closed port.
process.env.FRONTEND_URL = 'http://127.0.0.1:9';
// Tests log in many times from one address; rate-limit.test.ts sets its own low limit.
process.env.AUTH_RATE_LIMIT_MAX ??= '1000';
