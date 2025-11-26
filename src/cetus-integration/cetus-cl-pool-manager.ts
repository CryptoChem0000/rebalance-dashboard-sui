import { TickMath } from "@cetusprotocol/common-sdk";
import {
  CalculateAddLiquidityResult,
  CetusClmmSDK,
  CustomRangeParams,
  Pool,
  Position,
  Rewarder,
} from "@cetusprotocol/sui-clmm-sdk";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { normalizeStructTag } from "@mysten/sui/utils";
import { BigNumber } from "bignumber.js";

import { TokenAmount } from "../account-balances";
import { DEFAULT_POSITION_SLIPPAGE } from "./constants";
import {
  CreatePositionResult,
  PositionRangeResult,
  WithdrawPositionResult,
} from "../liquidity-manager";
import {
  ChainInfo,
  DEFAULT_SUI_MAINNET_RPC_ENDPOINT,
  DEFAULT_SUI_TESTNET_RPC_ENDPOINT,
  findSuiChainInfo,
  findSuiTokensMap,
  RegistryToken,
} from "../registry";
import { getSignerAddress, parseCoinToTokenAmount } from "../utils";
import { extractGasFees, extractPositionDataResponse } from "./utils";

import { CreatePositionParams } from "./types";

export class CetusCLPoolManager {
  constructor(
    public cetusSdk: CetusClmmSDK,
    public signer: Ed25519Keypair,
    public signerAddress: string,
    public poolId: string,
    public token0: RegistryToken,
    public token1: RegistryToken,
    public rewarderCoinTypes: string[],
    public tokensMap: Record<string, RegistryToken>,
    public chainInfo: ChainInfo
  ) {}

  static async make(
    signer: Ed25519Keypair,
    poolId: string,
    environment: "mainnet" | "testnet" = "mainnet",
    rpcEndpoint?: string
  ): Promise<CetusCLPoolManager> {
    const signerAddress = await getSignerAddress(signer);
    const innerRpcEndpoint =
      rpcEndpoint ??
      (environment === "mainnet"
        ? DEFAULT_SUI_MAINNET_RPC_ENDPOINT
        : DEFAULT_SUI_TESTNET_RPC_ENDPOINT);

    const cetusSdk = CetusClmmSDK.createSDK({
      env: environment,
      full_rpc_url: innerRpcEndpoint,
    });
    cetusSdk.setSenderAddress(signerAddress);

    const pool = await cetusSdk.Pool.getPool(poolId);

    if (!pool) {
      throw new Error(`Pool ${poolId} not found`);
    }

    const tokensMap = findSuiTokensMap(environment);
    const token0 = tokensMap[normalizeStructTag(pool.coin_type_a)];
    const token1 = tokensMap[normalizeStructTag(pool.coin_type_b)];

    if (!token0 || !token1) {
      throw new Error("Pool tokens not found in registry");
    }

    const rewardCoinTypes = pool.rewarder_infos.map(
      (rewarder: Rewarder) => rewarder.coin_type
    );

    const chainInfo = findSuiChainInfo(environment);

    return new CetusCLPoolManager(
      cetusSdk,
      signer,
      signerAddress,
      poolId,
      token0,
      token1,
      rewardCoinTypes,
      tokensMap,
      chainInfo
    );
  }

