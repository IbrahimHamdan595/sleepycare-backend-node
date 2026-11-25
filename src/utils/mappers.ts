import {
  CartItem,
  Category,
  Order,
  OrderItem,
  Partner,
  Prisma,
  Product,
  Transaction,
  User,
} from '@prisma/client';
import { CartItemRead } from '../schemas/cart.schema';
import { CategoryRead } from '../schemas/category.schema';
import { OrderRead } from '../schemas/order.schema';
import { PartnerRead } from '../schemas/partner.schema';
import { ProductRead } from '../schemas/product.schema';
import { TransactionRead } from '../schemas/transaction.schema';
import { UserRead } from '../schemas/user.schema';

// Database rows -> the snake_case JSON shapes the frontend already expects.
// Money columns are Postgres DECIMALs; the API keeps returning plain numbers.

const money = (value: Prisma.Decimal): number => value.toNumber();

/** Rounds to cents, to avoid storing float noise such as 0.30000000000000004. */
export const roundMoney = (value: number): number => Math.round(value * 100) / 100;

export function toUserRead(user: User): UserRead {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    provider: user.provider,
    created_at: user.createdAt.toISOString(),
  };
}

export function toCategoryRead(category: Category): CategoryRead {
  return {
    id: category.id,
    name: category.name,
    description: category.description,
    icon: category.icon,
  };
}

export function toProductRead(product: Product): ProductRead {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    price: money(product.price),
    stock: product.stock,
    image_url: product.imageUrl,
    category_id: product.categoryId,
  };
}

export function toPartnerRead(partner: Partner): PartnerRead {
  return {
    id: partner.id,
    name: partner.name,
    icon: partner.icon,
    created_at: partner.createdAt.toISOString(),
    updated_at: partner.updatedAt.toISOString(),
  };
}

export function toCartRead(item: CartItem): CartItemRead {
  return {
    id: item.id,
    user_id: item.userId,
    product_id: item.productId,
    quantity: item.quantity,
  };
}

export function toOrderRead(order: Order & { items: OrderItem[] }): OrderRead {
  return {
    id: order.id,
    user_id: order.userId,
    status: order.status,
    total_amount: money(order.totalAmount),
    created_at: order.createdAt.toISOString(),
    items: order.items.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
      unit_price: money(item.unitPrice),
    })),
  };
}

export function toTransactionRead(transaction: Transaction): TransactionRead {
  return {
    id: transaction.id,
    order_id: transaction.orderId,
    user_id: transaction.userId,
    amount: money(transaction.amount),
    payment_method: transaction.paymentMethod,
    status: transaction.status,
    created_at: transaction.createdAt.toISOString(),
  };
}
