-- AlterTable
ALTER TABLE "account_transactions"
ADD COLUMN     "platform_name" TEXT,
ADD COLUMN     "platform_fee_amount" TEXT,
ADD COLUMN     "platform_fee_token_denom" TEXT,
ADD COLUMN     "platform_fee_token_name" TEXT;

-- CreateIndex
CREATE INDEX "account_transactions_platform_name_timestamp_idx" ON "account_transactions"("platform_name", "timestamp");
