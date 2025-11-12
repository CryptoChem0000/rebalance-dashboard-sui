-- CreateTable
CREATE TABLE "account_transactions" (
    "id" TEXT NOT NULL,
    "signer_address" TEXT NOT NULL,
    "chain_id" TEXT NOT NULL,
    "transaction_type" TEXT NOT NULL,
    "position_id" TEXT,
    "input_amount" TEXT,
    "input_token_denom" TEXT,
    "input_token_name" TEXT,
    "second_input_amount" TEXT,
    "second_input_token_denom" TEXT,
    "second_input_token_name" TEXT,
    "output_amount" TEXT,
    "output_token_denom" TEXT,
    "output_token_name" TEXT,
    "second_output_amount" TEXT,
    "second_output_token_denom" TEXT,
    "second_output_token_name" TEXT,
    "gas_fee_amount" TEXT,
    "gas_fee_token_denom" TEXT,
    "gas_fee_token_name" TEXT,
    "destination_address" TEXT,
    "destination_chain_id" TEXT,
    "tx_hash" TEXT NOT NULL,
    "tx_action_index" INTEGER NOT NULL DEFAULT 0,
    "successful" BOOLEAN NOT NULL,
    "error" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_transactions_transaction_type_timestamp_idx" ON "account_transactions"("transaction_type", "timestamp");

-- CreateIndex
CREATE INDEX "account_transactions_timestamp_idx" ON "account_transactions"("timestamp");

-- CreateIndex
CREATE INDEX "account_transactions_chain_id_timestamp_idx" ON "account_transactions"("chain_id", "timestamp");

-- CreateIndex
CREATE INDEX "account_transactions_chain_id_tx_hash_idx" ON "account_transactions"("chain_id", "tx_hash");

-- CreateIndex
CREATE INDEX "account_transactions_input_token_name_output_token_name_idx" ON "account_transactions"("input_token_name", "output_token_name");

-- CreateIndex
CREATE INDEX "account_transactions_signer_address_timestamp_idx" ON "account_transactions"("signer_address", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "account_transactions_chain_id_tx_hash_tx_action_index_key" ON "account_transactions"("chain_id", "tx_hash", "tx_action_index");
