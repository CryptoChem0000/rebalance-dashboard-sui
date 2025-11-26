import { DeliverTxResponse } from "@cosmjs/stargate";
import { BigNumber } from "bignumber.js";
import { Pool } from "osmojs/osmosis/concentratedliquidity/v1beta1/pool";
import { FullPositionBreakdown } from "osmojs/osmosis/concentratedliquidity/v1beta1/position";

import { TokenAmount } from "../../account-balances";
import { RegistryToken } from "../../registry";
import { parseCoinToTokenAmount, parseStringToCoin } from "../../utils";

import {
  OsmosisQueryClient,
  PoolInfoResponse,
  PositionInfoResponse,
} from "../types";

export const getPoolInfoResponse = async (
  poolId: string,
  queryClient: OsmosisQueryClient
): Promise<PoolInfoResponse> => {
  const response = await queryClient.osmosis.poolmanager.v1beta1.pool({
    poolId: BigInt(poolId),
  });

  if (
    response.pool?.$typeUrl !== "/osmosis.concentratedliquidity.v1beta1.Pool"
  ) {
    throw new Error(`Pool ${poolId} isn't a Concentrated Liquidity Pool`);
  }

  const pool = response.pool as Pool;

  return {
    address: pool.address,
    incentivesAddress: pool.incentivesAddress,
    spreadRewardsAddress: pool.spreadRewardsAddress,
    id: BigNumber(pool.id).toFixed(),
    currentTickLiquidity: pool.currentTickLiquidity,
    token0: pool.token0,
    token1: pool.token1,
    currentSqrtPrice: pool.currentSqrtPrice,
    currentTick: BigNumber(pool.currentTick).toFixed(),
    tickSpacing: BigNumber(pool.tickSpacing).toFixed(),
    exponentAtPriceOne: BigNumber(pool.exponentAtPriceOne).toFixed(),
    spreadFactor: pool.spreadFactor,
    lastLiquidityUpdate: pool.lastLiquidityUpdate,
  };
};

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
