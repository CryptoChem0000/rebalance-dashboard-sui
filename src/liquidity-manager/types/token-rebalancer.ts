import { OfflineSigner } from "@cosmjs/proto-signing";

import { TokenAmount } from "../../account-balances";
import { SQLiteTransactionRepository } from "../../database";
import { SkipBridging } from "../../ibc-bridging";

export type TokenRebalancerConfig = {
  archwaySigner: OfflineSigner;
  osmosisSigner: OfflineSigner;
  environment: "mainnet" | "testnet";
  skipBridging: SkipBridging;
  database: SQLiteTransactionRepository;
};

export type RebalancerOutput = {
  token0: TokenAmount;
  token1: TokenAmount;
  osmosisBalances: Record<string, TokenAmount>;
};
