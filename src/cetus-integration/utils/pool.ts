import { DeliverTxResponse } from "@cosmjs/stargate";
import {
  SuiEvent,
  SuiTransactionBlockResponse,
} from "@mysten/sui/dist/cjs/client";
import { BigNumber } from "bignumber.js";

import { TokenAmount } from "../../account-balances";
import { extractGasFees } from "./fees";
import { CreatePositionResult } from "../../liquidity-manager";
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

export const extractPositionDataResponse = (
  txResult: SuiTransactionBlockResponse,
  token0: RegistryToken,
  token1: RegistryToken,
  nativeToken: RegistryToken
): CreatePositionResult => {
  // Extract position ID from events
  const openPositionEventJson = txResult.events?.find(
    (e: SuiEvent) =>
      e.type?.includes("OpenPositionEvent") ||
      (e.parsedJson as Record<string, string> | undefined)?.position !==
        undefined
  )?.parsedJson as Record<string, string> | undefined;
  const positionId = openPositionEventJson?.position ?? "";

  // Extract amounts and liquidity from events
  const addLiquidityEventJson = txResult.events?.find((e: SuiEvent) =>
    e.type?.includes("AddLiquidity")
  )?.parsedJson as Record<string, any> | undefined;
  const amountA = addLiquidityEventJson?.amount_a || "0";
  const amountB = addLiquidityEventJson?.amount_b || "0";
  const liquidity = addLiquidityEventJson?.liquidity || "0";
  const lowerTick = addLiquidityEventJson?.tick_lower?.bits || "0";
  const upperTick = addLiquidityEventJson?.tick_upper?.bits || "0";

  const gasFees = extractGasFees(txResult, nativeToken);

  return {
    positionId,
    tokenAmount0: new TokenAmount(amountA, token0),
    tokenAmount1: new TokenAmount(amountB, token1),
    liquidityCreated: liquidity,
    lowerTick: BigNumber(lowerTick).toFixed(),
    upperTick: BigNumber(upperTick).toFixed(),
    txHash: txResult.digest,
    gasFees,
  };
};
