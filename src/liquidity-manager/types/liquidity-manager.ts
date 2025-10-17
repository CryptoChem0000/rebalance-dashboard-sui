import { OfflineSigner } from "@cosmjs/proto-signing";

import { TokenAmount } from "../../account-balances";
import { SQLiteTransactionRepository } from "../../database";
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

export type LiquidityManagerConfig = {
  config: Config;
  configPath: string;
  archwaySigner: OfflineSigner;
  osmosisSigner: OfflineSigner;
  osmosisAddress: string;
  environment?: "mainnet" | "testnet";
  rpcEndpointsOverride?: Record<string, string>;
  restEndpointsOverride?: Record<string, string>;
  database: SQLiteTransactionRepository;
};

export type PositionCreationResult = {
  positionId: string;
  amount0: string;
  amount1: string;
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
