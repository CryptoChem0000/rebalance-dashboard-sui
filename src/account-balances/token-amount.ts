import { BigNumber } from "bignumber.js";

import { RegistryToken } from "../registry";

export class TokenAmount {
  public amount: string;

  constructor(amount: BigNumber.Value, public token: RegistryToken) {
    this.amount = BigNumber(amount).toFixed(0, BigNumber.ROUND_FLOOR);
  }

  get humanReadableAmount(): string {
    return BigNumber(this.amount || 0)
      .shiftedBy(-this.token.decimals)
      .toFixed(this.token.decimals);
  }

  public static makeFromHumanReadableAmount(
    amount: BigNumber.Value,
    tokenDenom: RegistryToken
  ): TokenAmount {
    return new TokenAmount(
      BigNumber(amount || 0).shiftedBy(tokenDenom.decimals),
      tokenDenom
    );
  }
}
