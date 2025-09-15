import { Coin } from "@cosmjs/proto-signing";

export type CreatePoolParams = {
  token0: string;
  token1: string;
  tickSpacing: AuthorizedTickSpacing;
  spreadFactor: AuthorizedSpreadFactors;
};

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

export type CreatePositionParams = {
  lowerTick: string;
  upperTick: string;
  tokensProvided: Coin[];
  tokenMinAmount0: string;
  tokenMinAmount1: string;
};

export type CreatePositionResponse = {
  positionId: string;
  amount0: string;
  amount1: string;
  liquidityCreated: string;
  lowerTick: string;
  upperTick: string;
};

export type WithdrawPositionParams = {
  positionId: string;
  liquidityAmount: string;
};
