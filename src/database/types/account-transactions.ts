// Type definitions
export enum TransactionType {
  BOLT_ARCHWAY_SWAP = "bolt_archway_swap",
  CREATE_POOL = "create_pool",
  COLLECT_SPREAD_REWARDS = "collect_spread_rewards",
  CREATE_POSITION = "create_position",
  WITHDRAW_POSITION = "withdraw_position",
  IBC_TRANSFER = "ibc_transfer",
}

export interface AccountTransaction {
  signerAddress: string;
  chainId: string;
  transactionType: TransactionType;
  inputAmount?: string | null;
  inputTokenDenom?: string | null;
  inputTokenName?: string | null;
  secondInputAmount?: string | null;
  secondInputTokenDenom?: string | null;
  secondInputTokenName?: string | null;
  outputAmount?: string | null;
  outputTokenDenom?: string | null;
  outputTokenName?: string | null;
  secondOutputAmount?: string | null;
  secondOutputTokenDenom?: string | null;
  secondOutputTokenName?: string | null;
  gasFeeAmount?: string | null;
  gasFeeTokenDenom?: string | null;
  gasFeeTokenName?: string | null;
  destinationAddress?: string | null;
  destinationChainId?: string | null;
  txHash: string;
  txActionIndex?: number;
  successful: boolean;
  error?: string | null;
  timestamp?: number;
}

export interface AccountTransactionRow
  extends Omit<AccountTransaction, "successful"> {
  successful: number; // SQLite stores boolean as 0/1
}

// Repository interface for future PostgreSQL migration
export interface TransactionRepository {
  addTransaction(tx: AccountTransaction): void;
  addTransactionBatch(txs: AccountTransaction[]): void;
  getTransaction(txHash: string, chainId: string): AccountTransaction | null;
  getTransactionEntries(txHash: string, chainId: string): AccountTransaction[];
  getAccountTransactions(
    signerAddress: string,
    limit?: number,
    offset?: number
  ): AccountTransaction[];
  getTransactionsByType(
    signerAddress: string,
    transactionType: TransactionType,
    limit?: number
  ): AccountTransaction[];
  getAccountStats(signerAddress: string): any;
  close(): void;
}
