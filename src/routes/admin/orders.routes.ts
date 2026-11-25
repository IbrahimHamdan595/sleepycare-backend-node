import { Router, Request, Response } from 'express';
import { getCurrentUser, requireAdmin } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { prisma } from '../../database';
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

      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order) {
        return res.status(404).json({ detail: 'Order not found' });
      }

      const updated = await prisma.order.update({
        where: { id: order.id },
        data: { status: req.body.status },
        include: { items: { orderBy: { id: 'asc' } }, user: { select: { name: true, email: true } } },
      });

      return res.status(200).json(toOrderRead(updated));
    } catch (error) {
      console.error('Update order status error:', error);
      return res.status(500).json({ detail: 'Internal server error' });
    }
  }
);

export default router;
