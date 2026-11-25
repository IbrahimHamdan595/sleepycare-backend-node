import { Router, Request, Response } from 'express';
import { prisma } from '../database';
import { toProductRead } from '../utils/mappers';

const router = Router();

// GET /products
router.get('/', async (req: Request, res: Response) => {
  try {
    const products = await prisma.product.findMany({ orderBy: { createdAt: 'asc' } });
    return res.status(200).json(products.map(toProductRead));
  } catch (error) {
    console.error('List products error:', error);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

// GET /products/category/:categoryId
router.get('/category/:categoryId', async (req: Request, res: Response) => {
  try {
    const products = await prisma.product.findMany({
      where: { categoryId: req.params.categoryId },
      orderBy: { createdAt: 'asc' },
    });
    return res.status(200).json(products.map(toProductRead));
  } catch (error) {
    console.error('List products by category error:', error);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

// GET /products/:productId
router.get('/:productId', async (req: Request, res: Response) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.productId } });
    if (!product) {
      return res.status(404).json({ detail: 'Product not found' });
    }
    return res.status(200).json(toProductRead(product));
  } catch (error) {
    console.error('Get product error:', error);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

export default router;
