-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "product_name" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "delivery_fee" DECIMAL(10,2),
ADD COLUMN     "payment_method" TEXT NOT NULL DEFAULT 'cash_on_delivery',
ADD COLUMN     "shipping_address" TEXT,
ADD COLUMN     "shipping_city" TEXT,
ADD COLUMN     "shipping_governorate" TEXT,
ADD COLUMN     "shipping_name" TEXT,
ADD COLUMN     "shipping_notes" TEXT,
ADD COLUMN     "shipping_phone" TEXT,
ADD COLUMN     "subtotal" DECIMAL(10,2),
ADD COLUMN     "tax" DECIMAL(10,2);

-- One status list for the shop and admin: "completed" is now "delivered".
UPDATE "orders" SET "status" = 'delivered' WHERE "status" = 'completed';
