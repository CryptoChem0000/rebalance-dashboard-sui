import { DeliverTxResponse } from "@cosmjs/stargate";
import { BigNumber } from "bignumber.js";
import { EncodeObject } from "osmojs";

import { TokenAmount } from "../../account-balances/token-amount";
import { DEFAULT_GAS_MULTIPLIER, NATIVE_TOKEN_DENOM } from "../constants";
import { RegistryToken } from "../../registry";
import { parseCoinToTokenAmount, parseStringToCoin } from "../../utils";

import { OsmosisSigningClient } from "../types";

export const simulateFees = async (
  signingClient: OsmosisSigningClient,
  sender: string,
  messages: EncodeObject[],
  memo: string,
  fees: "low" | "medium" | "high" = "medium",
  gasMultiplier: number = DEFAULT_GAS_MULTIPLIER
) => {
  const CUSTOM_FEE_VALUES = {
    osmosis: {
      low: "30000",
      medium: "100000",
      high: "160000",
    },
  };
  const gasEstimated = await signingClient.simulate(sender, messages, memo);

  return {
    amount: [
      { denom: NATIVE_TOKEN_DENOM, amount: CUSTOM_FEE_VALUES.osmosis[fees] },
    ],
    gas: BigNumber(gasEstimated)
      .times(gasMultiplier)
      .toFixed(0, BigNumber.ROUND_CEIL),
  };
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
