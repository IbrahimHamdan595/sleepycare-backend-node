import { Router, Request, Response } from 'express';
import { prisma } from '../database';
import { toCategoryRead } from '../utils/mappers';

const router = Router();

// GET /categories
router.get('/', async (req: Request, res: Response) => {
  try {
    const categories = await prisma.category.findMany({ orderBy: { createdAt: 'asc' } });
    return res.status(200).json(categories.map(toCategoryRead));
  } catch (error) {
    console.error('List categories error:', error);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

export default router;
