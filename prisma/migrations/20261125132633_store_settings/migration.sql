-- CreateTable
CREATE TABLE "store_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "delivery_fee" DECIMAL(10,2) NOT NULL DEFAULT 9.99,
    "free_delivery_threshold" DECIMAL(10,2) NOT NULL DEFAULT 35,
    "tax_rate_percent" DECIMAL(5,2) NOT NULL DEFAULT 8,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_settings_pkey" PRIMARY KEY ("id")
);
