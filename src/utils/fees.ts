import { BigNumber } from "bignumber.js";

import { TokenAmount } from "../account-balances/token-amount";
import { RegistryToken } from "../registry";

export const assertEnoughBalanceForFees = (
  balances: Record<string, TokenAmount>,
  nativeToken: RegistryToken,
  fees: BigNumber.Value,
  description?: string
): void => {
  if (
    !balances[nativeToken.denom] ||
    BigNumber(balances[nativeToken.denom]!.amount).lt(fees)
  ) {
    throw new Error(
      `Not enough ${
        nativeToken.name ?? nativeToken.denom
      } balance for paying gas fees${description ? ` - ${description}` : ""}`
    );
  }
};
