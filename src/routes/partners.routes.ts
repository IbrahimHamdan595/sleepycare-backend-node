import { Router, Request, Response } from 'express';
import { prisma } from '../database';
import { toPartnerRead } from '../utils/mappers';

const router = Router();

// GET /partners
router.get('/', async (req: Request, res: Response) => {
  try {
    const partners = await prisma.partner.findMany({ orderBy: { createdAt: 'asc' } });
    return res.status(200).json(partners.map(toPartnerRead));
  } catch (error) {
    console.error('List partners error:', error);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

// GET /partners/:partnerId
router.get('/:partnerId', async (req: Request, res: Response) => {
  try {
    const partner = await prisma.partner.findUnique({ where: { id: req.params.partnerId } });
    if (!partner) {
      return res.status(404).json({ detail: 'Partner not found' });
    }
    return res.status(200).json(toPartnerRead(partner));
  } catch (error) {
    console.error('Get partner error:', error);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

export default router;
