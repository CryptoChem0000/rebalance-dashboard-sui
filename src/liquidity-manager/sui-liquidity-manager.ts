import { BigNumber } from "bignumber.js";
import fs from "fs/promises";
import {
  CalculateAddLiquidityResult,
  CetusClmmSDK,
  CustomRangeParams,
  Pool,
  Position,
} from "@cetusprotocol/sui-clmm-sdk";
import { BoltSuiClient } from "@bolt-liquidity-hq/sui-client";
import { TickMath } from "@cetusprotocol/common-sdk";
import { normalizeStructTag, SUI_TYPE_ARG } from "@mysten/sui/utils";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

import { SuiAccount, TokenAmount } from "../account-balances";
import {
  AccountTransaction,
  PostgresTransactionRepository,
  SQLiteTransactionRepository,
  TransactionRepository,
  TransactionType,
} from "../database";
import { DEFAULT_SUI_KEY_NAME, KeyManager, KeyStoreType } from "../key-manager";
import {
  ChainInfo,
  findSuiChainInfo,
  findSuiTokensMap,
  RegistryToken,
} from "../registry";
import { loadSuiConfigWithEnvOverrides } from "./sui-config-loader";
import { getSignerAddress } from "../utils";

import {
  MakeSuiLiquidityManagerParams,
  PositionCreationResult,
  RebalanceResult,
  StatusResponse,
  SuiConfig,
  SuiLiquidityManagerConfig,
  WithdrawPositionResponse,
} from "./types";

export class SuiLiquidityManager {
  public config: SuiConfig;
  private configPath: string;
  private signer: Ed25519Keypair;
  private address: string;
  private chainInfo: ChainInfo;
  private tokensMap: Record<string, RegistryToken>;
  private environment: "mainnet" | "testnet";
  public database: TransactionRepository;
  private cetusSdk: CetusClmmSDK;
  private boltClient: BoltSuiClient;

  constructor(params: SuiLiquidityManagerConfig) {
    this.config = params.config;
    this.configPath = params.configPath;
    this.signer = params.signer;
    this.address = params.address;
    this.environment = params.environment || "mainnet";
    this.chainInfo = findSuiChainInfo(this.environment);
    this.tokensMap = findSuiTokensMap(this.environment);
    this.database = params.database;
    this.cetusSdk = params.cetusSdk;
    this.boltClient = params.boltClient;
  }

  static async make(
    params: MakeSuiLiquidityManagerParams
  ): Promise<SuiLiquidityManager> {
    const { config, configPath } = await loadSuiConfigWithEnvOverrides(
      params.configFilePath
    );
    const keyStore = await KeyManager.create({
      type: KeyStoreType.ENV_VARIABLE,
    });

    const signer = await keyStore.getSuiSigner(DEFAULT_SUI_KEY_NAME);
    const address = await getSignerAddress(signer);

    const database = await (process.env.DATABASE_URL
      ? PostgresTransactionRepository.make()
      : SQLiteTransactionRepository.make(address));

    const cetusSdk = await CetusClmmSDK.createSDK({});
    cetusSdk.setSenderAddress(address);

    const boltClient = new BoltSuiClient();

    return new SuiLiquidityManager({
      ...params,
      signer,
      address,
      config,
      configPath,
      database,
      cetusSdk,
      boltClient,
    });
  }

