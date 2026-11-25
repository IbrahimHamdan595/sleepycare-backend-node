import { Router, Request, Response } from 'express';
import { getCurrentUser, requireAdmin } from '../../middleware/auth.middleware';
import { prisma } from '../../database';
import { toUserRead } from '../../utils/mappers';

const router = Router();

// All admin user routes require admin authentication
router.use(getCurrentUser, requireAdmin);

// GET /admin/users
router.get('/', async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { orders: true } } },
    });
    return res.status(200).json(users.map((user) => ({ ...toUserRead(user), orders_count: user._count.orders })));
  } catch (error) {
    console.error('List users error:', error);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

// GET /admin/users/:userId
router.get('/:userId', async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.userId } });
    if (!user) {
      return res.status(404).json({ detail: 'User not found' });
    }

    return res.status(200).json(toUserRead(user));
  } catch (error) {
    console.error('Get user error:', error);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

export default router;
