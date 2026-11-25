import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, quoteOrder } from '../src/services/pricing.service';

describe('quoteOrder', () => {
  it('adds delivery and tax below the free-delivery threshold', () => {
    expect(quoteOrder(30, DEFAULT_SETTINGS)).toEqual({ subtotal: 30, deliveryFee: 9.99, tax: 2.4, total: 42.39 });
  });

  it('makes delivery free once the items reach the threshold', () => {
    expect(quoteOrder(35, DEFAULT_SETTINGS)).toEqual({ subtotal: 35, deliveryFee: 0, tax: 2.8, total: 37.8 });
  });

  it('never returns float noise', () => {
    const quote = quoteOrder(0.1 * 3, { deliveryFee: 0.1, freeDeliveryThreshold: 100, taxRatePercent: 10 });
    expect(quote).toEqual({ subtotal: 0.3, deliveryFee: 0.1, tax: 0.03, total: 0.43 });
  });

  it('follows the settings it is given', () => {
    expect(quoteOrder(20, { deliveryFee: 3, freeDeliveryThreshold: 40, taxRatePercent: 0 })).toEqual({
      subtotal: 20,
      deliveryFee: 3,
      tax: 0,
      total: 23,
    });
  });
});
