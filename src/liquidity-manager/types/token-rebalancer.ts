import { OfflineSigner } from "@cosmjs/proto-signing";

import { TokenAmount } from "../../account-balances";
import { SkipBridging } from "../../ibc-bridging";

export type TokenRebalancerConfig = {
  archwaySigner: OfflineSigner;
  osmosisSigner: OfflineSigner;
  environment: "mainnet" | "testnet";
  skipBridging: SkipBridging;
};

export type TokenPairBalances = {
  token0: TokenAmount;
  token1: TokenAmount;
};
