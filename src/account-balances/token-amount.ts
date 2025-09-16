import { BigNumber } from "bignumber.js";

import { RegistryToken } from "../registry";

export class TokenAmount {
  constructor(public amount: string, public token: RegistryToken) {}

  get humanReadableAmount(): string {
    return BigNumber(this.amount || 0)
      .shiftedBy(-this.token.decimals)
      .toFixed();
  }

  public static makeFromHumanReadableAmount(
    amount: BigNumber.Value,
    tokenDenom: RegistryToken
  ): TokenAmount {
    return new TokenAmount(
      BigNumber(amount || 0)
        .shiftedBy(tokenDenom.decimals)
        .toFixed(),
      tokenDenom
    );
  }
}
