import { BoltSuiClient } from "@bolt-liquidity-hq/sui-client";
import CetusClmmSDK from "@cetusprotocol/sui-clmm-sdk";
import { Ed25519Keypair } from "@mysten/sui/dist/cjs/keypairs/ed25519";

import { TransactionRepository } from "../../database";

export type SuiConfig = {
  rebalanceThresholdPercent: number;
  cetusPool: {
    id: string;
  };
  cetusPosition: {
    id: string;
    bandPercentage: number;
  };
};

export type MakeSuiLiquidityManagerParams = {
  environment?: "mainnet" | "testnet";
  configFilePath?: string;
  rpcEndpointsOverride?: Record<string, string>;
  restEndpointsOverride?: Record<string, string>;
};

export type SuiLiquidityManagerConfig = MakeSuiLiquidityManagerParams & {
  config: SuiConfig;
  configPath: string;
  signer: Ed25519Keypair;
  address: string;
  database: TransactionRepository;
  cetusSdk: CetusClmmSDK;
  boltClient: BoltSuiClient;
};
