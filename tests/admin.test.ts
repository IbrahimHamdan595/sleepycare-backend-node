import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/database';
import { r2Client } from '../src/services/storage.service';
import { adminToken, api, makeProduct, orderBody, resetDatabase, userToken } from './helpers';

// Admin screens send forms (multipart), exactly as the dashboard does.

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());
afterAll(() => prisma.$disconnect());

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

describe('admin partners', () => {
  it('saves a partner sent as a form with an emoji icon', async () => {
    const auth = { Authorization: `Bearer ${await adminToken()}` };
    const res = await api.post('/admin/partners').set(auth).field('name', 'Baby Corner').field('icon', '🍼');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Baby Corner', icon: '🍼' });
  });

  it('saves an uploaded logo and keeps it when only the name changes', async () => {
    const auth = { Authorization: `Bearer ${await adminToken()}` };
    const created = await api
      .post('/admin/partners')
      .set(auth)
      .field('name', 'Pharmacie Centrale')
      .field('icon_base64', PNG_DATA_URL);
    expect(created.status).toBe(201);
    expect(created.body.icon).toMatch(/^data:image\/png;base64,|^https:\/\//);

    const renamed = await api.put(`/admin/partners/${created.body.id}`).set(auth).field('name', 'Pharmacie Centrale Hamra');
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ name: 'Pharmacie Centrale Hamra', icon: created.body.icon });
  });

  it('needs a name and an icon', async () => {
    const auth = { Authorization: `Bearer ${await adminToken()}` };
    expect((await api.post('/admin/partners').set(auth).field('name', 'No icon')).status).toBe(422);
    expect((await api.post('/admin/partners').set(auth).field('icon', '🍼')).status).toBe(422);
  });
});

describe('admin users', () => {
  it('lists how many orders each user placed', async () => {
    const admin = await adminToken();
    const product = await makeProduct(admin);
    await api
      .post('/orders')
      .set('Authorization', `Bearer ${await userToken()}`)
      .send(orderBody([{ product_id: product.id, quantity: 1 }]));

    const users = (await api.get('/admin/users').set('Authorization', `Bearer ${admin}`)).body;
    const byEmail = Object.fromEntries(users.map((u: any) => [u.email, u.orders_count]));
    expect(byEmail).toEqual({ 'admin@test.dev': 0, 'shopper@test.dev': 1 });
  });
});

