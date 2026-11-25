import { Router, Request, Response } from 'express';
import multer from 'multer';
import { getCurrentUser, requireAdmin } from '../../middleware/auth.middleware';
import { prisma, isUniqueViolation } from '../../database';
import { r2Client } from '../../services/storage.service';
import { toProductRead } from '../../utils/mappers';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

async function categoryExists(categoryId: string): Promise<boolean> {
  return (await prisma.category.count({ where: { id: categoryId } })) > 0;
}

// All admin product routes require admin authentication
router.use(getCurrentUser, requireAdmin);

// POST /admin/products
router.post('/', upload.single('image'), async (req: Request, res: Response) => {
  try {
    console.log('=== Product Create Debug ===');
    console.log('req.body:', JSON.stringify(req.body));
    console.log('req.file:', req.file ? { name: req.file.originalname, size: req.file.size, mime: req.file.mimetype } : 'NO FILE');
    console.log('===========================');
    const { name, description, price, stock, category_id, image_base64, image_url } = req.body;

    // Validate required fields (FormData sends strings, so check for empty strings too)
    if (!name || !price || !stock) {
      return res.status(422).json({ detail: 'Missing required fields: name, price, and stock are required' });
    }

    if (category_id && !(await categoryExists(category_id))) {
      return res.status(400).json({ detail: 'Invalid category' });
    }

    let imageUrl: string | null = null;

    // Handle file upload
    if (req.file) {
      const contentType = req.file.mimetype || 'image/jpeg';
      imageUrl = await r2Client.uploadFile(req.file.buffer, req.file.originalname, contentType);
    } else if (image_base64) {
      // Handle base64 upload
      let encoded = image_base64;
      let contentType = 'image/jpeg';

      if (image_base64.includes(',')) {
        const [header, data] = image_base64.split(',', 2);
        encoded = data;
        if (header.includes('image/')) {
          contentType = header.split(';')[0].split(':')[1];
        }
      }

      const fileContent = Buffer.from(encoded, 'base64');
      imageUrl = await r2Client.uploadFile(fileContent, `product_${name}.jpg`, contentType);
    } else if (image_url) {
      // Handle direct image URL (e.g., from presigned upload)
      imageUrl = image_url;
    }

    const product = await prisma.product.create({
      data: {
        name,
        description: description || null,
        price: parseFloat(price),
        stock: parseInt(stock, 10),
        imageUrl,
        categoryId: category_id || null,
      },
    });

    return res.status(201).json(toProductRead(product));
  } catch (error: any) {
    console.error('Create product error:', error);
    if (isUniqueViolation(error)) {
      return res.status(400).json({ detail: 'Product with this name already exists' });
    }
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

// GET /admin/products
router.get('/', async (req: Request, res: Response) => {
  try {
    const products = await prisma.product.findMany({ orderBy: { createdAt: 'asc' } });
    return res.status(200).json(products.map(toProductRead));
  } catch (error) {
    console.error('List products error:', error);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

// GET /admin/products/category/:categoryId
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

// PUT /admin/products/:productId
router.put('/:productId', upload.single('image'), async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const { name, description, price, stock, category_id, image_base64, image_url } = req.body;

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      return res.status(404).json({ detail: 'Product not found !' });
    }

    if (category_id && !(await categoryExists(category_id))) {
      return res.status(400).json({ detail: 'Invalid category' });
    }

    // Collect the changes, then write them in one update at the end.
    // (Check for non-empty strings, because FormData sends everything as text.)
    let imageUrl = product.imageUrl;
    const changes: {
      name?: string;
      description?: string | null;
      price?: number;
      stock?: number;
      categoryId?: string;
    } = {};
    if (name) changes.name = name;
    if (description !== undefined) changes.description = description || null;
    if (price) changes.price = parseFloat(price);
    if (stock) changes.stock = parseInt(stock, 10);
    if (category_id) changes.categoryId = category_id;
    const productName = changes.name ?? product.name;

    // Handle image update
    if (req.file) {
      // Delete old image if exists
      if (imageUrl) {
        await r2Client.deleteFile(imageUrl);
      }
      const contentType = req.file.mimetype || 'image/jpeg';
      imageUrl = await r2Client.uploadFile(
        req.file.buffer,
        req.file.originalname,
        contentType
      );
    } else if (image_base64) {
      // Delete old image if exists
      if (imageUrl) {
        await r2Client.deleteFile(imageUrl);
      }

      let encoded = image_base64;
      let contentType = 'image/jpeg';

      if (image_base64.includes(',')) {
        const [header, data] = image_base64.split(',', 2);
        encoded = data;
        if (header.includes('image/')) {
          contentType = header.split(';')[0].split(':')[1];
        }
      }

      const fileContent = Buffer.from(encoded, 'base64');
      imageUrl = await r2Client.uploadFile(
        fileContent,
        `product_${productName}.jpg`,
        contentType
      );
    } else if (image_url) {
      // Handle direct image URL (e.g., from presigned upload)
      if (imageUrl && imageUrl !== image_url) {
        await r2Client.deleteFile(imageUrl);
      }
      imageUrl = image_url;
    }

    const updated = await prisma.product.update({
      where: { id: product.id },
      data: { ...changes, imageUrl },
    });
    return res.status(200).json(toProductRead(updated));
  } catch (error: any) {
    console.error('Update product error:', error);
    if (isUniqueViolation(error)) {
      return res.status(400).json({ detail: 'Product with this name already exists' });
    }
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

// DELETE /admin/products/:productId
router.delete('/:productId', async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      return res.status(404).json({ detail: 'Product not found' });
    }

    // Cart rows for this product go with it (onDelete: Cascade); past orders keep their copy.
    await prisma.product.delete({ where: { id: product.id } });
    return res.status(204).send();
  } catch (error) {
    console.error('Delete product error:', error);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

export default router;
