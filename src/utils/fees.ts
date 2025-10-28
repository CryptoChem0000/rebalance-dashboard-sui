import { Coin } from "@cosmjs/proto-signing";
import { DeliverTxResponse } from "@cosmjs/stargate";
import { BigNumber } from "bignumber.js";

import { TokenAmount } from "../account-balances/token-amount";
import { parseCoinToTokenAmount, parseStringToCoin } from "./parsers";
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

export const extractGasFeesAsCoin = (
  txResponse: DeliverTxResponse
): Coin | undefined => {
  const TRANSACTION_EVENT_TYPE = "tx";
  const FEE_EVENT_ATTRIBUTE_KEY = "fee";

  const eventEntry = txResponse.events
    .find((item) => item.type === TRANSACTION_EVENT_TYPE)
    ?.attributes.find((item) => item.key === FEE_EVENT_ATTRIBUTE_KEY)?.value;

  return eventEntry ? parseStringToCoin(eventEntry) : undefined;
};

export const extractGasFees = (
  txResponse: DeliverTxResponse,
  tokensMap: Record<string, RegistryToken>
): TokenAmount | undefined => {
  const TRANSACTION_EVENT_TYPE = "tx";
  const FEE_EVENT_ATTRIBUTE_KEY = "fee";

  const eventEntry = txResponse.events
    .find((item) => item.type === TRANSACTION_EVENT_TYPE)
    ?.attributes.find((item) => item.key === FEE_EVENT_ATTRIBUTE_KEY)?.value;

  if (!eventEntry) {
    return;
  }

  const coinValue = parseStringToCoin(eventEntry);

  return parseCoinToTokenAmount(coinValue, tokensMap);
};
