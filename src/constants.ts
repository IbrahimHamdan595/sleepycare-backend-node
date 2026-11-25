// Values shared by validation, routes and tests.

/** Lebanon's governorates, as offered at checkout. */
export const GOVERNORATES = [
  'Akkar',
  'Baalbek-Hermel',
  'Beirut',
  'Beqaa',
  'Mount Lebanon',
  'Nabatieh',
  'North Lebanon',
  'South Lebanon',
] as const;

/** The only payment method until a payment provider is added. */
export const PAYMENT_METHOD = 'cash_on_delivery';
