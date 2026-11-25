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

/** Order statuses, in the order an order moves through them. The shop and admin use this one list. */
export const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** The only payment method until a payment provider is added. */
export const PAYMENT_METHOD = 'cash_on_delivery';
