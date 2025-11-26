import { OfflineSigner } from "@cosmjs/proto-signing";
import { BigNumber } from "bignumber.js";
import {
  MsgCreatePositionResponse,
  MsgWithdrawPositionResponse,
} from "osmojs/osmosis/concentratedliquidity/v1beta1/tx";
import { SpotPriceResponse } from "osmojs/osmosis/poolmanager/v1beta1/query";
import { getSigningOsmosisClient, osmosis } from "osmojs";

import {
  CreatePositionResult,
  PositionRangeResult,
  WithdrawPositionResult,
} from "../liquidity-manager";
import {
  DEFAULT_OSMOSIS_MAINNET_RPC_ENDPOINT,
  DEFAULT_OSMOSIS_TESTNET_RPC_ENDPOINT,
  findOsmosisTokensMap,
  RegistryToken,
} from "../registry";
import { OsmosisTickMath } from "./tick-math";
import { getSignerAddress, parseCoinToTokenAmount } from "../utils";
import {
  extractGasFees,
  extractPositionInfoResponse,
  extractRewardsCollected,
  getPoolInfoResponse,
  simulateFees,
} from "./utils";

import {
  AuthorizedTickSpacing,
  CreatePositionParams,
  OsmosisQueryClient,
  OsmosisSigningClient,
  PoolInfoResponse,
  PositionInfoResponse,
  WithdrawPositionParams,
} from "./types";

export class OsmosisCLPoolManager {
  constructor(
    public queryClient: OsmosisQueryClient,
    public signer: OfflineSigner,
    public signingClient: OsmosisSigningClient,
    public poolId: string,
    public token0: RegistryToken,
    public token1: RegistryToken,
    public tokensMap: Record<string, RegistryToken>,
    public poolInfo: PoolInfoResponse
  ) {}

  static async make(
    signer: OfflineSigner,
    poolId: string,
    environment: "mainnet" | "testnet" = "mainnet",
    rpcEndpoint?: string
  ): Promise<OsmosisCLPoolManager> {
    const finalRpcEndpoint =
      rpcEndpoint ??
      (environment === "mainnet"
        ? DEFAULT_OSMOSIS_MAINNET_RPC_ENDPOINT
        : DEFAULT_OSMOSIS_TESTNET_RPC_ENDPOINT);
    const queryClient = await osmosis.ClientFactory.createRPCQueryClient({
      rpcEndpoint: finalRpcEndpoint,
    });
    const signingClient = await getSigningOsmosisClient({
      rpcEndpoint: finalRpcEndpoint,
      signer: signer,
    });

    const poolInfo = await getPoolInfoResponse(poolId, queryClient);

    const tokensMap = findOsmosisTokensMap(environment);
    const token0Registry = tokensMap[poolInfo.token0];
    const token1Registry = tokensMap[poolInfo.token1];

    if (!token0Registry || !token1Registry) {
      throw new Error("Pool tokens not found in registry");
    }

    return new OsmosisCLPoolManager(
      queryClient,
      signer,
      signingClient,
      poolId,
      token0Registry,
      token1Registry,
      tokensMap,
      poolInfo
    );
  }

  async createPosition(
    params: CreatePositionParams,
    memo: string = ""
  ): Promise<CreatePositionResult> {
    const sender = await getSignerAddress(this.signer);

    const msg =
      osmosis.concentratedliquidity.v1beta1.MessageComposer.withTypeUrl.createPosition(
        {
          poolId: BigInt(this.poolId),
          sender,
          lowerTick: BigInt(params.lowerTick),
          upperTick: BigInt(params.upperTick),
          tokensProvided: [...params.tokensProvided].sort((a, b) =>
            a.denom.localeCompare(b.denom)
          ),
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
      tokenAmount0: parseCoinToTokenAmount(
        {
          amount: parsedResponse.amount0,
          denom: this.token0.denom,
        },
        this.tokensMap
      ),
      tokenAmount1: parseCoinToTokenAmount(
        {
          amount: parsedResponse.amount1,
          denom: this.token1.denom,
        },
        this.tokensMap
      ),
      liquidityCreated: parsedResponse.liquidityCreated,
      lowerTick: BigNumber(parsedResponse.lowerTick).toFixed(),
      upperTick: BigNumber(parsedResponse.upperTick).toFixed(),
      txHash: response.transactionHash,
      gasFees: extractGasFees(response, this.tokensMap),
    };
  }

  async withdrawPosition(
    params: WithdrawPositionParams,
    memo: string = ""
  ): Promise<WithdrawPositionResult> {
    const sender = await getSignerAddress(this.signer);

    const msg =
      osmosis.concentratedliquidity.v1beta1.MessageComposer.withTypeUrl.withdrawPosition(
        {
          positionId: BigInt(params.positionId),
          sender,
          liquidityAmount: params.liquidityAmount,
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
      throw new Error(
        "No valid response from the Withdraw Position transaction"
      );
    }

    const parsedResponse = MsgWithdrawPositionResponse.decode(
      response.msgResponses[0].value
    );

    return {
      tokenAmount0: parseCoinToTokenAmount(
        {
          amount: parsedResponse.amount0,
          denom: this.token0.denom,
        },
        this.tokensMap
      ),
      tokenAmount1: parseCoinToTokenAmount(
        {
          amount: parsedResponse.amount1,
          denom: this.token1.denom,
        },
        this.tokensMap
      ),
      rewardsCollected: extractRewardsCollected(response, this.tokensMap),
      txHash: response.transactionHash,
      gasFees: extractGasFees(response, this.tokensMap),
    };
  }

  async getPoolInfo(): Promise<PoolInfoResponse> {
    return await getPoolInfoResponse(this.poolId, this.queryClient);
  }

  async getPoolSpotPrice(): Promise<SpotPriceResponse> {
    return await this.queryClient.osmosis.poolmanager.v1beta1.spotPrice({
      poolId: BigInt(this.poolId),
      baseAssetDenom: this.token0.denom,
      quoteAssetDenom: this.token1.denom,
    });
  }

  async getPositionInfo(positionId: string): Promise<PositionInfoResponse> {
    const result =
      await this.queryClient.osmosis.concentratedliquidity.v1beta1.positionById(
        {
          positionId: BigInt(positionId),
        }
      );

    return extractPositionInfoResponse(result.position);
  }

  async getPositions(): Promise<PositionInfoResponse[]> {
    const address = await getSignerAddress(this.signer);

    const result =
      await this.queryClient.osmosis.concentratedliquidity.v1beta1.userPositions(
        {
          address,
          poolId: BigInt(this.poolId),
        }
      );

    return result.positions.map((item) => extractPositionInfoResponse(item));
  }

  async getPoolPrice(): Promise<string> {
    const poolInfo =
      await this.queryClient.osmosis.poolmanager.v1beta1.spotPrice({
        poolId: BigInt(this.poolId),
        baseAssetDenom: this.token0.denom,
        quoteAssetDenom: this.token1.denom,
      });

    return poolInfo.spotPrice;
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

    const poolInfo = await this.getPoolInfo();
    const positionInfo = await this.getPositionInfo(positionId);

    const lower = new BigNumber(positionInfo.position.lowerTick);
    const upper = new BigNumber(positionInfo.position.upperTick);

    const currentPrice = await this.getPoolPrice();

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
}
