import { OfflineSigner } from "@cosmjs/proto-signing";
import { BigNumber } from "bignumber.js";
import { Pool } from "osmojs/osmosis/concentratedliquidity/v1beta1/pool";
import {
  MsgCreatePositionResponse,
  MsgWithdrawPositionResponse,
} from "osmojs/osmosis/concentratedliquidity/v1beta1/tx";
import { MsgCreateConcentratedPoolResponse } from "osmojs/osmosis/concentratedliquidity/poolmodel/concentrated/v1beta1/tx";
import { SpotPriceResponse } from "osmojs/osmosis/poolmanager/v1beta1/query";
import { osmosis } from "osmojs";

import { getPairPriceOnOsmosis } from "../prices";
import { findOsmosisTokensMap } from "../registry";
import { OsmosisTickMath } from "./tick-math";
import { getSignerAddress } from "../utils";
import { simulateFees } from "./utils";

import {
  AuthorizedTickSpacing,
  CreatePoolParams,
  CreatePositionParams,
  CreatePositionResponse,
  OsmosisQueryClient,
  OsmosisSigningClient,
  PoolInfoResponse,
  PositionInfoResponse,
  PositionRangeResult,
  WithdrawPositionParams,
} from "./types";

export class OsmosisCLPool {
  public token0?: string;
  public token1?: string;

  constructor(
    public poolId: string,
    public queryClient: OsmosisQueryClient,
    public signer: OfflineSigner,
    public signingClient: OsmosisSigningClient,
    public environment: "mainnet" | "testnet" = "mainnet",
    token0?: string,
    token1?: string
  ) {
    this.token0 = token0;
    this.token1 = token1;
  }

  static async createPool(
    queryClient: OsmosisQueryClient,
    signer: OfflineSigner,
    signingClient: OsmosisSigningClient,
    params: CreatePoolParams,
    memo: string = ""
  ): Promise<OsmosisCLPool> {
    const sender = await getSignerAddress(signer);

    const msg =
      osmosis.concentratedliquidity.poolmodel.concentrated.v1beta1.MessageComposer.withTypeUrl.createConcentratedPool(
        {
          denom0: params.token0,
          denom1: params.token1,
          sender,
          spreadFactor: BigNumber(params.spreadFactor).toFixed(),
          tickSpacing: BigInt(params.tickSpacing),
        }
      );

    const fees = await simulateFees(signingClient, sender, [msg], memo);

    const response = await signingClient.signAndBroadcast(
      sender,
      [msg],
      fees,
      memo
    );

    if (!response.msgResponses?.[0]?.value) {
      throw new Error("No valid response from the Create Pool transaction");
    }

    const parsedResponse = MsgCreateConcentratedPoolResponse.decode(
      response.msgResponses[0].value
    );

    const newPoolId = BigNumber(parsedResponse.poolId).toFixed();

    return new OsmosisCLPool(
      newPoolId,
      queryClient,
      signer,
      signingClient,
      params.environment ?? "mainnet",
      params.token0,
      params.token1
    );
  }

  async createPosition(
    params: CreatePositionParams,
    memo: string = ""
  ): Promise<CreatePositionResponse> {
    const sender = await getSignerAddress(this.signer);

    const msg =
      osmosis.concentratedliquidity.v1beta1.MessageComposer.withTypeUrl.createPosition(
        {
          poolId: BigInt(this.poolId),
          sender,
          lowerTick: BigInt(params.lowerTick),
          upperTick: BigInt(params.upperTick),
          tokensProvided: params.tokensProvided,
          tokenMinAmount0: params.tokenMinAmount0,
          tokenMinAmount1: params.tokenMinAmount1,
        }
      );

    const fees = await simulateFees(this.signingClient, sender, [msg], memo);

    const response = await this.signingClient.signAndBroadcast(
      sender,
      [msg],
      fees,
      memo
    );

    if (!response.msgResponses?.[0]?.value) {
      throw new Error("No valid response from the Create Position transaction");
    }

    const parsedResponse = MsgCreatePositionResponse.decode(
      response.msgResponses[0].value
    );

    return {
      positionId: BigNumber(parsedResponse.positionId).toFixed(),
      amount0: parsedResponse.amount0,
      amount1: parsedResponse.amount1,
      liquidityCreated: parsedResponse.liquidityCreated,
      lowerTick: BigNumber(parsedResponse.lowerTick).toFixed(),
      upperTick: BigNumber(parsedResponse.upperTick).toFixed(),
    };
  }

  async withdrawPosition(
    params: WithdrawPositionParams,
    memo: string = ""
  ): Promise<MsgWithdrawPositionResponse> {
    const sender = await getSignerAddress(this.signer);

    const msg =
      osmosis.concentratedliquidity.v1beta1.MessageComposer.withTypeUrl.withdrawPosition(
        {
          positionId: BigInt(params.positionId),
          sender,
          liquidityAmount: params.liquidityAmount,
        }
      );

    const fees = await simulateFees(
      this.signingClient,
      sender,
      [msg],
      memo,
      "high"
    );

    const response = await this.signingClient.signAndBroadcast(
      sender,
      [msg],
      fees,
      memo
    );

    if (!response.msgResponses?.[0]?.value) {
      throw new Error(
        "No valid response from the Withdraw Position transaction"
      );
    }

    return MsgWithdrawPositionResponse.decode(response.msgResponses[0].value);
  }