  async execute(): Promise<RebalanceResult> {
    console.log("Starting liquidity management execution...");
    let suiBalances = await this.getSuiAccountBalances();

    // Step 0: Check that the pool exists and load info
    console.log(`Checking pool ${this.config.cetusPool.id}...`);
    const pool = await this.cetusSdk.Pool.getPool(this.config.cetusPool.id);
    if (!pool) {
      throw new Error(`Pool ${this.config.cetusPool.id} not found`);
    }
    console.log(`Pool found: ${pool.name}`);

    const token0 = this.tokensMap[normalizeStructTag(pool.coin_type_a)];
    const token1 = this.tokensMap[normalizeStructTag(pool.coin_type_b)];

    if (!token0 || !token1) {
      throw new Error("Pool tokens not found in registry");
    }

    let hadPosition = false;
    let rebalanced = false;

    // Step 1: Check if we have a position and if it needs rebalancing
    if (this.config.cetusPosition.id) {
      console.log(
        `Checking position ${this.config.cetusPosition.id} for rebalancing...`
      );

      try {
        const position = await this.cetusSdk.Position.getPositionById(
          this.config.cetusPosition.id
        );

        if (position) {
          hadPosition = true;
          const isInRange = await this.isPositionInRange(pool, position);

          if (isInRange.isInRange) {
            console.log(
              `Position is in range (${isInRange.percentageBalance.toFixed(
                2
              )}% balance). No rebalancing needed.`
            );
            return {
              poolId: pool.id,
              positionId: this.config.cetusPosition.id,
              action: "none",
              message: `Position in range at ${isInRange.percentageBalance.toFixed(
                2
              )}% balance`,
            };
          }

          console.log(
            `Position out of range (${isInRange.percentageBalance.toFixed(
              2
            )}% balance). Rebalancing needed...`
          );

          // Withdraw position
          console.log("Withdrawing position...");
          await this.withdrawPosition();
          rebalanced = true;
          suiBalances = await this.getSuiAccountBalances();
        }
      } catch (error: any) {
        if (
          error?.message?.includes?.("not found") ||
          error?.message?.includes?.("does not exist")
        ) {
          console.error(
            "Error finding position, it might not exist. Ignoring and creating new position...",
            error
          );
          this.config.cetusPosition.id = "";
          await this.saveConfig();
        } else {
          throw error;
        }
      }
    }

    // Step 2: Create new position
    console.log("Creating new position...");
    const positionResult = await this.createPosition(pool, suiBalances);

    return {
      poolId: pool.id,
      positionId: positionResult.positionId,
      action: hadPosition && rebalanced ? "rebalanced" : "created",
      message: `Position ${positionResult.positionId} created with liquidity ${positionResult.liquidityCreated}`,
    };
  }

