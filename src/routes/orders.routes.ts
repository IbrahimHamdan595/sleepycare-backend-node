import { Router, Request, Response } from 'express';
import { getCurrentUser } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { HttpException } from '../middleware/error.middleware';
import { prisma } from '../database';
import { orderCreateSchema, OrderCreate } from '../schemas/order.schema';
import { MAX_MONEY } from '../schemas/limits';
import { getStoreSettings, quoteOrder } from '../services/pricing.service';
import { toOrderRead } from '../utils/mappers';

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
    const { items, shipping, payment_method: paymentMethod }: OrderCreate = req.body;
    // Read once, outside the transaction, so orders never queue behind each other on it.
    const settings = await getStoreSettings();

    // Everything happens in one transaction: if any item fails, no stock is
    // taken, no order is created and no payment is recorded.
    const order = await prisma.$transaction(async (tx) => {
      const ids = [...new Set(items.map((item) => item.product_id))];
      const products = await tx.product.findMany({ where: { id: { in: ids } } });
      const byId = new Map(products.map((p) => [p.id, p]));
      const missing = items.find((item) => !byId.has(item.product_id));
      if (missing) {
        throw new HttpException(404, `This product is no longer available: ${missing.product_id}`);
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

      // Prices always come from the product row, never from the browser.
      let subtotal = 0;
      const orderItems = items.map((item) => {
        const product = byId.get(item.product_id)!;
        const unitPrice = product.price.toNumber();
        subtotal += item.quantity * unitPrice;
        return { productId: product.id, productName: product.name, quantity: item.quantity, unitPrice };
      });
      const quote = quoteOrder(subtotal, settings);
      if (quote.total > MAX_MONEY) {
        throw new HttpException(400, 'Order total is too large');
      }

      return tx.order.create({
        data: {
          userId: req.user!.id,
          subtotal: quote.subtotal,
          deliveryFee: quote.deliveryFee,
          tax: quote.tax,
          totalAmount: quote.total,
          paymentMethod,
          shippingName: shipping.full_name,
          shippingPhone: shipping.phone,
          shippingAddress: shipping.address,
          shippingCity: shipping.city,
          shippingGovernorate: shipping.governorate,
          shippingNotes: shipping.notes || null,
          items: { create: orderItems },
          // Cash on delivery: the payment is pending until the courier collects it.
          transactions: {
            create: { userId: req.user!.id, amount: quote.total, paymentMethod, status: 'pending' },
          },
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
