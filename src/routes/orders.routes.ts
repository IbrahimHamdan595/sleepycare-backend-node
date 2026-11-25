import { Router, Request, Response } from 'express';
import { getCurrentUser } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { HttpException } from '../middleware/error.middleware';
import { prisma } from '../database';
import { orderCreateSchema, OrderItemIn } from '../schemas/order.schema';
import { MAX_MONEY } from '../schemas/limits';
import { roundMoney, toOrderRead } from '../utils/mappers';

const router = Router();

function ensureUserRole(req: Request, res: Response): boolean {
  if (req.user?.role !== 'user') {
    res.status(403).json({ detail: 'Forbidden' });
    return false;
  }
  return true;
}

// All order routes require authentication
router.use(getCurrentUser);

// POST /orders
router.post('/', validate(orderCreateSchema), async (req: Request, res: Response) => {
  if (!ensureUserRole(req, res)) return;

  try {
    const items: OrderItemIn[] = req.body.items;

    // Everything happens in one transaction: if any item fails, no stock is
    // taken and no order is created.
    const order = await prisma.$transaction(async (tx) => {
      const ids = [...new Set(items.map((item) => item.product_id))];
      const products = await tx.product.findMany({ where: { id: { in: ids } } });
      const byId = new Map(products.map((p) => [p.id, p]));
      const missing = items.find((item) => !byId.has(item.product_id));
      if (missing) {
        throw new HttpException(404, `Product ${missing.product_id} not found`);
      }

      // Take the stock per product, in id order, so that two orders with the
      // same products listed differently lock rows in the same order and cannot
      // deadlock. Each update takes stock only if enough is left, in a single
      // statement, so orders arriving together cannot oversell.
      for (const id of [...ids].sort()) {
        const wanted = items
          .filter((item) => item.product_id === id)
          .reduce((sum, item) => sum + item.quantity, 0);
        const taken = await tx.product.updateMany({
          where: { id, stock: { gte: wanted } },
          data: { stock: { decrement: wanted } },
        });
        if (taken.count === 0) {
          throw new HttpException(400, `Insufficient stock for ${byId.get(id)!.name}`);
        }
      }

      // Postgres stores money to the cent, so round before both storing and
      // totalling; otherwise the total could disagree with the saved lines.
      let total = 0;
      const orderItems = items.map((item) => {
        const unitPrice = roundMoney(item.unit_price);
        total += item.quantity * unitPrice;
        return { productId: item.product_id, quantity: item.quantity, unitPrice };
      });
      if (total > MAX_MONEY) {
        throw new HttpException(400, 'Order total is too large');
      }

      return tx.order.create({
        data: {
          userId: req.user!.id,
          totalAmount: roundMoney(total),
          items: { create: orderItems },
        },
        include: { items: { orderBy: { id: 'asc' } } },
      });
    });

    return res.status(201).json(toOrderRead(order));
  } catch (error) {
    if (error instanceof HttpException) {
      return res.status(error.statusCode).json({ detail: error.detail });
    }
    console.error('Create order error:', error);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

// GET /orders
router.get('/', async (req: Request, res: Response) => {
  if (!ensureUserRole(req, res)) return;

  try {
    const orders = await prisma.order.findMany({
      where: { userId: req.user!.id },
      include: { items: { orderBy: { id: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
    return res.status(200).json(orders.map(toOrderRead));
  } catch (error) {
    console.error('List orders error:', error);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

export default router;
