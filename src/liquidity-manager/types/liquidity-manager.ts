import { BoltSuiClient } from "@bolt-liquidity-hq/sui-client";
import { Coin, OfflineSigner } from "@cosmjs/proto-signing";
import { Ed25519Keypair } from "@mysten/sui/dist/cjs/keypairs/ed25519";

import { TokenAmount } from "../../account-balances";
import { CetusCLPoolManager } from "../../cetus-integration";
import { TransactionRepository } from "../../database";
import { AbstractKeyStore } from "../../key-manager";
import { OsmosisCLPoolManager } from "../../osmosis-integration";

export type Config = {
  rebalanceThresholdPercent: number;
  poolId: string;
  positionId?: string;
  positionBandPercentage: number;
  chain: "osmosis" | "sui";
  slippage?: number; // Slippage tolerance (e.g., 0.01 for 1%, 0.05 for 5%)
};

export type MakeOsmosisLiquidityManagerParams = {
  environment?: "mainnet" | "testnet";
  configFilePath?: string;
  rpcEndpointsOverride?: Record<string, string>;
  restEndpointsOverride?: Record<string, string>;
  config?: Config;
};

export type OsmosisLiquidityManagerConfig =
  MakeOsmosisLiquidityManagerParams & {
    config: Config;
    configFilePath: string;
    archwaySigner: OfflineSigner;
    osmosisSigner: OfflineSigner;
    osmosisAddress: string;
    osmosisPoolManager: OsmosisCLPoolManager;
    database: TransactionRepository;
    keyStore: AbstractKeyStore;
  };

export type MakeSuiLiquidityManagerParams = {
  environment?: "mainnet" | "testnet";
  configFilePath?: string;
  rpcEndpointOverride?: string;
  config?: Config;
};

export type SuiLiquidityManagerConfig = MakeSuiLiquidityManagerParams & {
  config: Config;
  configFilePath: string;
  signer: Ed25519Keypair;
  address: string;
  database: TransactionRepository;
  cetusPoolManager: CetusCLPoolManager;
  boltClient: BoltSuiClient;
};

export type CreatePositionResult = {
  positionId: string;
  tokenAmount0: TokenAmount;
  tokenAmount1: TokenAmount;
  liquidityCreated: string;
  lowerTick: string;
  upperTick: string;
  txHash: string;
  gasFees?: TokenAmount;
};

export type RebalanceResult = {
  poolId: string;
  positionId: string;
  action: "created" | "rebalanced" | "none";
  message: string;
  error?: string;
};

export type PositionRangeResult = {
  isInRange: boolean;
  percentageBalance: number;
};

export type StatusPoolInfo = {
  id: string;
  token0: string;
  token1: string;
  currentTick: string;
  tickSpacing: string;
  spreadFactor: string;
};

export type StatusPositionInfo = {
  id: string;
  lowerTick: string;
  upperTick: string;
  lowerPrice: string;
  upperPrice: string;
  liquidity: string;
  asset0: Coin;
  asset1: Coin;
  range: PositionRangeResult;
};

export type StatusResponse = {
  poolInfo?: StatusPoolInfo;
  positionInfo?: StatusPositionInfo;
};

export type WithdrawPositionResult = {
  tokenAmount0: TokenAmount;
  tokenAmount1: TokenAmount;
  rewardsCollected?: TokenAmount[];
  txHash: string;
  gasFees?: TokenAmount;
};
