import { Prisma } from '@prisma/client';
import { prisma } from '../database';
import { roundMoney } from '../utils/mappers';

export interface StoreSettings {
  deliveryFee: number;
  freeDeliveryThreshold: number;
  taxRatePercent: number;
}

export interface Quote {
  subtotal: number;
  deliveryFee: number;
  tax: number;
  total: number;
}

/** The values a new database starts with (they match the old checkout page). */
export const DEFAULT_SETTINGS: StoreSettings = {
  deliveryFee: 9.99,
  freeDeliveryThreshold: 35,
  taxRatePercent: 8,
};

/**
 * Totals for an order whose items cost `subtotal`.
 * Delivery is free once the items reach the threshold; tax applies to the items only.
 */
export function quoteOrder(subtotal: number, settings: StoreSettings): Quote {
  const items = roundMoney(subtotal);
  const deliveryFee = items >= settings.freeDeliveryThreshold ? 0 : roundMoney(settings.deliveryFee);
  const tax = roundMoney((items * settings.taxRatePercent) / 100);
  return { subtotal: items, deliveryFee, tax, total: roundMoney(items + deliveryFee + tax) };
}

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * The current settings, or the defaults until an admin first saves them.
 * Reading never writes: several orders arriving at once on a fresh database
 * would otherwise race to create the row.
 */
export async function getStoreSettings(db: Db = prisma): Promise<StoreSettings> {
  const row = await db.storeSettings.findUnique({ where: { id: 'default' } });
  if (!row) return DEFAULT_SETTINGS;
  return {
    deliveryFee: row.deliveryFee.toNumber(),
    freeDeliveryThreshold: row.freeDeliveryThreshold.toNumber(),
    taxRatePercent: row.taxRatePercent.toNumber(),
  };
}

export async function saveStoreSettings(settings: StoreSettings): Promise<StoreSettings> {
  await prisma.storeSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', ...settings },
    update: settings,
  });
  return getStoreSettings();
}
