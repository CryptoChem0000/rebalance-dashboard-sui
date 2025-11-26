import {
  AccountStats,
  ProfitabilityByToken,
  TransactionTypeSummary,
  VolumeByToken,
  SignerAddresses,
} from "./queries";

export enum TransactionType {
  BOLT_ARCHWAY_SWAP = "bolt_archway_swap",
  BOLT_SUI_SWAP = "bolt_archway_swap",
  CREATE_POOL = "create_pool",
  COLLECT_SPREAD_REWARDS = "collect_spread_rewards",
  CREATE_POSITION = "create_position",
  WITHDRAW_POSITION = "withdraw_position",
  IBC_TRANSFER = "ibc_transfer",
  WITHDRAW_RECONCILIATION = "withdraw_reconciliation",
}

export interface AccountTransaction {
  signerAddress: string;
  chainId: string;
  transactionType: TransactionType;
  positionId?: string | null;
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

// Repository interface for future PostgreSQL migration
export interface TransactionRepository {
  addTransaction(tx: AccountTransaction): void | Promise<void>;
  addTransactionBatch(txs: AccountTransaction[]): void | Promise<void>;
  getTransaction(
    txHash: string,
    chainId: string
  ): AccountTransaction | null | Promise<AccountTransaction | null>;
  getTransactionEntries(
    txHash: string,
    chainId: string
  ): AccountTransaction[] | Promise<AccountTransaction[]>;
  getAccountTransactions(
    signerAddress: SignerAddresses,
    limit?: number,
    offset?: number,
    startTime?: Date,
    endTime?: Date
  ): AccountTransaction[] | Promise<AccountTransaction[]>;
  getTransactionsByType(
    transactionType: TransactionType,
    signerAddress?: SignerAddresses,
    limit?: number,
    startTime?: Date,
    endTime?: Date
  ): AccountTransaction[] | Promise<AccountTransaction[]>;
  getAccountStats(
    signerAddress: SignerAddresses,
    startTime?: Date,
    endTime?: Date
  ): AccountStats[] | Promise<AccountStats[]>;
  getArchwayBoltVolume(
    signerAddress?: SignerAddresses,
    startTime?: Date,
    endTime?: Date
  ): VolumeByToken[] | Promise<VolumeByToken[]>;
  getOsmosisVolume(
    signerAddress?: SignerAddresses,
    startTime?: Date,
    endTime?: Date
  ): VolumeByToken[] | Promise<VolumeByToken[]>;
  getBridgeVolume(
    signerAddress?: SignerAddresses,
    startTime?: Date,
    endTime?: Date
  ): VolumeByToken[] | Promise<VolumeByToken[]>;
  getProfitability(
    signerAddress?: SignerAddresses,
    startTime?: Date,
    endTime?: Date,
    excludeLastCreatePosition?: boolean
  ): ProfitabilityByToken[] | Promise<ProfitabilityByToken[]>;
  getTransactionTypeSummary(
    signerAddress?: SignerAddresses,
    startTime?: Date,
    endTime?: Date
  ): TransactionTypeSummary[] | Promise<TransactionTypeSummary[]>;
  close(): void | Promise<void>;
}
