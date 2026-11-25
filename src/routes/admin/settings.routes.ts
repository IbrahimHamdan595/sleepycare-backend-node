import { Router, Request, Response, NextFunction } from 'express';
import { getCurrentUser, requireAdmin } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { saveStoreSettings } from '../../services/pricing.service';
import { settingsUpdateSchema, SettingsUpdate } from '../../schemas/settings.schema';
import { toSettingsRead } from '../../utils/mappers';

const router = Router();

router.use(getCurrentUser, requireAdmin);

// PUT /admin/settings
router.put('/', validate(settingsUpdateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body: SettingsUpdate = req.body;
    const saved = await saveStoreSettings({
      deliveryFee: body.delivery_fee,
      freeDeliveryThreshold: body.free_delivery_threshold,
      taxRatePercent: body.tax_rate_percent,
    });
    return res.status(200).json(toSettingsRead(saved));
  } catch (error) {
    next(error);
  }
});

export default router;