  async getPoolInfo(): Promise<PoolInfoResponse> {
    const response = await this.queryClient.osmosis.poolmanager.v1beta1.pool({
      poolId: BigInt(this.poolId),
    });

    if (
      response.pool?.$typeUrl !== "/osmosis.concentratedliquidity.v1beta1.Pool"
    ) {
      throw new Error(
        `Pool ${this.poolId} isn't a Concentrated Liquidity Pool`
      );
    }

    const pool = response.pool as Pool;

    this.token0 = pool.token0;
    this.token1 = pool.token1;

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
      tickSpacing: BigNumber(pool.tickSpacing).toFixed(9),
      exponentAtPriceOne: BigNumber(pool.exponentAtPriceOne).toFixed(),
      spreadFactor: pool.spreadFactor,
      lastLiquidityUpdate: pool.lastLiquidityUpdate,
    };
  }

  async getPoolSpotPrice(): Promise<SpotPriceResponse> {
    const { token0, token1 } = await this.getToken0Token1();

    return await this.queryClient.osmosis.poolmanager.v1beta1.spotPrice({
      poolId: BigInt(this.poolId),
      baseAssetDenom: token0,
      quoteAssetDenom: token1,
    });
  }

  async getPositionInfo(positionId: string): Promise<PositionInfoResponse> {
    const result =
      await this.queryClient.osmosis.concentratedliquidity.v1beta1.positionById(
        {
          positionId: BigInt(positionId),
        }
      );

    return {
      position: {
        positionId: BigNumber(result.position.position.positionId).toFixed(),
        address: result.position.position.address,
        poolId: BigNumber(result.position.position.poolId).toFixed(),
        lowerTick: BigNumber(result.position.position.lowerTick).toFixed(),
        upperTick: BigNumber(result.position.position.upperTick).toFixed(),
        joinTime: result.position.position.joinTime,
        liquidity: result.position.position.liquidity,
      },
      asset0: result.position.asset0,
      asset1: result.position.asset1,
      claimableSpreadRewards: result.position.claimableSpreadRewards,
      claimableIncentives: result.position.claimableIncentives,
      forfeitedIncentives: result.position.forfeitedIncentives,
    };
  }

  async isPositionInRange(
    positionId: string,
    percentageThreshold: number
  ): Promise<PositionRangeResult> {
    const threshold = BigNumber(percentageThreshold);

    // Validate threshold
    if (threshold.lte(50) || threshold.gte(100)) {
      throw new Error("Position balance threshold must be between 50 and 100");
    }

    const { token0, token1 } = await this.getToken0Token1();

    const poolInfo = await this.getPoolInfo();
    const positionInfo = await this.getPositionInfo(positionId);

    const lower = new BigNumber(positionInfo.position.lowerTick);
    const upper = new BigNumber(positionInfo.position.upperTick);

    const osmosisTokenMap = findOsmosisTokensMap(this.environment);
    const token0Registry = osmosisTokenMap[token0];
    const token1Registry = osmosisTokenMap[token1];

    if (!token0Registry || !token1Registry) {
      throw new Error("Token from pair not found on our registry");
    }

    const currentPrice = await getPairPriceOnOsmosis(
      token0Registry,
      token1Registry,
      this.environment
    );

    // Current tick
    const current = new BigNumber(
      OsmosisTickMath.roundToTickSpacing(
        OsmosisTickMath.priceToTick(currentPrice),
        Number(poolInfo.tickSpacing) as AuthorizedTickSpacing
      )
    );

    // Check if in range
    if (current.lt(lower)) {
      return {
        isInRange: false,
        percentageBalance: 0,
      };
    }

    if (current.gt(upper)) {
      return {
        isInRange: false,
        percentageBalance: 100,
      };
    }

    // Calculate position within range (0-100%)
    const rangeSize = upper.minus(lower);
    const distanceFromLower = current.minus(lower);
    const percentageInRange = distanceFromLower.div(rangeSize).times(100);

    // Calculate threshold distances
    const lowerThresholdDistance = new BigNumber(100).minus(threshold); // e.g., 5% for 95% threshold
    const upperThresholdDistance = threshold; // e.g., 95% for 95% threshold

    // Check if position exceeds threshold in either direction
    const exceededLowerThreshold = percentageInRange.lte(
      lowerThresholdDistance
    );
    const exceededUpperThreshold = percentageInRange.gte(
      upperThresholdDistance
    );

    return {
      isInRange: !exceededLowerThreshold && !exceededUpperThreshold,
      percentageBalance: Number(percentageInRange.toFixed(6)),
    };
  }

  private async getToken0Token1(): Promise<{ token0: string; token1: string }> {
    if (!this.token0 || !this.token1) {
      await this.getPoolInfo();

      if (!this.token0 || !this.token1) {
        throw new Error("Token pair denoms not found");
      }
    }

    return {
      token0: this.token0,
      token1: this.token1,
    };
  }
}
