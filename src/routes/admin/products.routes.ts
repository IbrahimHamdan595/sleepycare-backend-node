import { Router, Request, Response, NextFunction } from 'express';
import { getCurrentUser, requireAdmin } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { HttpException } from '../../middleware/error.middleware';
import { prisma, isUniqueViolation } from '../../database';
import { imageFromRequest, imageUpload, r2Client } from '../../services/storage.service';
import { productCreateSchema, productUpdateSchema, ProductCreate, ProductUpdate } from '../../schemas/product.schema';
import { toProductRead } from '../../utils/mappers';

const router = Router();

async function categoryExists(categoryId: string): Promise<boolean> {
  return (await prisma.category.count({ where: { id: categoryId } })) > 0;
}

function handleError(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof HttpException) {
    return res.status(error.statusCode).json({ detail: error.detail });
  }
  if (isUniqueViolation(error)) {
    return res.status(400).json({ detail: 'Product with this name already exists' });
  }
  next(error);
}

// All admin product routes require admin authentication
router.use(getCurrentUser, requireAdmin);

// POST /admin/products (multipart form)
router.post('/', imageUpload.single('image'), validate(productCreateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body: ProductCreate = req.body;
    if (body.category_id && !(await categoryExists(body.category_id))) {
      return res.status(400).json({ detail: 'Invalid category' });
    }

    const uploaded = await imageFromRequest(req, { file: 'image', base64: 'image_base64', nameHint: `product_${body.name}` });
    try {
      const product = await prisma.product.create({
        data: {
          name: body.name,
          description: body.description || null,
          price: body.price,
          stock: body.stock,
          imageUrl: uploaded ?? body.image_url ?? null,
          categoryId: body.category_id || null,
        },
      });
      return res.status(201).json(toProductRead(product));
    } catch (error) {
      // The product wasn't saved, so the image just uploaded belongs to nothing.
      if (uploaded) await r2Client.deleteFile(uploaded);
      throw error;
    }
  } catch (error) {
    handleError(error, res, next);
  }
});

// PUT /admin/products/:productId (multipart form; fields left out stay as they are)
router.put('/:productId', imageUpload.single('image'), validate(productUpdateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body: ProductUpdate = req.body;
    const product = await prisma.product.findUnique({ where: { id: req.params.productId } });
    if (!product) {
      return res.status(404).json({ detail: 'Product not found' });
    }
    if (body.category_id && !(await categoryExists(body.category_id))) {
      return res.status(400).json({ detail: 'Invalid category' });
    }

    const uploaded = await imageFromRequest(req, {
      file: 'image',
      base64: 'image_base64',
      nameHint: `product_${body.name ?? product.name}`,
    });
    const imageUrl = uploaded ?? body.image_url ?? product.imageUrl;

    // Save first; the old image is deleted only once nothing points at it.
    let updated;
    try {
      updated = await prisma.product.update({
        where: { id: product.id },
        data: {
          name: body.name,
          description: body.description === undefined ? undefined : body.description || null,
          price: body.price,
          stock: body.stock,
          categoryId: body.category_id || undefined,
          imageUrl,
        },
      });
    } catch (error) {
      if (uploaded) await r2Client.deleteFile(uploaded);
      throw error;
    }
    if (product.imageUrl && product.imageUrl !== imageUrl) {
      await r2Client.deleteFile(product.imageUrl);
    }

    return res.status(200).json(toProductRead(updated));
  } catch (error) {
    handleError(error, res, next);
  }
});

// DELETE /admin/products/:productId
router.delete('/:productId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.productId } });
    if (!product) {
      return res.status(404).json({ detail: 'Product not found' });
    }

    // Cart rows for this product go with it (onDelete: Cascade); past orders keep their copy.
    await prisma.product.delete({ where: { id: product.id } });
    if (product.imageUrl) await r2Client.deleteFile(product.imageUrl);
    return res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