  private async isPositionInRange(
    pool: Pool,
    position: Position
  ): Promise<{ isInRange: boolean; percentageBalance: number }> {
    const threshold = BigNumber(this.config.rebalanceThresholdPercent);

    // Validate threshold
    if (threshold.lte(50) || threshold.gte(100)) {
      throw new Error("Position balance threshold must be between 50 and 100");
    }

    const lowerTick = BigNumber(position.tick_lower_index);
    const upperTick = BigNumber(position.tick_upper_index);
    const currentTick = BigNumber(pool.current_tick_index);

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
      percentageBalance: percentageInRange.toNumber(),
    };
  }

  private async createPosition(
    pool: Pool,
    suiBalances?: Record<string, TokenAmount>
  ): Promise<PositionCreationResult> {
    const token0 = this.tokensMap[normalizeStructTag(pool.coin_type_a)];
    const token1 = this.tokensMap[normalizeStructTag(pool.coin_type_b)];

    if (!token0 || !token1) {
      throw new Error("Pool tokens not found in registry");
    }

    // Get current balances
    const innerSuiBalances =
      suiBalances ?? (await this.getSuiAccountBalances());

    const balance0 =
      innerSuiBalances[token0.denom] ?? new TokenAmount(0, token0);
    const balance1 =
      innerSuiBalances[token1.denom] ?? new TokenAmount(0, token1);

    // If any token is native (SUI), discount 0.1 SUI for gas
    const GAS_RESERVE = BigNumber(0.15).times(10 ** 9); // 0.15 SUI in smallest unit
    const nativeTokenDenom = normalizeStructTag(SUI_TYPE_ARG);

    // Create safe balances for calculations (with gas reserve deducted)
    let safeBalance0 = balance0;
    let safeBalance1 = balance1;

    if (token0.denom === nativeTokenDenom) {
      const available = BigNumber(balance0.amount).minus(GAS_RESERVE);
      safeBalance0 = new TokenAmount(
        available.gt(0) ? available.toFixed(0) : "0",
        token0
      );
    }

    if (token1.denom === nativeTokenDenom) {
      const available = BigNumber(balance1.amount).minus(GAS_RESERVE);
      safeBalance1 = new TokenAmount(
        available.gt(0) ? available.toFixed(0) : "0",
        token1
      );
    }

    console.log(
      `Current balances: ${balance0.humanReadableAmount} ${token0.name}, ${balance1.humanReadableAmount} ${token1.name}`
    );
    console.log(
      `Safe balances (after gas reserve): ${safeBalance0.humanReadableAmount} ${token0.name}, ${safeBalance1.humanReadableAmount} ${token1.name}`
    );

    // Get current price from Cetus pool (in human-readable terms)
    const currentPriceHumanReadable = TickMath.sqrtPriceX64ToPrice(
      pool.current_sqrt_price,
      token0.decimals,
      token1.decimals
    );

    // Convert price to smallest on-chain units for calculations
    // Price is token0/token1 in human-readable terms
    // To convert to smallest units: price_smallest = price_human * 10^(token0.decimals - token1.decimals)
    const currentPrice = BigNumber(currentPriceHumanReadable).shiftedBy(
      token1.decimals - token0.decimals
    );

    console.log(
      `Current pool price (human-readable): ${currentPriceHumanReadable.toString()}`
    );
    console.log(
      `Current pool price (smallest units): ${currentPrice.toString()}`
    );

    // Calculate price range for position (before swapping, so we know what ratio we need)
    const bandPercentage = BigNumber(
      this.config.cetusPosition.bandPercentage
    ).div(100);
    const lowerPrice = BigNumber(currentPriceHumanReadable)
      .times(BigNumber(1).minus(bandPercentage))
      .toFixed(token1.decimals);
    const upperPrice = BigNumber(currentPriceHumanReadable)
      .times(BigNumber(1).plus(bandPercentage))
      .toFixed(token1.decimals);

    console.log(
      `Price range: ${lowerPrice} - ${upperPrice} (current: ${currentPriceHumanReadable.toString()})`
    );

    // Calculate ideal amounts based on total safe value and current price
    // Step 1: Calculate total safe value in token0 terms (using smallest units)
    // Total value = safeToken0 + (safeToken1 / currentPrice)
    const safeToken0Amount = BigNumber(safeBalance0.amount);
    const safeToken1Amount = BigNumber(safeBalance1.amount);

    // Convert token1 to token0 terms using current price
    // currentPrice is in smallest units: token0_smallest / token1_smallest
    // So token1_value_in_token0 = token1_amount / currentPrice
    const token1ValueInToken0 = safeToken1Amount.div(currentPrice);
    const totalValueInToken0 = safeToken0Amount.plus(token1ValueInToken0);

    console.log(
      `Total safe value in ${token0.name} terms: ${
        new TokenAmount(totalValueInToken0.toFixed(0), token0)
          .humanReadableAmount
      } ${token0.name}`
    );

    // Step 2: Calculate ideal amounts considering 1% slippage
    // When using X token0, we need X * price * 1.01 token1 (with 1% slippage)
    // Total value in token0 terms: X + (X * price * 1.01) / price = X + X * 1.01 = X * 2.01
    // Therefore: idealToken0 = totalValue / 2.01 = totalValue * 100 / 201
    const idealAmount0 = totalValueInToken0.times(100).div(201);

    // Ideal token1 is idealToken0 converted by current price (with 1% slippage)
    // idealToken1 = idealToken0 * currentPrice * 1.01
    const idealAmount1 = idealAmount0.times(currentPrice);

    console.log(
      `Ideal amounts for price range (with 1% slippage): ${
        new TokenAmount(idealAmount0.toFixed(0), token0).humanReadableAmount
      } ${token0.name}, ${
        new TokenAmount(idealAmount1.toFixed(0), token1).humanReadableAmount
      } ${token1.name}`
    );

    // Check current safe balances
    const currentAmount0 = BigNumber(safeBalance0.amount);
    const currentAmount1 = BigNumber(safeBalance1.amount);

    // Determine if we need to swap to get closer to ideal amounts
    // We want to swap only what's needed to reach the optimal ratio
    const hasExcessToken0 = currentAmount0.gt(idealAmount0);
    const needsMoreToken0 = currentAmount0.lt(idealAmount0);

    if (hasExcessToken0 || needsMoreToken0) {
      console.log(
        "Rebalancing tokens using Bolt to get closer to ideal amount..."
      );

      // Get Bolt price
      const boltPriceResult = await this.boltClient.getPrice(
        pool.coin_type_a,
        pool.coin_type_b
      );

      // Determine which token to swap and how much
      let amountToSwap: BigNumber;
      let expectedOutput: BigNumber;
      let assetIn: string;
      let assetOut: string;
      let swapToken0: RegistryToken;
      let swapToken1: RegistryToken;

      if (hasExcessToken0) {
        // Have excess token0, swap token0 for token1 to get closer to ideal
        const excess = currentAmount0.minus(idealAmount0);
        // Convert excess to token1 amount using Bolt price
        const boltPrice = BigNumber(boltPriceResult.price);
        expectedOutput = excess.times(boltPrice);
        amountToSwap = excess;
        // Don't swap more than we have
        amountToSwap = BigNumber.min(amountToSwap, currentAmount0);
        assetIn = pool.coin_type_a;
        assetOut = pool.coin_type_b;
        swapToken0 = token0;
        swapToken1 = token1;
      } else {
        // Need more token0, swap token1 for token0 to get closer to ideal
        const deficit = idealAmount0.minus(currentAmount0);
        // Convert deficit to token1 amount using Bolt price
        const boltPrice = BigNumber(boltPriceResult.price);
        amountToSwap = deficit.times(boltPrice);
        expectedOutput = deficit;
        // Don't swap more than we have
        amountToSwap = BigNumber.min(amountToSwap, currentAmount1);
        assetIn = pool.coin_type_b;
        assetOut = pool.coin_type_a;
        swapToken0 = token1;
        swapToken1 = token0;
      }

      // Check minimum swap amount on Bolt
      let shouldSwap = amountToSwap.gt(0);
      if (shouldSwap) {
        try {
          // Try to get pool config to check minimum
          const boltPoolConfig = await this.boltClient.getPoolConfigByDenom(
            assetOut,
            assetIn
          );

          if (boltPoolConfig && expectedOutput.lte(boltPoolConfig.minBaseOut)) {
            console.log(
              `Swap amount is smaller than minimum output on Bolt exchange (${expectedOutput.toString()} <= ${
                boltPoolConfig.minBaseOut
              }). Skipping swap and using available tokens.`
            );
            shouldSwap = false;
          }
        } catch (error) {
          // If getPoolConfigByDenom doesn't exist or fails, continue with swap
          console.log(
            "Could not check minimum swap amount, proceeding with swap"
          );
        }
      }

      if (shouldSwap && amountToSwap.gt(0)) {
        console.log(
          `Swapping ${
            new TokenAmount(amountToSwap.toFixed(0), swapToken0)
              .humanReadableAmount
          } ${swapToken0.name} for ${swapToken1.name}...`
        );

        const swapResult = await this.boltClient.swap(
          {
            amountIn: amountToSwap.toFixed(0),
            assetIn,
            assetOut,
          },
          this.signer
        );

        // Log swap transaction
        this.database.addTransaction({
          signerAddress: this.address,
          chainId: this.chainInfo.id,
          transactionType: TransactionType.BOLT_SUI_SWAP,
          inputAmount: new TokenAmount(amountToSwap.toFixed(0), swapToken0)
            .humanReadableAmount,
          inputTokenDenom: swapToken0.denom,
          inputTokenName: swapToken0.name,
          outputAmount: new TokenAmount(swapResult.amountOut, swapToken1)
            .humanReadableAmount,
          outputTokenDenom: swapToken1.denom,
          outputTokenName: swapToken1.name,
          // gasFeeAmount: boltSwapTxFees.gasFee,
          // gasFeeTokenDenom: swapResult.gasFeeToken.denom,
          // gasFeeTokenName: swapResult.gasFeeToken.name,
          txHash: swapResult.txHash,
          successful: true,
        });

        console.log(`Swap complete. Tx: ${swapResult.txHash}`);
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for balances to update
      }
    }

    // Refresh balances after swap (or if no swap was needed)
    const finalBalances = await this.getSuiAccountBalances();
    
    const finalBalance0 =
      finalBalances[token0.denom] ?? new TokenAmount(0, token0);
    const finalBalance1 =
      finalBalances[token1.denom] ?? new TokenAmount(0, token1);

    // Calculate safe balances for position creation (with gas reserve)
    let safeBalance0Final = finalBalance0;
    let safeBalance1Final = finalBalance1;

    if (token0.denom === nativeTokenDenom) {
      const available = BigNumber(finalBalance0.amount).minus(GAS_RESERVE);
      safeBalance0Final = new TokenAmount(
        available.gt(0) ? available.toFixed(0) : "0",
        token0
      );
    }

    if (token1.denom === nativeTokenDenom) {
      const available = BigNumber(finalBalance1.amount).minus(GAS_RESERVE);
      safeBalance1Final = new TokenAmount(
        available.gt(0) ? available.toFixed(0) : "0",
        token1
      );
    }

    // Refresh pool price to get latest price after any swaps
    const refreshedPool = await this.cetusSdk.Pool.getPool(pool.id);
    const refreshedPriceHumanReadable = TickMath.sqrtPriceX64ToPrice(
      refreshedPool.current_sqrt_price!,
      token0.decimals,
      token1.decimals
    );

    // Recalculate price range with refreshed price
    const refreshedLowerPrice = BigNumber(refreshedPriceHumanReadable)
      .times(BigNumber(1).minus(bandPercentage))
      .toFixed(token1.decimals);
    const refreshedUpperPrice = BigNumber(refreshedPriceHumanReadable)
      .times(BigNumber(1).plus(bandPercentage))
      .toFixed(token1.decimals);

    console.log(
      `Available safe balances after swap: ${safeBalance0Final.humanReadableAmount} ${token0.name}, ${safeBalance1Final.humanReadableAmount} ${token1.name}`
    );
    console.log(
      `Refreshed price range: ${refreshedLowerPrice} - ${refreshedUpperPrice} (current: ${refreshedPriceHumanReadable.toString()})`
    );

    // Recalculate ideal amounts with new balances and refreshed price
    // Step 1: Calculate total safe value in token0 terms (using smallest units)
    const refreshedPrice = BigNumber(refreshedPriceHumanReadable).shiftedBy(
      token1.decimals - token0.decimals
    );

    const finalSafeToken0Amount = BigNumber(safeBalance0Final.amount);
    const finalSafeToken1Amount = BigNumber(safeBalance1Final.amount);

    // Convert token1 to token0 terms using refreshed price
    const finalToken1ValueInToken0 = finalSafeToken1Amount.div(refreshedPrice);
    const finalTotalValueInToken0 = finalSafeToken0Amount.plus(
      finalToken1ValueInToken0
    );

    console.log(
      `Total safe value after swap in ${token0.name} terms: ${
        new TokenAmount(finalTotalValueInToken0.toFixed(0), token0)
          .humanReadableAmount
      } ${token0.name}`
    );

    // Step 2: Calculate ideal amounts considering 1% slippage
    const finalIdealAmount0 = finalTotalValueInToken0.times(100).div(201);
    const finalIdealAmount1 = finalIdealAmount0
      .times(refreshedPrice)
      .times(1.01);

    console.log(
      `Ideal amounts after swap (with 1% slippage): ${
        new TokenAmount(finalIdealAmount0.toFixed(0), token0)
          .humanReadableAmount
      } ${token0.name}, ${
        new TokenAmount(finalIdealAmount1.toFixed(0), token1)
          .humanReadableAmount
      } ${token1.name}`
    );

    // Now use SDK to find the optimal token0 amount that fits within available balances
    const finalRangeParams: CustomRangeParams = {
      is_full_range: false,
      min_price: refreshedLowerPrice,
      max_price: refreshedUpperPrice,
      coin_decimals_a: token0.decimals,
      coin_decimals_b: token1.decimals,
      price_base_coin: "coin_a",
    };

    // Start with ideal amount, but ensure it fits within available balances
    let optimalFinalToken0 = BigNumber.min(
      finalIdealAmount0,
      finalSafeToken0Amount
    );
    let calculateResult: CalculateAddLiquidityResult;

    try {
      // Calculate with ideal amount
      calculateResult =
        await this.cetusSdk.Position.calculateAddLiquidityResultWithPrice({
          add_mode_params: finalRangeParams,
          pool_id: pool.id,
          slippage: 0.01,
          coin_amount: optimalFinalToken0.toFixed(0),
          fix_amount_a: true,
        });

      const requiredToken1ForOptimal = BigNumber(
        calculateResult.coin_amount_limit_b
      );

      // If we need more token1 than available, reduce token0 using binary search
      if (
        requiredToken1ForOptimal.gt(finalSafeToken1Amount) &&
        !requiredToken1ForOptimal.eq(0)
      ) {
        let low = BigNumber(0);
        let high = optimalFinalToken0;
        let bestToken0 = BigNumber(0);
        let bestToken1Usage = BigNumber(0);
        let bestResult: CalculateAddLiquidityResult | null = null;

        for (let i = 0; i < 20; i++) {
          const mid = low.plus(high).div(2);
          try {
            const testResult =
              await this.cetusSdk.Position.calculateAddLiquidityResultWithPrice(
                {
                  add_mode_params: finalRangeParams,
                  pool_id: pool.id,
                  slippage: 0.01,
                  coin_amount: mid.toFixed(0),
                  fix_amount_a: true,
                }
              );

            const testToken1 = BigNumber(testResult.coin_amount_limit_b);

            if (
              testToken1.lte(finalSafeToken1Amount) &&
              testToken1.gt(bestToken1Usage)
            ) {
              bestToken0 = mid;
              bestToken1Usage = testToken1;
              bestResult = testResult;
              low = mid;
            } else {
              high = mid;
            }
          } catch (e) {
            high = mid;
          }
        }

        if (bestToken0.gt(0)) {
          optimalFinalToken0 = bestToken0;
          calculateResult = bestResult!;
          console.log(
            `Found optimal amounts: ${
              new TokenAmount(optimalFinalToken0.toFixed(0), token0)
                .humanReadableAmount
            } ${token0.name}, ${
              new TokenAmount(bestToken1Usage.toFixed(0), token1)
                .humanReadableAmount
            } ${token1.name}`
          );
        } else {
          // Fallback: use simple ratio
          optimalFinalToken0 = finalSafeToken1Amount
            .div(BigNumber(refreshedUpperPrice))
            .times(0.99);
          optimalFinalToken0 = BigNumber.min(
            optimalFinalToken0,
            finalSafeToken0Amount
          );
          calculateResult =
            await this.cetusSdk.Position.calculateAddLiquidityResultWithPrice({
              add_mode_params: finalRangeParams,
              pool_id: pool.id,
              slippage: 0.01,
              coin_amount: optimalFinalToken0.toFixed(0),
              fix_amount_a: true,
            });
        }
      } else {
        console.log(
          `Using ideal token0 amount: ${
            new TokenAmount(optimalFinalToken0.toFixed(0), token0)
              .humanReadableAmount
          } ${token0.name}`
        );
      }
    } catch (error) {
      // If calculation fails, use ideal amount or fallback
      console.warn(
        "Could not calculate optimal final amounts, using ideal amount"
      );
      optimalFinalToken0 = BigNumber.min(
        finalIdealAmount0,
        finalSafeToken0Amount
      );
      calculateResult =
        await this.cetusSdk.Position.calculateAddLiquidityResultWithPrice({
          add_mode_params: finalRangeParams,
          pool_id: pool.id,
          slippage: 0.01,
          coin_amount: optimalFinalToken0.toFixed(0),
          fix_amount_a: true,
        });
    }

    let adjustedToken0Amount = optimalFinalToken0;

    // Create payload - if this fails due to insufficient balance, retry with smaller amount
    let payload: any;
    let payloadCreationAttempts = 0;
    const maxPayloadAttempts = 5;

    while (payloadCreationAttempts < maxPayloadAttempts) {
      try {
        payload =
          await this.cetusSdk.Position.createAddLiquidityFixCoinWithPricePayload(
            {
              pool_id: pool.id,
              calculate_result: calculateResult,
              add_mode_params: finalRangeParams,
            }
          );
        break; // Success, exit loop
      } catch (error: any) {
        // If error is about insufficient balance, reduce token0 and retry
        if (
          error?.message?.includes("Insufficient balance") ||
          error?.message?.includes("expect")
        ) {
          payloadCreationAttempts++;
          console.warn(
            `Payload creation failed due to insufficient balance (attempt ${payloadCreationAttempts}/${maxPayloadAttempts}). Reducing token0 amount...`
          );

          // Reduce token0 by 20% and recalculate
          adjustedToken0Amount = adjustedToken0Amount.times(0.8);

          if (payloadCreationAttempts >= maxPayloadAttempts) {
            throw new Error(
              `Could not create payload after ${maxPayloadAttempts} attempts. Last error: ${error.message}`
            );
          }

          // Recalculate with reduced amount
          calculateResult =
            await this.cetusSdk.Position.calculateAddLiquidityResultWithPrice({
              add_mode_params: finalRangeParams,
              pool_id: pool.id,
              slippage: 0.01,
              coin_amount: adjustedToken0Amount.toFixed(0),
              fix_amount_a: true,
            });
        } else {
          // Different error, throw it
          throw error;
        }
      }
    }

    // Execute transaction
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

    // Extract position ID from events
    const openPositionEvent = txResult.events.find(
      (e: any) =>
        e.type?.includes("OpenPositionEvent") ||
        e.parsedJson?.position !== undefined
    );
    const positionId = openPositionEvent?.parsedJson?.position || "";

    // Extract amounts from events
    const addLiquidityEvent = txResult.events.find((e: any) =>
      e.type?.includes("AddLiquidity")
    );
    const amountA = addLiquidityEvent?.parsedJson?.amount_a || "0";
    const amountB = addLiquidityEvent?.parsedJson?.amount_b || "0";
    const liquidity = addLiquidityEvent?.parsedJson?.liquidity || "0";

    // Extract ticks
    const lowerTick = addLiquidityEvent?.parsedJson?.tick_lower?.value || "0";
    const upperTick = addLiquidityEvent?.parsedJson?.tick_upper?.value || "0";

    // Log position creation transaction
    this.database.addTransaction({
      signerAddress: this.address,
      chainId: this.chainInfo.id,
      transactionType: TransactionType.CREATE_POSITION,
      positionId,
      inputAmount: new TokenAmount(amountA, token0).humanReadableAmount,
      inputTokenDenom: token0.denom,
      inputTokenName: token0.name,
      secondInputAmount: new TokenAmount(amountB, token1).humanReadableAmount,
      secondInputTokenDenom: token1.denom,
      secondInputTokenName: token1.name,
      txHash: txResult.digest,
      successful: true,
    });

    // Update config with position ID
    this.config.cetusPosition.id = positionId;
    await this.saveConfig();

    return {
      positionId,
      tokenAmount0: new TokenAmount(amountA, token0),
      tokenAmount1: new TokenAmount(amountB, token1),
      liquidityCreated: liquidity,
      lowerTick: lowerTick.toString(),
      upperTick: upperTick.toString(),
    };
  }

  async getStatus(): Promise<StatusResponse> {
    if (!this.config.cetusPool.id) {
      return {};
    }

    const pool = await this.cetusSdk.Pool.getPool(this.config.cetusPool.id);
    if (!pool) {
      return {};
    }

    const poolInfo = {
      poolId: pool.id,
      token0: pool.coin_type_a,
      token1: pool.coin_type_b,
      currentPrice: TickMath.sqrtPriceX64ToPrice(
        pool.current_sqrt_price,
        pool.coin_type_a.includes("usdc") ? 6 : 9,
        pool.coin_type_b.includes("usdc") ? 6 : 9
      ).toString(),
      currentTick: pool.current_tick_index,
      liquidity: pool.liquidity,
    };

    if (!this.config.cetusPosition.id) {
      return {
        poolInfo: poolInfo as any,
      };
    }

    try {
      const position = await this.cetusSdk.Position.getPositionById(
        this.config.cetusPosition.id
      );

      if (!position) {
        return {
          poolInfo: poolInfo as any,
        };
      }

      const positionRange = await this.isPositionInRange(pool, position);

      // Calculate prices from ticks (simplified - would need proper tick math)
      const positionInfo = {
        positionId: position.pos_object_id,
        lowerTick: position.tick_lower_index,
        upperTick: position.tick_upper_index,
        liquidity: position.liquidity,
        coinTypeA: position.coin_type_a,
        coinTypeB: position.coin_type_b,
      };

      return {
        poolInfo: poolInfo as any,
        positionInfo: positionInfo as any,
        positionRange: positionRange as any,
        positionLowerPrice: "", // Would need tick to price conversion
        positionUpperPrice: "", // Would need tick to price conversion
      };
    } catch (error) {
      console.error("Error getting position status:", error);
      return {
        poolInfo: poolInfo as any,
      };
    }
  }

  async withdrawPosition(): Promise<WithdrawPositionResponse> {
    if (!this.config.cetusPool.id || !this.config.cetusPosition.id) {
      throw new Error("No pool ID or position ID found");
    }

    const pool = await this.cetusSdk.Pool.getPool(this.config.cetusPool.id);
    if (!pool) {
      throw new Error("Pool not found");
    }

    const token0 = this.tokensMap[normalizeStructTag(pool.coin_type_a)];
    const token1 = this.tokensMap[normalizeStructTag(pool.coin_type_b)];

    if (!token0 || !token1) {
      throw new Error("Pool tokens not found in registry");
    }

    // Get reward coin types
    const rewardCoinTypes = pool.rewarder_infos.map(
      (rewarder: any) => rewarder.coin_type
    );

    // Create close position payload
    const closePositionPayload =
      await this.cetusSdk.Position.closePositionPayload({
        coin_type_a: pool.coin_type_a,
        coin_type_b: pool.coin_type_b,
        min_amount_a: "0",
        min_amount_b: "0",
        rewarder_coin_types: rewardCoinTypes,
        pool_id: pool.id,
        pos_id: this.config.cetusPosition.id,
        collect_fee: true,
      });

    // Execute transaction
    const txResult = await this.cetusSdk.FullClient.executeTx(
      this.signer,
      closePositionPayload,
      false
    );

    // Extract amounts from events
    const removeLiquidityEvent = txResult.events.find((e: any) =>
      e.type?.includes("RemoveLiquidity")
    );
    const amountA = removeLiquidityEvent?.parsedJson?.amount_a || "0";
    const amountB = removeLiquidityEvent?.parsedJson?.amount_b || "0";

    // Extract fee collection if any
    const collectFeeEvent = txResult.events.find((e: any) =>
      e.type?.includes("CollectFee")
    );
    const feeAmountA = collectFeeEvent?.parsedJson?.amount_a || "0";
    const feeAmountB = collectFeeEvent?.parsedJson?.amount_b || "0";

    // Log withdrawal transaction
    const transactions: AccountTransaction[] = [
      {
        signerAddress: this.address,
        chainId: this.chainInfo.id,
        transactionType: TransactionType.WITHDRAW_POSITION,
        positionId: this.config.cetusPosition.id,
        outputAmount: new TokenAmount(amountA, token0).humanReadableAmount,
        outputTokenDenom: token0.denom,
        outputTokenName: token0.name,
        secondOutputAmount: new TokenAmount(amountB, token1)
          .humanReadableAmount,
        secondOutputTokenDenom: token1.denom,
        secondOutputTokenName: token1.name,
        txHash: txResult.digest,
        successful: true,
      },
    ];

    // Add fee collection transaction if fees were collected
    if (
      (feeAmountA && BigNumber(feeAmountA).gt(0)) ||
      (feeAmountB && BigNumber(feeAmountB).gt(0))
    ) {
      transactions.push({
        signerAddress: this.address,
        chainId: this.chainInfo.id,
        transactionType: TransactionType.COLLECT_SPREAD_REWARDS,
        positionId: this.config.cetusPosition.id,
        outputAmount: new TokenAmount(feeAmountA, token0).humanReadableAmount,
        outputTokenDenom: token0.denom,
        outputTokenName: token0.name,
        secondOutputAmount: new TokenAmount(feeAmountB, token1)
          .humanReadableAmount,
        secondOutputTokenDenom: token1.denom,
        secondOutputTokenName: token1.name,
        txHash: txResult.digest,
        txActionIndex: 1,
        successful: true,
      });
    }

    this.database.addTransactionBatch(transactions);

    console.log(
      `Withdrew ${new TokenAmount(amountA, token0).humanReadableAmount} ${
        token0.name
      } and ${new TokenAmount(amountB, token1).humanReadableAmount} ${
        token1.name
      }`
    );

    // Clear position ID from config
    this.config.cetusPosition.id = "";
    await this.saveConfig();

    return {
      amount0Withdrawn: new TokenAmount(amountA, token0),
      amount1Withdrawn: new TokenAmount(amountB, token1),
    };
  }

  private async getSuiAccountBalances(): Promise<Record<string, TokenAmount>> {
    const suiAccount = new SuiAccount(this.address, this.environment);
    return await suiAccount.getAvailableBalances();
  }

  private async saveConfig(): Promise<void> {
    await fs.writeFile(
      this.configPath,
      JSON.stringify(this.config, undefined, 2),
      "utf-8"
    );
  }
}
