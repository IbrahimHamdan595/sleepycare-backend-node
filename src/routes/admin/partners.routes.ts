import { Router, Request, Response } from 'express';
import { getCurrentUser, requireAdmin } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { prisma } from '../../database';
import { partnerCreateSchema, partnerUpdateSchema } from '../../schemas/partner.schema';
import { toPartnerRead } from '../../utils/mappers';

const router = Router();

// All admin partner routes require admin authentication
router.use(getCurrentUser, requireAdmin);

// GET /admin/partners
router.get('/', async (req: Request, res: Response) => {
  try {
    const partners = await prisma.partner.findMany({ orderBy: { createdAt: 'asc' } });
    return res.status(200).json(partners.map(toPartnerRead));
  } catch (error) {
    console.error('List partners error:', error);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

// GET /admin/partners/:partnerId
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

// POST /admin/partners
router.post('/', validate(partnerCreateSchema), async (req: Request, res: Response) => {
  try {
    const { name, icon } = req.body;

    const partner = await prisma.partner.create({ data: { name, icon } });

    return res.status(201).json(toPartnerRead(partner));
  } catch (error) {
    console.error('Create partner error:', error);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

// PUT /admin/partners/:partnerId
router.put(
  '/:partnerId',
  validate(partnerUpdateSchema),
  async (req: Request, res: Response) => {
    try {
      const { partnerId } = req.params;
      const { name, icon } = req.body;

      const partner = await prisma.partner.findUnique({ where: { id: partnerId } });
      if (!partner) {
        return res.status(404).json({ detail: 'Partner not found' });
      }

      // updated_at is set automatically (@updatedAt).
      const updated = await prisma.partner.update({
        where: { id: partner.id },
        data: { name, icon },
      });
      return res.status(200).json(toPartnerRead(updated));
    } catch (error) {
      console.error('Update partner error:', error);
      return res.status(500).json({ detail: 'Internal server error' });
    }
  }
);

// DELETE /admin/partners/:partnerId
router.delete('/:partnerId', async (req: Request, res: Response) => {
  try {
    const partner = await prisma.partner.findUnique({ where: { id: req.params.partnerId } });
    if (!partner) {
      return res.status(404).json({ detail: 'Partner not found' });
    }

    await prisma.partner.delete({ where: { id: partner.id } });
    return res.status(204).send();
  } catch (error) {
    console.error('Delete partner error:', error);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

export default router;
