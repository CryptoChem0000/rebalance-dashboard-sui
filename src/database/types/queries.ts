import type { SQLiteTransactionRepository } from "../account-transactions";

export interface DatabaseQueriesConfig {
  database: SQLiteTransactionRepository;
  osmosisAddress: string;
}

export interface MakeDatabaseQueriesParams {
  environment: "mainnet" | "testnet";
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
