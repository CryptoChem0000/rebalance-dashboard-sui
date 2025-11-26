import { TransactionRepository } from "./transaction-repository";

export interface DatabaseQueriesConfig {
  database: TransactionRepository;
  addresses: string[];
}

export interface MakeDatabaseQueriesParams {
  environment: "mainnet" | "testnet";
  chain: "osmosis" | "sui";
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

// Add type for multi-address parameters
export type SignerAddresses = string | string[];
