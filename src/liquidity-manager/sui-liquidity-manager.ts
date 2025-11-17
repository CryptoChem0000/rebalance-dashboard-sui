import { BigNumber } from "bignumber.js";
import fs from "fs/promises";
import {
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
    const GAS_RESERVE = BigNumber(0.1).times(10 ** 9); // 0.1 SUI in smallest unit
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
      token0.decimals - token1.decimals
    );

    console.log(
      `Current pool price (human-readable): ${currentPriceHumanReadable.toString()}`
    );
    console.log(
      `Current pool price (smallest units): ${currentPrice.toString()}`
    );

    // Calculate ideal amounts for position range
    const bandPercentage = BigNumber(
      this.config.cetusPosition.bandPercentage
    ).div(100);

    // For range prices, we use human-readable price
    const lowerPrice = BigNumber(currentPriceHumanReadable)
      .times(BigNumber(1).minus(bandPercentage))
      .toFixed(token0.decimals);
    const upperPrice = BigNumber(currentPriceHumanReadable)
      .times(BigNumber(1).plus(bandPercentage))
      .toFixed(token0.decimals);

    // Calculate ideal token amounts based on total safe value and slippage
    // Position creator uses fix_amount_a: true, so token0 is FIXED and token1 can vary with slippage
    //
    // Step 1: Calculate total safe value in token0 terms (using smallest units)
    const value0 = BigNumber(safeBalance0.amount);
    const value1 = BigNumber(safeBalance1.amount).times(currentPrice);
    const totalValue = value0.plus(value1);

    // Step 2: Calculate ideal amounts considering 1% slippage
    // When using X token0, we need X * price * 1.01 token1 (with 1% slippage)
    // Total value in token0 terms: X + (X * price * 1.01) / price = X + X * 1.01 = X * 2.01
    // Therefore: idealToken0 = totalValue / 2.01 = totalValue * 100 / 201
    const positionSlippage = BigNumber(0.01); // 1% slippage for position creation
    const idealAmount0 = totalValue.times(100).div(201);

    // Ideal token1 is idealToken0 converted by price (slippage already accounted for in the ratio)
    // Price is already in smallest units, so this gives us idealAmount1 in smallest units
    const idealAmount1 = idealAmount0.times(currentPrice);

    console.log(
      `Ideal amounts (with 1% slippage): ${
        new TokenAmount(idealAmount0.toFixed(0), token0).humanReadableAmount
      } ${token0.name}, ${
        new TokenAmount(idealAmount1.toFixed(0), token1).humanReadableAmount
      } ${token1.name}`
    );

    // Check current balances
    const currentAmount0 = BigNumber(safeBalance0.amount);
    const currentAmount1 = BigNumber(safeBalance1.amount);

    // Determine if we need to swap to get closer to ideal amounts
    // If we have more token0 than ideal, swap token0 for token1
    // If we have less token0 than ideal, swap token1 for token0
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
        amountToSwap = deficit.div(boltPrice);
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
          txHash: swapResult.txHash,
          successful: true,
        });

        console.log(`Swap complete. Tx: ${swapResult.txHash}`);
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

    // Convert refreshed price to smallest on-chain units for calculations
    const refreshedPrice = BigNumber(refreshedPriceHumanReadable).shiftedBy(
      token0.decimals - token1.decimals
    );

    // Recalculate ideal amounts with new balances and price after swaps
    // Step 1: Calculate total safe value in token0 terms (using smallest units)
    const finalValue0 = BigNumber(safeBalance0Final.amount);
    const finalValue1 = BigNumber(safeBalance1Final.amount).times(
      refreshedPrice
    );
    const finalTotalValue = finalValue0.plus(finalValue1);

    // Step 2: Calculate ideal token0 with 1% slippage: idealToken0 = totalValue * 100 / 201
    const finalIdealAmount0 = finalTotalValue.times(100).div(201);

    // Step 3: Apply constraint - can't use more token0 than we have
    // Also ensure we have enough token1 with slippage: idealToken0 * price * 1.01 <= safeBalance1Final
    const maxToken0BasedOnToken1Final = BigNumber(safeBalance1Final.amount).div(
      refreshedPrice.times(BigNumber(1).plus(positionSlippage))
    );

    // Conservative token0 amount is the minimum of:
    // - Ideal amount from total value calculation (finalIdealAmount0)
    // - Maximum safe token0 based on token1 availability
    // - Available token0
    const conservativeToken0Amount = BigNumber.min(
      finalIdealAmount0,
      maxToken0BasedOnToken1Final,
      BigNumber(safeBalance0Final.amount)
    ).toFixed(0);

    console.log(
      `Available balances: ${safeBalance0Final.humanReadableAmount} ${token0.name}, ${safeBalance1Final.humanReadableAmount} ${token1.name}`
    );
    console.log(
      `Max token0 based on token1 availability (with 1% slippage): ${
        new TokenAmount(maxToken0BasedOnToken1Final.toFixed(0), token0)
          .humanReadableAmount
      } ${token0.name}`
    );
    console.log(
      `Using conservative token0 amount: ${
        new TokenAmount(conservativeToken0Amount, token0).humanReadableAmount
      } ${token0.name}`
    );

    const rangeParams: CustomRangeParams = {
      is_full_range: false,
      min_price: lowerPrice,
      max_price: upperPrice,
      coin_decimals_a: token0.decimals,
      coin_decimals_b: token1.decimals,
      price_base_coin: "coin_a",
    };

    // Calculate liquidity result - position creator will use the conservative token0 amount
    // and calculate token1 needed (with 1% slippage already configured)
    // This ensures we have enough token1 even if slippage causes it to need 1% more
    const calculateResult =
      await this.cetusSdk.Position.calculateAddLiquidityResultWithPrice({
        add_mode_params: rangeParams,
        pool_id: pool.id,
        slippage: 0.01,
        coin_amount: conservativeToken0Amount,
        fix_amount_a: true,
      });

    // Create payload
    const payload =
      await this.cetusSdk.Position.createAddLiquidityFixCoinWithPricePayload({
        pool_id: pool.id,
        calculate_result: calculateResult,
        add_mode_params: rangeParams,
      });

    // Execute transaction
    const txResult = await this.cetusSdk.FullClient.executeTx(
      this.signer,
      payload,
      false
    );

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
