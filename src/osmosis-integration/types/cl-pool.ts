import { Coin } from "@cosmjs/proto-signing";
import {
  MsgCollectSpreadRewardsResponse,
  MsgWithdrawPositionResponse,
} from "osmojs/osmosis/concentratedliquidity/v1beta1/tx";

import { TokenAmount } from "../../account-balances";
import type { OsmosisCLPool } from "../osmosis-cl-pool";

// TODO: load from chain and validate on pool creation
export type AuthorizedTickSpacing = 1 | 10 | 100 | 1000;
export type AuthorizedSpreadFactors =
  // | "0"
  // | "100000000000000" // 0.01%
  // | "500000000000000" // 0.05%
  // | "1000000000000000" // 0.1%
  // | "2000000000000000" // 0.2%
  // | "3000000000000000" // 0.3%
  // | "5000000000000000" // 0.5%
  // | "10000000000000000" // 1%
  // | "25000000000000000"; // 2.5%
  0 | 0.0001 | 0.0005 | 0.001 | 0.002 | 0.003 | 0.005 | 0.01 | 0.025;

export type CreatePoolParams = {
  token0: string;
  token1: string;
  tickSpacing: AuthorizedTickSpacing;
  spreadFactor: AuthorizedSpreadFactors;
  environment?: "mainnet" | "testnet";
};

export type CreatePoolResponse = {
  pool: OsmosisCLPool;
  txHash: string;
  gasFees?: TokenAmount;
};

export type CreatePositionParams = {
  lowerTick: string;
  upperTick: string;
  tokensProvided: Coin[];
  tokenMinAmount0: string;
  tokenMinAmount1: string;
};

export type CreatePositionResponse = {
  positionId: string;
  tokenAmount0: TokenAmount;
  tokenAmount1: TokenAmount;
  liquidityCreated: string;
  lowerTick: string;
  upperTick: string;
  txHash: string;
  gasFees?: TokenAmount;
};

export type WithdrawPositionParams = {
  positionId: string;
  liquidityAmount: string;
};

export type WithdrawPositionResponse = {
  tokenAmount0: TokenAmount;
  tokenAmount1: TokenAmount;
  rewardsCollected?: TokenAmount[];
  txHash: string;
  gasFees?: TokenAmount;
};

export type PoolInfoResponse = {
  address: string;
  incentivesAddress: string;
  spreadRewardsAddress: string;
  id: string;
  currentTickLiquidity: string;
  token0: string;
  token1: string;
  currentSqrtPrice: string;
  currentTick: string;
  tickSpacing: string;
  exponentAtPriceOne: string;
  spreadFactor: string;
  lastLiquidityUpdate: Date;
};

export type PositionInfoResponse = {
  position: PositionDetails;
  asset0: Coin;
  asset1: Coin;
  claimableSpreadRewards: Coin[];
  claimableIncentives: Coin[];
  forfeitedIncentives: Coin[];
};

export type PositionDetails = {
  positionId: string;
  address: string;
  poolId: string;
  lowerTick: string;
  upperTick: string;
  joinTime: Date;
  liquidity: string;
};

export type PositionRangeResult = {
  isInRange: boolean;
  percentageBalance: number;
};
