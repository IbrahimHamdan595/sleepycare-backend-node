import { Router, Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { getCurrentUser, requireAdmin } from '../../middleware/auth.middleware';
import { HttpException } from '../../middleware/error.middleware';
import { imageFromRequest, imageUpload } from '../../services/storage.service';
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

/**
 * The partner's icon from an admin form: an uploaded logo (file or data: URL)
 * wins; otherwise the text the admin typed (an emoji or an https link).
 */
async function iconFromRequest(req: Request): Promise<string | undefined> {
  const name = typeof req.body.name === 'string' ? req.body.name : 'partner';
  const uploaded = await imageFromRequest(req, { file: 'icon', base64: 'icon_base64', nameHint: `partner_${name}` });
  if (uploaded) return uploaded;
  const text = typeof req.body.icon === 'string' ? req.body.icon.trim() : '';
  return text || undefined;
}

function sendValidationError(res: Response, error: ZodError) {
  return res.status(422).json({ detail: error.errors.map((e) => `${e.path.join('.')}: ${e.message}`) });
}

// POST /admin/partners (multipart form or JSON)
router.post('/', imageUpload.single('icon'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Check the name before uploading anything, so a bad form leaves no stray file.
    const name = partnerCreateSchema.shape.name.safeParse(req.body.name);
    if (!name.success) return sendValidationError(res, name.error);
    const parsed = partnerCreateSchema.safeParse({ name: name.data, icon: await iconFromRequest(req) });
    if (!parsed.success) return sendValidationError(res, parsed.error);

    const partner = await prisma.partner.create({ data: parsed.data });
    return res.status(201).json(toPartnerRead(partner));
  } catch (error) {
    if (error instanceof HttpException) return res.status(error.statusCode).json({ detail: error.detail });
    next(error);
  }
});

// PUT /admin/partners/:partnerId (multipart form or JSON; missing fields stay as they are)
router.put('/:partnerId', imageUpload.single('icon'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const partner = await prisma.partner.findUnique({ where: { id: req.params.partnerId } });
    if (!partner) {
      return res.status(404).json({ detail: 'Partner not found' });
    }

    const parsed = partnerUpdateSchema.safeParse({
      name: req.body.name || undefined,
      icon: await iconFromRequest(req),
    });
    if (!parsed.success) return sendValidationError(res, parsed.error);

    // updated_at is set automatically (@updatedAt).
    const updated = await prisma.partner.update({ where: { id: partner.id }, data: parsed.data });
    return res.status(200).json(toPartnerRead(updated));
  } catch (error) {
    if (error instanceof HttpException) return res.status(error.statusCode).json({ detail: error.detail });
    next(error);
  }
});

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
