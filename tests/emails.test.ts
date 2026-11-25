import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { prisma } from '../src/database';
import { adminToken, api, makeProduct, orderBody, resetDatabase, userToken } from './helpers';

// The backend asks the frontend to send emails, proving itself with a shared
// secret. A real HTTP server stands in for the frontend and records each call.

interface Call {
  path: string;
  secret: string | undefined;
  body: any;
}

const calls: Call[] = [];
let server: http.Server;
let frontendUrl: string;
const original = { frontendUrl: config.frontendUrl, secret: config.internalApiSecret };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      calls.push({ path: req.url!, secret: req.headers['x-internal-secret'] as string | undefined, body: JSON.parse(raw) });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  frontendUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  calls.length = 0;
  config.frontendUrl = frontendUrl;
  config.internalApiSecret = 'test-internal-secret';
});

afterEach(() => {
  config.frontendUrl = original.frontendUrl;
  config.internalApiSecret = original.secret;
});

/** Emails are sent in the background; wait until the expected number arrived. */
async function waitForCalls(count: number) {
  for (let i = 0; i < 50 && calls.length < count; i++) await new Promise((r) => setTimeout(r, 20));
  return calls;
}

describe('emails', () => {
  it('asks the frontend to send the reset email, with the token and the secret', async () => {
    await userToken('forgot@test.dev');
    expect((await api.post('/auth/forgot-password').send({ email: 'forgot@test.dev' })).status).toBe(204);

    const [call] = await waitForCalls(1);
    const { token } = await prisma.passwordResetToken.findFirstOrThrow();
    expect(call).toEqual({
      path: '/api/auth/forgot-password',
      secret: 'test-internal-secret',
      body: { email: 'forgot@test.dev', name: 'Shopper', token },
    });
  });

  it('asks the frontend to send the order confirmation with the saved order', async () => {
    const admin = await adminToken();
    const product = await makeProduct(admin);
    const shopper = { Authorization: `Bearer ${await userToken()}` };
    const order = await api.post('/orders').set(shopper).send(orderBody([{ product_id: product.id, quantity: 1 }]));

    const [call] = await waitForCalls(1);
    expect(call.path).toBe('/api/orders/confirmation');
    expect(call.secret).toBe('test-internal-secret');
    expect(call.body).toEqual({ email: 'shopper@test.dev', name: 'Shopper', order: order.body });
  });

  it('still takes the order when the secret is not configured, and sends nothing', async () => {
    config.internalApiSecret = null;
    const admin = await adminToken();
    const product = await makeProduct(admin);
    const shopper = { Authorization: `Bearer ${await userToken()}` };
    const order = await api.post('/orders').set(shopper).send(orderBody([{ product_id: product.id, quantity: 1 }]));
    expect(order.status).toBe(201);

    await new Promise((r) => setTimeout(r, 200));
    expect(calls).toEqual([]);
  });
});
