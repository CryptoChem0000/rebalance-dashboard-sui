import { Coin } from "@cosmjs/proto-signing";

import { TokenAmount } from "../account-balances";
import { RegistryToken } from "../registry";

export const parseStringToCoin = (value: string): Coin => {
  const match = value.match(/^(\d+)(.*)$/);

  if (match && match[1] && match[2]) {
    return {
      amount: match[1],
      denom: match[2],
    };
  }

  return {
    amount: "0",
    denom: value,
  };
};

export const parseCoinToTokenAmount = (
  value: Coin,
  tokensMap: Record<string, RegistryToken>
): TokenAmount => {
  return new TokenAmount(
    value?.amount ?? 0,
    value && tokensMap[value.denom]
      ? tokensMap[value.denom]!
      : {
          chainId: Object.values(tokensMap)[0]?.chainId ?? "UNKNOWN",
          denom: value.denom,
          name: `UNKNOWN - ${value.denom}`,
          decimals: 0,
        }
  );
};
