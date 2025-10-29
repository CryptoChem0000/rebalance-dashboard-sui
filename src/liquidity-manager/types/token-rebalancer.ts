import { OfflineSigner } from "@cosmjs/proto-signing";

import { TokenAmount } from "../../account-balances";
import { SQLiteTransactionRepository } from "../../database";
import { SkipBridging } from "../../ibc-bridging";
import { AbstractKeyStore } from "../../key-manager";
import { RegistryToken } from "../../registry";

export type TokenRebalancerConfig = {
  archwaySigner: OfflineSigner;
  osmosisSigner: OfflineSigner;
  environment: "mainnet" | "testnet";
  skipBridging: SkipBridging;
  database: SQLiteTransactionRepository;
  keyStore: AbstractKeyStore;
};

export type RebalancerOutput = {
  token0: TokenAmount;
  token1: TokenAmount;
};

export type MultiChainTokenBalances = {
  osmosisBalance: TokenAmount;
  archwayBalance: TokenAmount;
  availableOsmosisBalance: BigNumber; // Balance after considering fees if native
  availableArchwayBalance: BigNumber; // Balance after considering fees if native
  totalAvailableBalance: BigNumber; // Total available across both chains
  osmosisToken: RegistryToken;
  archwayToken: RegistryToken;
};
