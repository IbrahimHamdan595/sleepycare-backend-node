import { Router, Request, Response } from 'express';
import { getCurrentUser, requireAdmin } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { HttpException } from '../../middleware/error.middleware';
import { prisma } from '../../database';
import { OrderStatus } from '../../constants';
import { orderUpdateStatusSchema } from '../../schemas/order.schema';
import { toOrderRead } from '../../utils/mappers';

const router = Router();

// All admin order routes require admin authentication
router.use(getCurrentUser, requireAdmin);

// GET /admin/orders
router.get('/', async (req: Request, res: Response) => {
  try {
    const orders = await prisma.order.findMany({
      include: { items: { orderBy: { id: 'asc' } }, user: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return res.status(200).json(orders.map(toOrderRead));
  } catch (error) {
    console.error('List orders error:', error);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

// PUT /admin/orders/:orderId
router.put(
  '/:orderId',
  validate(orderUpdateStatusSchema),
  async (req: Request, res: Response) => {
    try {
      const { orderId } = req.params;
      const status: OrderStatus = req.body.status;

      const updated = await prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
        if (!order) {
          throw new HttpException(404, 'Order not found');
        }

        // Cancelled is final. The check is part of the write, so when two
        // cancels arrive together only one changes the row and restores stock.
        const changed = await tx.order.updateMany({
          where: { id: orderId, status: { not: 'cancelled' } },
          data: { status },
        });
        if (changed.count === 0) {
          throw new HttpException(409, "Cancelled orders can't be changed");
        }

        if (status === 'cancelled') {
          // Products in id order, like checkout, so the two never deadlock.
          const items = [...order.items].sort((a, b) => a.productId.localeCompare(b.productId));
          for (const item of items) {
            // updateMany: a product deleted since the order is simply skipped.
            await tx.product.updateMany({
              where: { id: item.productId },
              data: { stock: { increment: item.quantity } },
            });
          }
        }

        return tx.order.findUniqueOrThrow({
          where: { id: orderId },
          include: { items: { orderBy: { id: 'asc' } }, user: { select: { name: true, email: true } } },
        });
      });

      return res.status(200).json(toOrderRead(updated));
    } catch (error) {
      if (error instanceof HttpException) {
        return res.status(error.statusCode).json({ detail: error.detail });
      }
      console.error('Update order status error:', error);
      return res.status(500).json({ detail: 'Internal server error' });
    }
  }
);

export default router;
