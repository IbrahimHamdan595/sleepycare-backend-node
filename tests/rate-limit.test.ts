import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

// Its own file: the limit is read when the app loads, so this file loads the
// app with a small limit (each test file runs with fresh modules).

let api: ReturnType<typeof request>;
let disconnect: () => Promise<void>;

beforeAll(async () => {
  process.env.AUTH_RATE_LIMIT_MAX = '3';
  const app: Express = (await import('../src/app')).default;
  const { prisma } = await import('../src/database');
  disconnect = () => prisma.$disconnect();
  api = request(app);
});

afterAll(() => disconnect());

describe('successful sign-ins', () => {
  it('do not use up the limit, so people sharing one address are not locked out', async () => {
    const { prisma } = await import('../src/database');
    const { getPasswordHash } = await import('../src/utils/security');
    const email = `shared-${Date.now()}@test.dev`;
    await prisma.user.create({ data: { name: 'Shared', email, passwordHash: await getPasswordHash('right-pass') } });
    // A different address from the test below, through the trusted proxy header.
    const login = (password: string) =>
      api.post('/auth/login').set('X-Forwarded-For', '203.0.113.7').type('form').send({ username: email, password });

    for (let i = 0; i < 5; i++) expect((await login('right-pass')).status).toBe(200);
    for (let i = 0; i < 3; i++) expect((await login('wrong-pass')).status).toBe(400);
    expect((await login('wrong-pass')).status).toBe(429);
  });
});

describe('login attempts', () => {
  it('are limited per address, with a readable message', async () => {
    const attempt = () =>
      api.post('/auth/login').type('form').send({ username: 'nobody@test.dev', password: 'wrong-pass' });

    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(400);

    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ detail: 'Too many attempts. Please wait a few minutes and try again.' });
  });
});
