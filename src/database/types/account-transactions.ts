// Type definitions
export enum TransactionType {
  BOLT_ARCHWAY_SWAP = "bolt_archway_swap",
  CREATE_POOL = "create_pool",
  CREATE_POSITION = "create_position",
  WITHDRAW_POSITION = "withdraw_position",
  IBC_TRANSFER = "ibc_transfer",
}

export interface AccountTransaction {
  signerAddress: string;
  chainId: string;
  transactionType: TransactionType;
  inputAmount?: string | null;
  inputToken?: string | null;
  secondInputAmount?: string | null;
  secondInputToken?: string | null;
  outputAmount?: string | null;
  outputToken?: string | null;
  gasFeeAmount?: string | null;
  gasFeeToken?: string | null;
  destinationAddress?: string | null;
  destinationChainId?: string | null;
  txHash: string;
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
  getTransaction(txHash: string, chainId: number): AccountTransaction | null;
  getAccountTransactions(
    signerAddress: string,
    limit?: number,
    offset?: number
  ): AccountTransaction[];
  getTransactionsByType(
    signerAddress: string,
    transactionType: TransactionType, // Updated to use enum
    limit?: number
  ): AccountTransaction[];
  getAccountStats(signerAddress: string): any;
  close(): void;
}
