import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/database';
import { api, resetDatabase, userToken } from './helpers';

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());
afterAll(() => prisma.$disconnect());

describe('error statuses', () => {
  it('answers broken JSON with 400, not 500', async () => {
    const res = await api.post('/auth/register').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ detail: 'The request body is not valid JSON' });
  });

  it('answers a malformed login with 422, not 500', async () => {
    const res = await api.post('/auth/login').send({ username: 123, password: 'x' });
    expect(res.status).toBe(422);
  });

  it('does not log people out when the database fails', async () => {
    const token = await userToken();
    vi.spyOn(prisma.user, 'findUnique').mockRejectedValueOnce(new Error('connection lost'));
    const res = await api.get('/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(500);
  });

  it('still rejects a bad token with 401', async () => {
    const res = await api.get('/auth/me').set('Authorization', 'Bearer not-a-token');
    expect(res.status).toBe(401);
  });
});

describe('response headers', () => {
  it('does not announce the framework and forbids MIME sniffing and framing', async () => {
    const res = await api.get('/settings');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });
});
