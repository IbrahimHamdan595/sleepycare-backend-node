import { Router, Request, Response, NextFunction } from 'express';
import { getStoreSettings } from '../services/pricing.service';
import { toSettingsRead } from '../utils/mappers';

const router = Router();

// GET /settings — public, so the cart and checkout can show the delivery fee and tax.
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    return res.status(200).json(toSettingsRead(await getStoreSettings()));
  } catch (error) {
    next(error);
  }
});

export default router;
