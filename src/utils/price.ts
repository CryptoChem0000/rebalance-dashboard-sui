import { BigNumber } from "bignumber.js";

import { RegistryToken } from "../registry";

export const humanReadablePrice = (
  baseSwapPrice: BigNumber.Value,
  token0: RegistryToken,
  token1: RegistryToken
) => {
  return BigNumber(baseSwapPrice)
    .shiftedBy(token0.decimals - token1.decimals)
    .toFixed(token1.decimals);
};
