import { Router, Request, Response } from 'express';
import { getCurrentUser } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { prisma } from '../database';
import { transactionCreateSchema } from '../schemas/transaction.schema';
import { toTransactionRead } from '../utils/mappers';

const router = Router();

function ensureUserRole(req: Request, res: Response): boolean {
  if (req.user?.role !== 'user') {
    res.status(403).json({ detail: 'Forbidden' });
    return false;
  }
  return true;
}

// All transaction routes require authentication
router.use(getCurrentUser);

// POST /transactions
router.post('/', validate(transactionCreateSchema), async (req: Request, res: Response) => {
  if (!ensureUserRole(req, res)) return;

  try {
    const { order_id, amount, payment_method, status } = req.body;

    const order = await prisma.order.findUnique({ where: { id: order_id } });
    if (!order || order.userId !== req.user!.id) {
      return res.status(404).json({ detail: 'Order not found' });
    }

    const transaction = await prisma.transaction.create({
      data: {
        orderId: order.id,
        userId: req.user!.id,
        amount,
        paymentMethod: payment_method,
        status,
      },
    });

    return res.status(201).json(toTransactionRead(transaction));
  } catch (error) {
    console.error('Create transaction error:', error);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

// GET /transactions
router.get('/', async (req: Request, res: Response) => {
  if (!ensureUserRole(req, res)) return;

  try {
    const transactions = await prisma.transaction.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'asc' },
    });
    return res.status(200).json(transactions.map(toTransactionRead));
  } catch (error) {
    console.error('List transactions error:', error);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

export default router;
