import { BoltCosmWasmClient } from "@bolt-liquidity-hq/cosmwasm-client";

export type BoltClientParams = {
  boltClient?: BoltCosmWasmClient;
  environment?: "mainnet" | "testnet";
  rpcEndpoint?: string;
  restEndpoint?: string;
};
