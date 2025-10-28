import { DeliverTxResponse } from "@cosmjs/stargate";

import { TokenAmount } from "../../account-balances";
import { RegistryToken } from "../../registry";
import { parseCoinToTokenAmount, parseStringToCoin } from "../../utils";

export const extractRewardsCollected = (
  txResponse: DeliverTxResponse,
  tokensMap: Record<string, RegistryToken>
): TokenAmount[] | undefined => {
  const COLLECT_SPREAD_REWARDS_EVENT_TYPE = "collect_spread_rewards";
  const TOKENS_OUT_EVENT_ATTRIBUTE_KEY = "tokens_out";

  const eventEntry = txResponse.events
    .find((item) => item.type === COLLECT_SPREAD_REWARDS_EVENT_TYPE)
    ?.attributes.find(
      (item) => item.key === TOKENS_OUT_EVENT_ATTRIBUTE_KEY
    )?.value;

  return eventEntry
    ? eventEntry
        .split(",")
        .map((item) =>
          parseCoinToTokenAmount(parseStringToCoin(item), tokensMap)
        )
    : undefined;
};
