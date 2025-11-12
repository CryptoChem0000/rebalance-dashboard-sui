import { DeliverTxResponse } from "@cosmjs/stargate";
import { BigNumber } from "bignumber.js";
import { FullPositionBreakdown } from "osmojs/osmosis/concentratedliquidity/v1beta1/position";

import { TokenAmount } from "../../account-balances";
import { RegistryToken } from "../../registry";
import { parseCoinToTokenAmount, parseStringToCoin } from "../../utils";

import { PositionInfoResponse } from "../types";

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

export const extractPositionInfoResponse = (
  onChainData: FullPositionBreakdown
): PositionInfoResponse => {
  return {
    position: {
      positionId: BigNumber(onChainData.position.positionId).toFixed(),
      address: onChainData.position.address,
      poolId: BigNumber(onChainData.position.poolId).toFixed(),
      lowerTick: BigNumber(onChainData.position.lowerTick).toFixed(),
      upperTick: BigNumber(onChainData.position.upperTick).toFixed(),
      joinTime: onChainData.position.joinTime,
      liquidity: onChainData.position.liquidity,
    },
    asset0: onChainData.asset0,
    asset1: onChainData.asset1,
    claimableSpreadRewards: onChainData.claimableSpreadRewards,
    claimableIncentives: onChainData.claimableIncentives,
    forfeitedIncentives: onChainData.forfeitedIncentives,
  };
};
