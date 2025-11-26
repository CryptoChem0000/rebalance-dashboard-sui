export type CreatePositionParams = {
  minPrice: string;
  maxPrice: string;
  token0MaxAmount: string;
  token1MaxAmount: string;
  positionSlippage?: number;
};
