import { Coin } from "@cosmjs/proto-signing";
import { DeliverTxResponse } from "@cosmjs/stargate";
import { BigNumber } from "bignumber.js";

import { TokenAmount } from "../account-balances/token-amount";
import { parseStringToCoin } from "./parsers";
import { RegistryToken } from "../registry/types";

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

export const extractGasFees = (
  txResponse: DeliverTxResponse
): Coin | undefined => {
  const eventEntry = txResponse.events
    .find((item) => item.type === "tx")
    ?.attributes.find((item) => item.key === "fee")?.value;

  return eventEntry ? parseStringToCoin(eventEntry) : undefined;
};
