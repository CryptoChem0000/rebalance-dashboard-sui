import { OfflineSigner } from "@cosmjs/proto-signing";

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
  osmosisSigner: OfflineSigner;
  archwaySigner: OfflineSigner;
  environment?: "mainnet" | "testnet";
  rpcEndpointsOverride?: Record<string, string>;
  restEndpointsOverride?: Record<string, string>;
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
