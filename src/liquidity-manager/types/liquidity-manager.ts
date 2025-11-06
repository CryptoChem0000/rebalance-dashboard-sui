import { OfflineSigner } from "@cosmjs/proto-signing";

import { TokenAmount } from "../../account-balances";
import { SQLiteTransactionRepository } from "../../database";
import { AbstractKeyStore } from "../../key-manager";
import {
  PoolInfoResponse,
  PositionInfoResponse,
  PositionRangeResult,
} from "../../osmosis-integration";

export type Config = {
  rebalanceThresholdPercent: number;
  osmosisPool: {
    id: string;
    token0: string;
    token1: string;
    tickSpacing: number;
    spreadFactor: number;
  };
  osmosisPosition: {
    id: string;
    bandPercentage: number;
  };
};

export type MakeLiquidityManagerParams = {
  environment?: "mainnet" | "testnet";
  configFilePath?: string;
  rpcEndpointsOverride?: Record<string, string>;
  restEndpointsOverride?: Record<string, string>;
};

export type LiquidityManagerConfig = MakeLiquidityManagerParams & {
  config: Config;
  configPath: string;
  archwaySigner: OfflineSigner;
  osmosisSigner: OfflineSigner;
  osmosisAddress: string;
  database: SQLiteTransactionRepository;
  keyStore: AbstractKeyStore;
};

export type PositionCreationResult = {
  positionId: string;
  tokenAmount0: TokenAmount;
  tokenAmount1: TokenAmount;
  liquidityCreated: string;
  lowerTick: string;
  upperTick: string;
};

export type RebalanceResult = {
  poolId: string;
  positionId: string;
  action: "created" | "rebalanced" | "none";
  message: string;
  error?: string;
};

export type StatusResponse = {
  poolInfo?: PoolInfoResponse;
  positionInfo?: PositionInfoResponse;
  positionRange?: PositionRangeResult;
  positionUpperPrice?: string;
  positionLowerPrice?: string;
};

export type WithdrawPositionResponse = {
  amount0Withdrawn: TokenAmount;
  amount1Withdrawn: TokenAmount;
};