describe('admin products and categories', () => {
  it('refuse impossible prices and stock', async () => {
    const auth = { Authorization: `Bearer ${await adminToken()}` };
    const create = (fields: Record<string, string>) => {
      const req = api.post('/admin/products').set(auth);
      for (const [k, v] of Object.entries({ name: 'Wipes', price: '4.5', stock: '10', ...fields })) req.field(k, v);
      return req;
    };
    expect((await create({ price: '-5' })).status).toBe(422);
    expect((await create({ price: '' })).status).toBe(422);
    expect((await create({ stock: 'abc' })).status).toBe(422);
    expect((await create({ stock: '2.5' })).status).toBe(422);
    expect((await create({ price: '1e12' })).status).toBe(422);
    expect(await prisma.product.count()).toBe(0);
  });

  it('accept only image uploads', async () => {
    const auth = { Authorization: `Bearer ${await adminToken()}` };
    const res = await api
      .post('/admin/products')
      .set(auth)
      .field('name', 'Wipes')
      .field('price', '4.5')
      .field('stock', '10')
      .attach('image', Buffer.from('not an image'), { filename: 'notes.txt', contentType: 'text/plain' });
    expect(res.status).toBe(422);
    expect(res.body.detail).toBe('Only image files can be uploaded');
  });

  it('keep the old image when an update fails', async () => {
    const admin = await adminToken();
    const auth = { Authorization: `Bearer ${admin}` };
    const product = await makeProduct(admin, { name: 'Wipes', image_url: 'https://cdn.test/old.png' });
    await makeProduct(admin, { name: 'Taken' });
    const deleted = vi.spyOn(r2Client, 'deleteFile');

    const res = await api
      .put(`/admin/products/${product.id}`)
      .set(auth)
      .field('name', 'Taken')
      .field('image_base64', PNG_DATA_URL);
    expect(res.status).toBe(400);
    // Only the image uploaded for the failed save may be cleaned up, never the old one.
    expect(deleted).not.toHaveBeenCalledWith('https://cdn.test/old.png');
    expect((await api.get(`/products/${product.id}`)).body.image_url).toBe('https://cdn.test/old.png');
  });

  it('delete the old image only after the new one is saved', async () => {
    const admin = await adminToken();
    const product = await makeProduct(admin, { image_url: 'https://cdn.test/old.png' });
    let savedWhenDeleted: string | null = null;
    vi.spyOn(r2Client, 'deleteFile').mockImplementation(async () => {
      savedWhenDeleted = (await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).imageUrl;
      return true;
    });

    const res = await api
      .put(`/admin/products/${product.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .field('image_base64', PNG_DATA_URL);
    expect(res.status).toBe(200);
    expect(r2Client.deleteFile).toHaveBeenCalledWith('https://cdn.test/old.png');
    expect(savedWhenDeleted).toBe(res.body.image_url);
  });

  it('delete a product image with the product', async () => {
    const admin = await adminToken();
    const product = await makeProduct(admin, { image_url: 'https://cdn.test/wipes.png' });
    const deleted = vi.spyOn(r2Client, 'deleteFile');
    await api.delete(`/admin/products/${product.id}`).set('Authorization', `Bearer ${admin}`);
    expect(deleted).toHaveBeenCalledWith('https://cdn.test/wipes.png');
  });

  it('keep a category icon when the update fails, and delete the old one after a successful change', async () => {
    const auth = { Authorization: `Bearer ${await adminToken()}` };
    const cat = await api.post('/admin/categories').set(auth).field('name', 'Wipes').field('icon_base64', PNG_DATA_URL);
    await api.post('/admin/categories').set(auth).field('name', 'Taken');
    const oldIcon = cat.body.icon;
    let savedWhenDeleted: string | null | undefined;
    const deleted = vi.spyOn(r2Client, 'deleteFile').mockImplementation(async () => {
      savedWhenDeleted = (await prisma.category.findUniqueOrThrow({ where: { id: cat.body.id } })).icon;
      return true;
    });

    const failed = await api
      .put(`/admin/categories/${cat.body.id}`)
      .set(auth)
      .field('name', 'Taken')
      .field('icon_base64', 'data:image/png;base64,AAAA');
    expect(failed.status).toBe(400);
    expect(deleted).not.toHaveBeenCalledWith(oldIcon);

    deleted.mockClear();
    const changed = await api.put(`/admin/categories/${cat.body.id}`).set(auth).field('icon_base64', 'data:image/png;base64,BBBB');
    expect(changed.status).toBe(200);
    expect(deleted).toHaveBeenCalledWith(oldIcon);
    expect(savedWhenDeleted).toBe(changed.body.icon);
  });

  it('ignore an existing icon link sent back by the edit form', async () => {
    const auth = { Authorization: `Bearer ${await adminToken()}` };
    const cat = await api.post('/admin/categories').set(auth).field('name', 'Wipes').field('icon_base64', PNG_DATA_URL);
    const res = await api.put(`/admin/categories/${cat.body.id}`).set(auth).field('name', 'Baby wipes').field('icon_base64', cat.body.icon.startsWith('data:') ? 'https://cdn.test/existing.png' : cat.body.icon);
    expect(res.status).toBe(200);
    expect(res.body.icon).toBe(cat.body.icon);
  });

  it('delete a category icon after the category is gone', async () => {
    const auth = { Authorization: `Bearer ${await adminToken()}` };
    const cat = await api.post('/admin/categories').set(auth).field('name', 'Wipes').field('icon_base64', PNG_DATA_URL);
    let rowsWhenDeleted = -1;
    vi.spyOn(r2Client, 'deleteFile').mockImplementation(async () => {
      rowsWhenDeleted = await prisma.category.count();
      return true;
    });
    expect((await api.delete(`/admin/categories/${cat.body.id}`).set(auth)).status).toBe(204);
    expect(rowsWhenDeleted).toBe(0);
  });

  it('store an emptied category description as empty, not as ""', async () => {
    const auth = { Authorization: `Bearer ${await adminToken()}` };
    const cat = await api.post('/admin/categories').set(auth).field('name', 'Wipes').field('description', 'Soft');
    const res = await api.put(`/admin/categories/${cat.body.id}`).set(auth).field('description', '');
    expect(res.body.description).toBeNull();
  });
});