  async createPosition(
    params: CreatePositionParams
  ): Promise<CreatePositionResult> {
    const POSITION_SLIPPAGE =
      params.positionSlippage ?? DEFAULT_POSITION_SLIPPAGE;

    // Now use SDK to find the optimal token0 amount that fits within available balances
    const rangeParams: CustomRangeParams = {
      is_full_range: false,
      min_price: params.minPrice,
      max_price: params.maxPrice,
      coin_decimals_a: this.token0.decimals,
      coin_decimals_b: this.token1.decimals,
      price_base_coin: "coin_a",
    };

    let finalToken0ToUse = BigNumber(params.token0MaxAmount);

    let addLiquidityResult =
      await this.cetusSdk.Position.calculateAddLiquidityResultWithPrice({
        add_mode_params: rangeParams,
        pool_id: this.poolId,
        slippage: POSITION_SLIPPAGE,
        coin_amount: finalToken0ToUse.toFixed(0),
        fix_amount_a: true,
      });

    const requiredToken1WithSlippage = BigNumber(
      addLiquidityResult.coin_amount_limit_b
    );

    if (requiredToken1WithSlippage.gt(params.token1MaxAmount)) {
      console.log(
        "Need to reduce token0 amount as we don't have enough token1 with slippage..."
      );

      // Binary search for optimal amount
      let newAmount = BigNumber(finalToken0ToUse);
      let newLiquidityResult: CalculateAddLiquidityResult | undefined =
        undefined;

      for (let i = 0; i < 5; i++) {
        newAmount = newAmount.times(0.9).decimalPlaces(0);
        try {
          const testResult =
            await this.cetusSdk.Position.calculateAddLiquidityResultWithPrice({
              add_mode_params: rangeParams,
              pool_id: this.poolId,
              slippage: POSITION_SLIPPAGE,
              coin_amount: newAmount.toFixed(0),
              fix_amount_a: true,
            });

          const testToken1Required = BigNumber(testResult.coin_amount_limit_b);

          if (testToken1Required.lte(params.token1MaxAmount)) {
            newLiquidityResult = testResult;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (newAmount.gt(0) && newLiquidityResult) {
        finalToken0ToUse = newAmount;
        addLiquidityResult = newLiquidityResult;
        console.log(
          `Adjusted to use ${
            new TokenAmount(finalToken0ToUse, this.token0).humanReadableAmount
          } token0`
        );
      }
    }

    let payload: Transaction | undefined = undefined;
    let payloadCreationAttempts = 0;
    const maxPayloadAttempts = 5;

    while (payloadCreationAttempts < maxPayloadAttempts) {
      try {
        payload =
          await this.cetusSdk.Position.createAddLiquidityFixCoinWithPricePayload(
            {
              pool_id: this.poolId,
              calculate_result: addLiquidityResult,
              add_mode_params: rangeParams,
            }
          );

        break;
      } catch (error: any) {
        if (
          error?.message?.includes("Insufficient balance") ||
          error?.message?.includes("expect")
        ) {
          payloadCreationAttempts++;
          console.warn(
            `Payload creation failed due to insufficient balance (attempt ${payloadCreationAttempts}/${maxPayloadAttempts}). Reducing token0 amount...`
          );

          if (payloadCreationAttempts >= maxPayloadAttempts) {
            throw new Error(
              `Could not create payload after ${maxPayloadAttempts} attempts. Last error: ${error.message}`
            );
          }

          finalToken0ToUse = finalToken0ToUse.times(0.9).decimalPlaces(0);

          addLiquidityResult =
            await this.cetusSdk.Position.calculateAddLiquidityResultWithPrice({
              add_mode_params: rangeParams,
              pool_id: this.poolId,
              slippage: POSITION_SLIPPAGE,
              coin_amount: finalToken0ToUse.toFixed(0),
              fix_amount_a: true,
            });
        } else {
          throw error;
        }
      }
    }

    if (!payload) {
      throw new Error("Failed to create payload");
    }

    const txResult = await this.cetusSdk.FullClient.executeTx(
      this.signer,
      payload,
      false
    );

    if (!txResult || !txResult.events) {
      throw new Error(
        "Transaction execution failed or returned invalid result"
      );
    }

    // Extract results from transaction
    return extractPositionDataResponse(
      txResult,
      this.token0,
      this.token1,
      this.chainInfo.nativeToken
    );
  }

  async withdrawPosition(positionId: string): Promise<WithdrawPositionResult> {
    // Create close position payload
    const closePositionPayload =
      await this.cetusSdk.Position.closePositionPayload({
        coin_type_a: this.token0.denom,
        coin_type_b: this.token1.denom,
        min_amount_a: "0",
        min_amount_b: "0",
        rewarder_coin_types: this.rewarderCoinTypes,
        pool_id: this.poolId,
        pos_id: positionId,
        collect_fee: true,
      });

    // Execute transaction
    const txResult = await this.cetusSdk.FullClient.executeTx(
      this.signer,
      closePositionPayload,
      false
    );

    if (!txResult || !txResult.events) {
      throw new Error(
        "Transaction execution failed or returned invalid result"
      );
    }

    // Extract amounts from events
    let liquidityAmountA = BigNumber(0);
    let liquidityAmountB = BigNumber(0);
    let rewardsAmountA = BigNumber(0);
    let rewardsAmountB = BigNumber(0);
    const otherRewards: TokenAmount[] = [];

    for (const event of txResult.events) {
      if (event.type?.includes("RemoveLiquidity")) {
        liquidityAmountA = liquidityAmountA.plus(
          event.parsedJson?.amount_a || 0
        );
        liquidityAmountB = liquidityAmountB.plus(
          event.parsedJson?.amount_b || 0
        );
      }
      if (event.type?.includes("CollectFee")) {
        rewardsAmountA = rewardsAmountA.plus(event.parsedJson?.amount_a || 0);
        rewardsAmountB = rewardsAmountB.plus(event.parsedJson?.amount_b || 0);
      }
      if (event.type?.includes("CollectReward")) {
        const registryToken =
          this.tokensMap[
            normalizeStructTag(event.parsedJson?.rewarder_type?.name || "")
          ];
        if (registryToken) {
          if (registryToken.denom === this.token0.denom) {
            rewardsAmountA = rewardsAmountA.plus(event.parsedJson?.amount || 0);
          } else if (registryToken.denom === this.token1.denom) {
            rewardsAmountB = rewardsAmountB.plus(event.parsedJson?.amount || 0);
          } else {
            let found = false;
            for (const item of otherRewards) {
              if (item.token.denom === registryToken.denom) {
                item.amount = BigNumber(item.amount)
                  .plus(event.parsedJson?.amount || 0)
                  .toFixed(0);
                found = true;
                break;
              }
            }
            if (!found) {
              otherRewards.push(
                new TokenAmount(event.parsedJson?.amount || 0, registryToken)
              );
            }
          }
        }
      }
    }

    return {
      tokenAmount0: parseCoinToTokenAmount(
        {
          amount: liquidityAmountA.toFixed(0),
          denom: this.token0.denom,
        },
        this.tokensMap
      ),
      tokenAmount1: parseCoinToTokenAmount(
        {
          amount: liquidityAmountB.toFixed(0),
          denom: this.token1.denom,
        },
        this.tokensMap
      ),
      rewardsCollected: [
        ...(rewardsAmountA.gt(0)
          ? [new TokenAmount(rewardsAmountA.toFixed(0), this.token0)]
          : []),
        ...(rewardsAmountB.gt(0)
          ? [new TokenAmount(rewardsAmountB.toFixed(0), this.token1)]
          : []),
        ...otherRewards,
      ],
      txHash: txResult.digest,
      gasFees: extractGasFees(txResult, this.chainInfo.nativeToken),
    };
  }

  async getPoolInfo(): Promise<Pool> {
    return await this.cetusSdk.Pool.getPool(this.poolId);
  }

  async getPoolSpotPrice(): Promise<string> {
    const poolInfo = await this.getPoolInfo();

    const currentPriceHumanReadable = TickMath.sqrtPriceX64ToPrice(
      poolInfo.current_sqrt_price,
      this.token0.decimals,
      this.token1.decimals
    );
    return BigNumber(currentPriceHumanReadable)
      .shiftedBy(this.token1.decimals - this.token0.decimals)
      .toFixed();
  }

  async getPositionInfo(positionId: string): Promise<Position> {
    return await this.cetusSdk.Position.getPositionById(positionId);
  }

  async getPositions(): Promise<Position[]> {
    return await this.cetusSdk.Position.getPositionList(this.signerAddress);
  }

  async isPositionInRange(
    positionId: string,
    percentageThreshold: number,
    positionInfo?: Position
  ): Promise<PositionRangeResult> {
    const threshold = BigNumber(percentageThreshold);

    // Validate threshold
    if (threshold.lte(50) || threshold.gte(100)) {
      throw new Error("Position balance threshold must be between 50 and 100");
    }

    const poolInfo = await this.getPoolInfo();
    const innerPositionInfo =
      positionInfo ?? (await this.getPositionInfo(positionId));

    const lowerTick = BigNumber(innerPositionInfo.tick_lower_index);
    const upperTick = BigNumber(innerPositionInfo.tick_upper_index);
    const currentTick = BigNumber(poolInfo.current_tick_index);

    // Check if out of range
    if (currentTick.lt(lowerTick)) {
      return {
        isInRange: false,
        percentageBalance: 0,
      };
    }

    if (currentTick.gt(upperTick)) {
      return {
        isInRange: false,
        percentageBalance: 100,
      };
    }

    // Calculate position within range (0-100%)
    const rangeSize = upperTick.minus(lowerTick);
    const distanceFromLower = currentTick.minus(lowerTick);
    const percentageInRange = distanceFromLower.div(rangeSize).times(100);

    // Calculate threshold distances
    const lowerThresholdDistance = BigNumber(100).minus(threshold); // e.g., 10% for 90% threshold
    const upperThresholdDistance = threshold; // e.g., 90% for 90% threshold

    // Check if position exceeds threshold in either direction
    const exceededLowerThreshold = percentageInRange.lte(
      lowerThresholdDistance
    );
    const exceededUpperThreshold = percentageInRange.gte(
      upperThresholdDistance
    );

    const isInRange = !exceededLowerThreshold && !exceededUpperThreshold;

    return {
      isInRange,
      percentageBalance: Number(percentageInRange.toFixed(6)),
    };
  }
}
