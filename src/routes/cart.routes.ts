import { Router, Request, Response } from 'express';
import { getCurrentUser } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { prisma } from '../database';
import { cartItemCreateSchema, cartItemUpdateSchema } from '../schemas/cart.schema';
import { toCartRead } from '../utils/mappers';

const router = Router();

function ensureUserRole(req: Request, res: Response): boolean {
  if (req.user?.role !== 'user') {
    res.status(403).json({ detail: 'Forbidden' });
    return false;
  }
  return true;
}

/** The cart item, or null when it doesn't exist or belongs to someone else. */
async function findOwnCartItem(req: Request) {
  const item = await prisma.cartItem.findUnique({ where: { id: req.params.cartItemId } });
  return item && item.userId === req.user!.id ? item : null;
}

// All cart routes require authentication
router.use(getCurrentUser);

// GET /cart
router.get('/', async (req: Request, res: Response) => {
  if (!ensureUserRole(req, res)) return;

  try {
    const items = await prisma.cartItem.findMany({
      where: { userId: req.user!.id },
      orderBy: { id: 'asc' },
    });
    return res.status(200).json(items.map(toCartRead));
  } catch (error) {
    console.error('Get cart error:', error);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

// POST /cart
router.post('/', validate(cartItemCreateSchema), async (req: Request, res: Response) => {
  if (!ensureUserRole(req, res)) return;

  try {
    const { product_id, quantity } = req.body;

    const product = await prisma.product.findUnique({ where: { id: product_id } });
    if (!product) {
      return res.status(404).json({ detail: 'Product not found' });
    }

    // One row per user and product: adding the same product again raises the quantity.
    const cartItem = await prisma.cartItem.upsert({
      where: { userId_productId: { userId: req.user!.id, productId: product.id } },
      create: { userId: req.user!.id, productId: product.id, quantity },
      update: { quantity: { increment: quantity } },
    });

    return res.status(201).json(toCartRead(cartItem));
  } catch (error) {
    console.error('Add to cart error:', error);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

// PUT /cart/:cartItemId
router.put('/:cartItemId', validate(cartItemUpdateSchema), async (req: Request, res: Response) => {
  if (!ensureUserRole(req, res)) return;

  try {
    const cartItem = await findOwnCartItem(req);
    if (!cartItem) {
      return res.status(404).json({ detail: 'Cart item not found' });
    }

    const updated = await prisma.cartItem.update({
      where: { id: cartItem.id },
      data: { quantity: req.body.quantity },
    });

    return res.status(200).json(toCartRead(updated));
  } catch (error) {
    console.error('Update cart item error:', error);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

// DELETE /cart/:cartItemId
router.delete('/:cartItemId', async (req: Request, res: Response) => {
  if (!ensureUserRole(req, res)) return;

  try {
    // A single conditional delete: a double-click can't turn into a 500,
    // and other users' items simply don't match.
    const deleted = await prisma.cartItem.deleteMany({
      where: { id: req.params.cartItemId, userId: req.user!.id },
    });
    if (deleted.count === 0) {
      return res.status(404).json({ detail: 'Cart item not found' });
    }

    return res.status(204).send();
  } catch (error) {
    console.error('Delete cart item error:', error);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

export default router;
