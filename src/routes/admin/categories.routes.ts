import { Router, Request, Response, NextFunction } from 'express';
import { getCurrentUser, requireAdmin } from '../../middleware/auth.middleware';
import { HttpException } from '../../middleware/error.middleware';
import { prisma, isUniqueViolation } from '../../database';
import { imageFromRequest, imageUpload, r2Client } from '../../services/storage.service';
import { toCategoryRead } from '../../utils/mappers';

const router = Router();

function handleError(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof HttpException) {
    return res.status(error.statusCode).json({ detail: error.detail });
  }
  if (isUniqueViolation(error)) {
    return res.status(400).json({ detail: 'Category already exists' });
  }
  next(error);
}

const textField = (value: unknown) => (typeof value === 'string' ? value.trim() : undefined);

// All admin category routes require admin authentication
router.use(getCurrentUser, requireAdmin);

// POST /admin/categories (multipart form: name, description, icon file or icon_base64)
router.post('/', imageUpload.single('icon'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = textField(req.body.name);
    if (!name) {
      return res.status(422).json({ detail: 'Name is required' });
    }
    if (await prisma.category.findUnique({ where: { name } })) {
      return res.status(400).json({ detail: 'Category already exists' });
    }

    const icon = await imageFromRequest(req, { file: 'icon', base64: 'icon_base64', nameHint: `category_${name}` });
    try {
      const category = await prisma.category.create({
        data: { name, description: textField(req.body.description) || null, icon },
      });
      return res.status(201).json(toCategoryRead(category));
    } catch (error) {
      if (icon) await r2Client.deleteFile(icon);
      throw error;
    }
  } catch (error) {
    handleError(error, res, next);
  }
});

// PUT /admin/categories/:categoryId (fields left out stay as they are)
router.put('/:categoryId', imageUpload.single('icon'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const category = await prisma.category.findUnique({ where: { id: req.params.categoryId } });
    if (!category) {
      return res.status(404).json({ detail: 'Category not found' });
    }

    const name = textField(req.body.name);
    const description = textField(req.body.description);
    // Only a new upload replaces the icon; the edit form sending back the
    // current icon's link is ignored.
    const uploaded = await imageFromRequest(req, {
      file: 'icon',
      base64: 'icon_base64',
      nameHint: `category_${name || category.name}`,
    });

    // Save first; the old icon is deleted only once nothing points at it.
    let updated;
    try {
      updated = await prisma.category.update({
        where: { id: category.id },
        data: {
          name: name || undefined,
          description: description === undefined ? undefined : description || null,
          icon: uploaded ?? undefined,
        },
      });
    } catch (error) {
      if (uploaded) await r2Client.deleteFile(uploaded);
      throw error;
    }
    if (uploaded && category.icon) {
      await r2Client.deleteFile(category.icon);
    }

    return res.status(200).json(toCategoryRead(updated));
  } catch (error) {
    handleError(error, res, next);
  }
});

// DELETE /admin/categories/:categoryId
router.delete('/:categoryId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const category = await prisma.category.findUnique({ where: { id: req.params.categoryId } });
    if (!category) {
      return res.status(404).json({ detail: 'Category not found' });
    }

    // Products in this category become uncategorised (onDelete: SetNull).
    await prisma.category.delete({ where: { id: category.id } });
    if (category.icon) await r2Client.deleteFile(category.icon);
    return res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
