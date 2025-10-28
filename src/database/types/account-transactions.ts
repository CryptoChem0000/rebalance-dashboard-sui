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

export interface VolumeByToken {
  tokenName: string;
  totalVolume: number;
  totalSwaps?: number;
  totalOperations?: number;
  totalTransfers?: number;
}

export interface ProfitabilityByToken {
  tokenName: string;
  totalSent: number;
  totalReceived: number;
  netBalance: number;
  roiPercentage: number | null;
}

export interface TransactionTypeSummary {
  transactionType: string;
  totalCount: number;
  successCount: number;
  failedCount: number;
  successRate: number;
}

export interface AccountStats {
  transactionType: string;
  count: number;
  successfulCount: number;
  successRate: number;
  firstTransaction: number;
  lastTransaction: number;
}

// Repository interface for future PostgreSQL migration
export interface TransactionRepository {
  addTransaction(tx: AccountTransaction): void;
  addTransactionBatch(txs: AccountTransaction[]): void;
  getTransaction(txHash: string, chainId: string): AccountTransaction | null;
  getTransactionEntries(txHash: string, chainId: string): AccountTransaction[];
  getAccountTransactions(
    limit?: number,
    offset?: number,
    startTime?: Date,
    endTime?: Date
  ): AccountTransaction[];
  getTransactionsByType(
    transactionType: TransactionType,
    limit?: number,
    startTime?: Date,
    endTime?: Date
  ): AccountTransaction[];
  getAccountStats(startTime?: Date, endTime?: Date): AccountStats[];
  getArchwayBoltVolume(startTime?: Date, endTime?: Date): VolumeByToken[];
  getOsmosisVolume(startTime?: Date, endTime?: Date): VolumeByToken[];
  getBridgeVolume(startTime?: Date, endTime?: Date): VolumeByToken[];
  getProfitability(startTime?: Date, endTime?: Date): ProfitabilityByToken[];
  getTransactionTypeSummary(
    startTime?: Date,
    endTime?: Date
  ): TransactionTypeSummary[];
  close(): void;
}
