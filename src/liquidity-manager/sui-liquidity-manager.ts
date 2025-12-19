import { BoltSuiClient } from "@bolt-liquidity-hq/sui-client";
import { TickMath } from "@cetusprotocol/common-sdk";
import { Pool, CustomRangeParams } from "@cetusprotocol/sui-clmm-sdk";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { BigNumber } from "bignumber.js";
import fs from "fs/promises";

import { SuiAccount, TokenAmount } from "../account-balances";
import {
  CetusCLPoolManager,
  DEFAULT_POSITION_SLIPPAGE,
  extractGasFees,
  extractPlatformFees,
} from "../cetus-integration";
import { loadSuiConfigWithEnvOverrides } from "./sui-config-loader";
import {
  CETUS_CREATE_LP_POSITION_FEE,
  CETUS_WITHDRAW_LP_POSITION_FEE,
  SUI_BOLT_SWAP_FEE,
} from "./constants";
import {
  AccountTransaction,
  PlatformName,
  PostgresTransactionRepository,
  SQLiteTransactionRepository,
  TransactionRepository,
  TransactionType,
} from "../database";
import { DEFAULT_KEY_NAME, KeyManager, KeyStoreType } from "../key-manager";
import { ChainInfo, findSuiChainInfo, RegistryToken } from "../registry";
import { assertEnoughBalanceForFees, getSignerAddress } from "../utils";

import {
  MakeSuiLiquidityManagerParams,
  CreatePositionResult,
  RebalanceResult,
  StatusResponse,
  Config,
  SuiLiquidityManagerConfig,
  WithdrawPositionResult,
  StatusPoolInfo,
} from "./types";

export class SuiLiquidityManager {
  public config: Config;
  private configFilePath: string;
  private signer: Ed25519Keypair;
  private address: string;
  private chainInfo: ChainInfo;
  private environment: "mainnet" | "testnet";
  public database: TransactionRepository;
  private cetusPoolManager: CetusCLPoolManager;
  private boltClient: BoltSuiClient;

  constructor(params: SuiLiquidityManagerConfig) {
    this.config = params.config;
    this.configFilePath = params.configFilePath;
    this.signer = params.signer;
    this.address = params.address;
    this.environment = params.environment || "mainnet";
    this.chainInfo = findSuiChainInfo(this.environment);
    this.database = params.database;
    this.cetusPoolManager = params.cetusPoolManager;
    this.boltClient = params.boltClient;
  }

  static async make(
    params: MakeSuiLiquidityManagerParams
  ): Promise<SuiLiquidityManager> {
    let config = params.config;
    let configFilePath = params.configFilePath;
    if (!config || !configFilePath) {
      const loadResult = await loadSuiConfigWithEnvOverrides(
      params.configFilePath
    );
      config = loadResult.config;
      configFilePath = loadResult.configFilePath;
    }

    const keyStore = await KeyManager.create({
      type: KeyStoreType.ENV_VARIABLE,
    });

    const signer = await keyStore.getSuiSigner(DEFAULT_KEY_NAME);
    const address = await getSignerAddress(signer);

    const database = await (process.env.DATABASE_URL
      ? PostgresTransactionRepository.make()
      : SQLiteTransactionRepository.make(address));

    const cetusPoolManager = await CetusCLPoolManager.make(
      signer,
      config.poolId,
      params.environment,
      params.rpcEndpointOverride
    );

    const boltClient = new BoltSuiClient();

    return new SuiLiquidityManager({
      ...params,
      signer,
      address,
      config,
      configFilePath,
      database,
      cetusPoolManager,
      boltClient,
    });
  }

  async execute(): Promise<RebalanceResult> {
    console.log("Starting liquidity management execution...");
    let suiBalances = await this.getSuiAccountBalances();
    let hadPosition = false;
    let rebalanced = false;

    // Withdraw unknown existing positions if any
    const unknownPositionsResult = await this.withdrawUnknownPositions(
      this.config.positionId,
      suiBalances
    );

    // Refresh balance if there were unknown positions
    if (unknownPositionsResult.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      suiBalances = await this.getSuiAccountBalances();
    }

    // Step 1: Check if we have a position and if it needs rebalancing
    if (this.config.positionId) {
      console.log(
        `Checking position ${this.config.positionId} for rebalancing...`
      );

      try {
        const position = await this.cetusPoolManager.getPositionInfo(
          this.config.positionId
        );

        if (position) {
          hadPosition = true;
          const isInRange = await this.cetusPoolManager.isPositionInRange(
            this.config.positionId,
            this.config.rebalanceThresholdPercent,
            position
          );

          if (isInRange.isInRange) {
            console.log(
              `Position is in range (${isInRange.percentageBalance.toFixed(
                2
              )}% balance). No rebalancing needed.`
            );
            return {
              poolId: this.config.poolId,
              positionId: this.config.positionId,
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

          await new Promise((resolve) => setTimeout(resolve, 1000));
          suiBalances = await this.getSuiAccountBalances();
        }
      } catch (error: any) {
        if (
          error?.message?.includes?.("not found") ||
          error?.message?.includes?.("not exist")
        ) {
          console.error(
            "Error finding position, it might not exist. Ignoring and creating new position...",
            error
          );
          this.config.positionId = "";
          await this.saveConfig();
        } else {
          throw error;
        }
      }
    }

    // Step 2: Create new position
    console.log("Creating new position...");
    const positionResult = await this.createPosition(undefined, suiBalances);

    return {
      poolId: this.config.poolId,
      positionId: positionResult.positionId,
      action: hadPosition && rebalanced ? "rebalanced" : "created",
      message: `Position ${positionResult.positionId} created with liquidity ${positionResult.liquidityCreated}`,
    };
  }

  private async createPosition(
    poolInfo?: Pool,
    suiBalances?: Record<string, TokenAmount>
  ): Promise<CreatePositionResult> {
    // Constants
    const POSITION_SLIPPAGE = this.config.slippage ?? DEFAULT_POSITION_SLIPPAGE; // Use config slippage or default to 1%
    const GAS_RESERVE = BigNumber(CETUS_CREATE_LP_POSITION_FEE)
      .plus(CETUS_WITHDRAW_LP_POSITION_FEE)
      .plus(SUI_BOLT_SWAP_FEE)
      .times(5);

    // Helper function to calculate safe balance
    const calculateSafeBalance = (
      balance: TokenAmount,
      isNativeToken: boolean
    ): TokenAmount => {
      if (isNativeToken) {
        const available = BigNumber(balance.amount).minus(GAS_RESERVE);
        return new TokenAmount(
          available.gt(0) ? available.toFixed(0) : "0",
          balance.token
        );
      }
      return balance;
    };

    const currentPoolInfo =
      poolInfo ?? (await this.cetusPoolManager.getPoolInfo());
    const token0 = this.cetusPoolManager.token0;
    const token1 = this.cetusPoolManager.token1;

    // Get current balances
    let currentSuiBalances =
      suiBalances ?? (await this.getSuiAccountBalances());
    let currentBalance0 =
      currentSuiBalances[token0.denom] ?? new TokenAmount(0, token0);
    let currentBalance1 =
      currentSuiBalances[token1.denom] ?? new TokenAmount(0, token1);

    const nativeTokenDenom = this.chainInfo.nativeToken.denom;
    let safeBalance0 = calculateSafeBalance(
      currentBalance0,
      token0.denom === nativeTokenDenom
    );
    let safeBalance1 = calculateSafeBalance(
      currentBalance1,
      token1.denom === nativeTokenDenom
    );

    console.log(
      `Current balances: ${currentBalance0.humanReadableAmount} ${token0.name}, ${currentBalance1.humanReadableAmount} ${token1.name}`
    );
    console.log(
      `Safe balances (after gas reserve): ${safeBalance0.humanReadableAmount} ${token0.name}, ${safeBalance1.humanReadableAmount} ${token1.name}`
    );

    // Get current price
    const currentPriceHumanReadable = TickMath.sqrtPriceX64ToPrice(
      currentPoolInfo.current_sqrt_price,
      token0.decimals,
      token1.decimals
    );
    const currentPrice = BigNumber(currentPriceHumanReadable).shiftedBy(
      token1.decimals - token0.decimals
    );

    console.log(
      `Current pool price: ${currentPriceHumanReadable.toString()} (human-readable), ${currentPrice.toString()} (smallest units)`
    );

    // Calculate price range
    // Ensure minimum band of 0.5% to avoid tick range validation errors
    const minBandPercentage = BigNumber(0.5).div(100);
    const requestedBandPercentage = BigNumber(
      this.config.positionBandPercentage
    ).div(100);
    const bandPercentage = BigNumber.max(
      requestedBandPercentage,
      minBandPercentage
    );
    
    if (requestedBandPercentage.lt(minBandPercentage)) {
    console.log(
        `Warning: Requested band percentage (${this.config.positionBandPercentage}%) is too narrow. Using minimum of 0.5% to ensure valid tick range.`
    );
    }

    const lowerPrice = BigNumber(currentPriceHumanReadable)
      .times(BigNumber(1).minus(bandPercentage))
      .toFixed(token1.decimals);
    const upperPrice = BigNumber(currentPriceHumanReadable)
      .times(BigNumber(1).plus(bandPercentage))
      .toFixed(token1.decimals);

    console.log(
      `Price range: ${lowerPrice} - ${upperPrice} (current: ${currentPriceHumanReadable.toString()})`
    );

    const safeToken0Amount = BigNumber(safeBalance0.amount);
    const safeToken1Amount = BigNumber(safeBalance1.amount);
    const token1ValueInToken0 = safeToken1Amount.div(currentPrice);
    const totalValueInToken0 = safeToken0Amount.plus(token1ValueInToken0);

    // Calculate optimal token0 ratio based on available balances
    // For a balanced position, we want roughly 50% of value in each token
    // But we need to account for slippage, so we'll aim for slightly less to be safe
    // We'll calculate the maximum token0 we can use while ensuring we have enough token1
    const targetToken0Ratio = 0.48; // Aim for ~48% to leave buffer for slippage
    const idealToken0ToKeep = totalValueInToken0.times(targetToken0Ratio);

    // For swap calculation, estimate token1 needs conservatively
    const idealToken1After = totalValueInToken0
      .minus(idealToken0ToKeep)
      .times(currentPrice);

    console.log(
      `Ideal amounts (accounting for Cetus slippage): Keep ${
        new TokenAmount(idealToken0ToKeep.toFixed(0), token0)
          .humanReadableAmount
      } ${token0.name}, Need ${
        new TokenAmount(idealToken1After.toFixed(0), token1).humanReadableAmount
      } ${token1.name}`
    );

    // Perform swap if needed
    const hasSwapped = await this.performSwapIfNeeded(
      currentPoolInfo,
      token0,
      token1,
      safeToken0Amount,
      safeToken1Amount,
      idealToken0ToKeep,
      idealToken1After,
      currentSuiBalances
    );

    // Refresh balances after swap
    if (hasSwapped) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      currentSuiBalances = await this.getSuiAccountBalances();
            }

    currentBalance0 =
      currentSuiBalances[token0.denom] ?? new TokenAmount(0, token0);
    currentBalance1 =
      currentSuiBalances[token1.denom] ?? new TokenAmount(0, token1);

    safeBalance0 = calculateSafeBalance(
      currentBalance0,
      token0.denom === nativeTokenDenom
    );
    safeBalance1 = calculateSafeBalance(
      currentBalance1,
      token1.denom === nativeTokenDenom
    );

    // Refresh pool and recalculate
    const refreshedPool = await this.cetusPoolManager.getPoolInfo();
    const refreshedPriceHumanReadable = TickMath.sqrtPriceX64ToPrice(
      refreshedPool.current_sqrt_price!,
      token0.decimals,
      token1.decimals
    );

    // Use the same band percentage (with minimum enforced)
    const refreshedLowerPrice = BigNumber(refreshedPriceHumanReadable)
      .times(BigNumber(1).minus(bandPercentage))
      .toFixed(token1.decimals);
    const refreshedUpperPrice = BigNumber(refreshedPriceHumanReadable)
      .times(BigNumber(1).plus(bandPercentage))
      .toFixed(token1.decimals);

    console.log(
      `Available safe balances after swap: ${safeBalance0.humanReadableAmount} ${token0.name}, ${safeBalance1.humanReadableAmount} ${token1.name}`
    );

    // Use human-readable price for calculations (not shifted)
    const finalSafeToken0Amount = BigNumber(safeBalance0.amount);
    const finalSafeToken1Amount = BigNumber(safeBalance1.amount);

    // Calculate total value in token0 terms using human-readable price
    const finalToken1ValueInToken0 = finalSafeToken1Amount
      .div(10 ** token1.decimals) // Convert to human-readable
      .times(refreshedPriceHumanReadable) // Multiply by human-readable price
      .times(10 ** token0.decimals); // Convert back to smallest units
    
    const finalTotalValueInToken0 = finalSafeToken0Amount.plus(
      finalToken1ValueInToken0
    );

    // Calculate optimal token0 amount to maximize liquidity usage
    // Start with a target ratio (aim for ~48% to leave buffer for slippage)
    const targetToken0RatioFinal = 0.48;
    let optimalFinalToken0 = BigNumber.min(
      finalTotalValueInToken0.times(targetToken0RatioFinal),
      finalSafeToken0Amount
    );

    // Pre-validate using SDK to get accurate token1 requirement
    // This is more accurate than estimating
    try {
      const rangeParams: CustomRangeParams = {
      is_full_range: false,
      min_price: refreshedLowerPrice,
      max_price: refreshedUpperPrice,
      coin_decimals_a: token0.decimals,
      coin_decimals_b: token1.decimals,
      price_base_coin: "coin_a",
    };

      const testResult =
        await this.cetusPoolManager.cetusSdk.Position.calculateAddLiquidityResultWithPrice({
          add_mode_params: rangeParams,
          pool_id: this.cetusPoolManager.poolId,
          slippage: POSITION_SLIPPAGE,
          coin_amount: optimalFinalToken0.toFixed(0),
          fix_amount_a: true,
        });

      const requiredToken1WithSlippage = BigNumber(testResult.coin_amount_limit_b);

      console.log(
        `Pre-validation: For ${new TokenAmount(optimalFinalToken0.toFixed(0), token0).humanReadableAmount} ${token0.name}, SDK calculates need ${new TokenAmount(requiredToken1WithSlippage.toFixed(0), token1).humanReadableAmount} ${token1.name} (have ${new TokenAmount(finalSafeToken1Amount.toFixed(0), token1).humanReadableAmount})`
      );

      // If we don't have enough token1, calculate the maximum token0 we can use
      if (requiredToken1WithSlippage.gt(finalSafeToken1Amount)) {
        console.log(
          `Insufficient token1. Calculating maximum token0 we can use with available token1...`
        );

        // Binary search to find max token0 that works with available token1
        let maxToken0 = BigNumber(0);
        let testToken0 = optimalFinalToken0;
        let attempts = 0;
        const maxAttempts = 10;

        while (attempts < maxAttempts && testToken0.gt(0)) {
          try {
            const testCalcResult =
              await this.cetusPoolManager.cetusSdk.Position.calculateAddLiquidityResultWithPrice({
                add_mode_params: rangeParams,
                pool_id: this.cetusPoolManager.poolId,
                slippage: POSITION_SLIPPAGE,
                coin_amount: testToken0.toFixed(0),
                  fix_amount_a: true,
              });

            const testToken1Required = BigNumber(testCalcResult.coin_amount_limit_b);

            if (testToken1Required.lte(finalSafeToken1Amount)) {
              maxToken0 = testToken0;
              // Try increasing to find the maximum
              testToken0 = testToken0.times(1.1).decimalPlaces(0);
              if (testToken0.gt(finalSafeToken0Amount)) {
                testToken0 = finalSafeToken0Amount;
              }
            } else {
              // Too much, reduce
              testToken0 = testToken0.times(0.9).decimalPlaces(0);
            }
          } catch (e) {
            // If calculation fails, reduce amount
            testToken0 = testToken0.times(0.9).decimalPlaces(0);
          }
          attempts++;
        }

        if (maxToken0.gt(0)) {
          optimalFinalToken0 = BigNumber.min(maxToken0, finalSafeToken0Amount).decimalPlaces(0);
          console.log(
            `Adjusted token0 amount to ${new TokenAmount(optimalFinalToken0.toFixed(0), token0).humanReadableAmount} ${token0.name} based on available token1 with slippage`
          );
        } else {
          // Fallback: use 90% of available token1 to maximize liquidity utilization
          const token1AvailableHumanReadable = finalSafeToken1Amount.div(10 ** token1.decimals);
          // Use 90% of available token1 to ensure we're utilizing most of the liquidity
          const token1ToUse = token1AvailableHumanReadable.times(0.9);
          const maxToken0HumanReadable = token1ToUse.times(refreshedPriceHumanReadable);
          optimalFinalToken0 = BigNumber.min(
            maxToken0HumanReadable.times(10 ** token0.decimals),
            finalSafeToken0Amount
          ).decimalPlaces(0);
          console.log(
            `Fallback: Using 90% of available token1 (${new TokenAmount(token1ToUse.times(10 ** token1.decimals).toFixed(0), token1).humanReadableAmount} ${token1.name}) to calculate token0 amount: ${new TokenAmount(optimalFinalToken0.toFixed(0), token0).humanReadableAmount} ${token0.name}`
          );
        }
      } else {
        // We have enough token1, check if we can use more token0
        const slippageMultiplier = BigNumber(1).plus(POSITION_SLIPPAGE);
        const token1AvailableHumanReadable = finalSafeToken1Amount.div(10 ** token1.decimals);
        const token1NeededAfterSlippage = token1AvailableHumanReadable.div(slippageMultiplier);
        const maxToken0HumanReadable = token1NeededAfterSlippage.times(refreshedPriceHumanReadable);
        const maxToken0FromToken1 = maxToken0HumanReadable.times(10 ** token0.decimals);

        // Use the maximum of: target ratio OR what we can use based on token1 availability
        optimalFinalToken0 = BigNumber.min(
          BigNumber.max(
            optimalFinalToken0,
            maxToken0FromToken1.times(0.95) // Use 95% of max to leave small buffer
          ),
          finalSafeToken0Amount
        ).decimalPlaces(0);

        if (optimalFinalToken0.gt(finalTotalValueInToken0.times(targetToken0RatioFinal))) {
        console.log(
            `Using more token0 (${new TokenAmount(optimalFinalToken0.toFixed(0), token0).humanReadableAmount} ${token0.name}) than target ratio to maximize liquidity usage`
        );
        }
      }
    } catch (error) {
      console.warn(
        `Pre-validation failed, using estimated calculation: ${error instanceof Error ? error.message : String(error)}`
      );
      // Fallback to simple estimation if SDK call fails
      // Use 90% of available token1 to maximize liquidity utilization
      const slippageMultiplier = BigNumber(1).plus(POSITION_SLIPPAGE);
      const token1AvailableHumanReadable = finalSafeToken1Amount.div(10 ** token1.decimals);
      // Use 90% of available token1 to ensure we're utilizing most of the liquidity
      const token1ToUse = token1AvailableHumanReadable.times(0.9);
      // Account for slippage: if we use X token1, we need X / (1 + slippage) worth
      // But since we're using 90% already, we'll use that directly and let the SDK handle slippage
      const maxToken0HumanReadable = token1ToUse.times(refreshedPriceHumanReadable);
      optimalFinalToken0 = BigNumber.min(
        maxToken0HumanReadable.times(10 ** token0.decimals),
        finalSafeToken0Amount
      ).decimalPlaces(0);
      console.log(
        `Fallback: Using 90% of available token1 (${new TokenAmount(token1ToUse.times(10 ** token1.decimals).toFixed(0), token1).humanReadableAmount} ${token1.name}) to calculate token0 amount: ${new TokenAmount(optimalFinalToken0.toFixed(0), token0).humanReadableAmount} ${token0.name}`
      );
    }

    console.log(
      `Final optimal token0 amount (conservative): ${
        new TokenAmount(optimalFinalToken0.toFixed(0), token0)
          .humanReadableAmount
      } ${token0.name}`
    );

    assertEnoughBalanceForFees(
      currentSuiBalances,
      this.chainInfo.nativeToken,
      BigNumber(CETUS_CREATE_LP_POSITION_FEE),
      "create position"
    );

    const createPositionResult = await this.cetusPoolManager.createPosition({
      minPrice: refreshedLowerPrice,
      maxPrice: refreshedUpperPrice,
      token0MaxAmount: optimalFinalToken0.toFixed(0),
      token1MaxAmount: finalSafeToken1Amount.toFixed(0),
      positionSlippage: POSITION_SLIPPAGE,
    });

    await this.database.addTransaction({
      signerAddress: this.address,
      chainId: this.chainInfo.id,
      transactionType: TransactionType.CREATE_POSITION,
      positionId: createPositionResult.positionId,
      inputAmount: new TokenAmount(
        createPositionResult.tokenAmount0.amount,
        token0
      ).humanReadableAmount,
      inputTokenDenom: token0.denom,
      inputTokenName: token0.name,
      secondInputAmount: new TokenAmount(
        createPositionResult.tokenAmount1.amount,
        token1
      ).humanReadableAmount,
      secondInputTokenDenom: token1.denom,
      secondInputTokenName: token1.name,
      gasFeeAmount: createPositionResult.gasFees?.humanReadableAmount,
      gasFeeTokenDenom: createPositionResult.gasFees?.token.denom,
      gasFeeTokenName: createPositionResult.gasFees?.token.name,
      platformName: PlatformName.CETUS,
      txHash: createPositionResult.txHash,
      successful: true,
    });

    // Update config with position ID
    this.config.positionId = createPositionResult.positionId;
    await this.saveConfig();

    return createPositionResult;
  }

  private async performSwapIfNeeded(
    pool: Pool,
    token0: RegistryToken,
    token1: RegistryToken,
    currentAmount0: BigNumber,
    currentAmount1: BigNumber,
    idealAmount0: BigNumber,
    idealAmount1: BigNumber,
    suiBalances?: Record<string, TokenAmount>
  ): Promise<boolean> {
    const hasExcessToken0 = currentAmount0.gt(idealAmount0);
    const needsMoreToken1 = currentAmount1.lt(idealAmount1);
    const needsMoreToken0 = currentAmount0.lt(idealAmount0);

    let shouldSwap = false;
    let assetIn: string;
    let assetOut: string;
    let amountToSwap: BigNumber = BigNumber(0);
    let swapFromToken: RegistryToken;
    let swapToToken: RegistryToken;

    if (hasExcessToken0 && needsMoreToken1) {
      // Swap token0 for token1
      amountToSwap = currentAmount0.minus(idealAmount0);
      assetIn = pool.coin_type_a;
      assetOut = pool.coin_type_b;
      swapFromToken = token0;
      swapToToken = token1;
      shouldSwap = true;
    } else if (needsMoreToken0 && !needsMoreToken1) {
      // Swap token1 for token0
      const token0Deficit = idealAmount0.minus(currentAmount0);
      const boltPriceResult = await this.boltClient.getPrice(
        pool.coin_type_b,
        pool.coin_type_a
      );
      amountToSwap = token0Deficit.div(BigNumber(boltPriceResult.price));
      amountToSwap = BigNumber.min(amountToSwap, currentAmount1);
      assetIn = pool.coin_type_b;
      assetOut = pool.coin_type_a;
      swapFromToken = token1;
      swapToToken = token0;
      shouldSwap = true;
    } else {
      return false;
    }

    if (!shouldSwap || amountToSwap.lte(0)) {
      return false;
    }

    console.log(
      `Rebalancing tokens using Bolt to get closer to ideal amount...`
          );

    // Cap swap amount to a maximum percentage of available balance to avoid liquidity issues
    // Start with 50% of available balance as a conservative cap
    const maxSwapPercentage = 0.5;
    const availableBalance = swapFromToken.denom === token0.denom 
      ? currentAmount0 
      : currentAmount1;
    const maxSwapAmount = availableBalance.times(maxSwapPercentage);
    const originalAmountToSwap = amountToSwap;
    amountToSwap = BigNumber.min(amountToSwap, maxSwapAmount);

    if (amountToSwap.lt(originalAmountToSwap)) {
      console.log(
        `Capping swap amount from ${new TokenAmount(originalAmountToSwap.toFixed(0), swapFromToken).humanReadableAmount} to ${new TokenAmount(amountToSwap.toFixed(0), swapFromToken).humanReadableAmount} (${(maxSwapPercentage * 100).toFixed(0)}% of available balance) to avoid liquidity issues`
            );
          }

    // Check minimum swap amount
    try {
      const boltPoolConfig = await this.boltClient.getPoolConfigByDenom(
        assetOut,
        assetIn
      );

      const boltPriceResult = await this.boltClient.getPrice(assetIn, assetOut);
      const expectedOutput = amountToSwap.times(boltPriceResult.price);

      if (boltPoolConfig && expectedOutput.lte(boltPoolConfig.minBaseOut)) {
        console.log(
          `Swap amount is smaller than minimum output on Bolt exchange. Skipping swap.`
        );
        return false;
      }
    } catch (error) {
      console.log("Could not check minimum swap amount, proceeding with swap");
    }

    // Execute swap with retry logic for insufficient liquidity errors
    const innerSuiBalances =
      suiBalances ?? (await this.getSuiAccountBalances());
    assertEnoughBalanceForFees(
      innerSuiBalances,
      this.chainInfo.nativeToken,
      BigNumber(SUI_BOLT_SWAP_FEE),
      "swap on Bolt"
    );

    let swapResult;
    let retryAmount = amountToSwap;
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount <= maxRetries) {
      try {
        console.log(
          `Swapping ${
            new TokenAmount(retryAmount.toFixed(0), swapFromToken)
              .humanReadableAmount
          } ${swapFromToken.name} for ${swapToToken.name}...`
        );

        swapResult = await this.boltClient.swap(
          {
            amountIn: retryAmount.toFixed(0),
            assetIn,
            assetOut,
          },
          this.signer
        );
        break; // Success, exit retry loop
      } catch (error: any) {
        // Check if error is due to insufficient liquidity (error code 4000 or similar)
        const errorMessage = error?.message || '';
        const originalError = error?.originalError;
        const cause = originalError?.cause;
        const isLiquidityError = 
          error?.code === 4000 ||
          (cause?.executionErrorSource === 'VMError with status ABORTED' && 
           (errorMessage.includes('4000') || cause?.effects?.status?.status === 'ABORTED')) ||
          (errorMessage.includes('4000') && errorMessage.includes('swap_buy')) ||
          (originalError?.message?.includes('4000') && originalError?.message?.includes('swap_buy'));

        if (isLiquidityError && retryCount < maxRetries) {
          retryCount++;
          // Reduce swap amount by 5% for next retry
          retryAmount = retryAmount.times(0.95).decimalPlaces(0);
          console.log(
            `Swap failed due to insufficient liquidity. Retrying with reduced amount: ${new TokenAmount(retryAmount.toFixed(0), swapFromToken).humanReadableAmount} ${swapFromToken.name} (attempt ${retryCount + 1}/${maxRetries + 1})`
          );
          
          // Check if reduced amount is still above minimum
          try {
            const boltPoolConfig = await this.boltClient.getPoolConfigByDenom(
              assetOut,
              assetIn
            );
            const boltPriceResult = await this.boltClient.getPrice(assetIn, assetOut);
            const expectedOutput = retryAmount.times(boltPriceResult.price);
            
            if (boltPoolConfig && expectedOutput.lte(boltPoolConfig.minBaseOut)) {
              console.log(
                `Reduced swap amount is below minimum. Skipping swap.`
              );
              return false;
            }
          } catch (e) {
            // Continue with retry
          }
        } else {
          // Not a liquidity error or max retries reached, throw the error
          throw error;
        }
      }
    }

    if (!swapResult) {
      console.log(
        `Failed to execute swap after ${maxRetries + 1} attempts. Skipping swap.`
      );
      return false;
    }

    const swapGasFees = extractGasFees(
      swapResult.txOutput,
      this.chainInfo.nativeToken
    );

    const swapPlatformFees = extractPlatformFees(
      swapResult.txOutput,
      swapToToken
    );

    // Log swap transaction (use the actual amount that was swapped, which may have been reduced)
    const actualSwapAmount = retryAmount || amountToSwap;
    await this.database.addTransaction({
      signerAddress: this.address,
      chainId: this.chainInfo.id,
      transactionType: TransactionType.BOLT_SUI_SWAP,
      inputAmount: new TokenAmount(actualSwapAmount.toFixed(0), swapFromToken)
        .humanReadableAmount,
      inputTokenDenom: swapFromToken.denom,
      inputTokenName: swapFromToken.name,
      outputAmount: new TokenAmount(swapResult.amountOut, swapToToken)
        .humanReadableAmount,
      outputTokenDenom: swapToToken.denom,
      outputTokenName: swapToToken.name,
      gasFeeAmount: swapGasFees.humanReadableAmount,
      gasFeeTokenDenom: swapGasFees.token.denom,
      gasFeeTokenName: swapGasFees.token.name,
      platformName: PlatformName.BOLT_SUI,
      platformFeeAmount: swapPlatformFees.humanReadableAmount,
      platformFeeTokenDenom: swapPlatformFees.token.denom,
      platformFeeTokenName: swapPlatformFees.token.name,
      txHash: swapResult.txHash,
      successful: true,
    });

    console.log(`Swap complete. Tx: ${swapResult.txHash}`);
    return true;
  }

  async getStatus(): Promise<StatusResponse> {
    if (!this.config.poolId) {
      return {};
    }

    const pool = await this.cetusPoolManager.getPoolInfo();
    if (!pool) {
      return {};
    }

    const poolInfo: StatusPoolInfo = {
      id: pool.id,
      token0: pool.coin_type_a,
      token1: pool.coin_type_b,
      currentTick: pool.current_tick_index.toString(),
      tickSpacing: pool.tick_spacing,
      spreadFactor: "",
    };

    if (!this.config.positionId) {
      return {
        poolInfo,
      };
    }

    try {
      const position = await this.cetusPoolManager.getPositionInfo(
        this.config.positionId
      );

      if (!position) {
        return {
          poolInfo: poolInfo as any,
        };
      }

      const range = await this.cetusPoolManager.isPositionInRange(
        this.config.positionId,
        this.config.rebalanceThresholdPercent,
        position
      );

      return {
        poolInfo: poolInfo,
        positionInfo: {
          id: position.pos_object_id,
          lowerTick: position.tick_lower_index.toString(),
          upperTick: position.tick_upper_index.toString(),
          lowerPrice: TickMath.tickIndexToPrice(
            position.tick_lower_index,
            this.cetusPoolManager.token0.decimals,
            this.cetusPoolManager.token1.decimals
          ).toString(),
          upperPrice: TickMath.tickIndexToPrice(
            position.tick_upper_index,
            this.cetusPoolManager.token0.decimals,
            this.cetusPoolManager.token1.decimals
          ).toString(),
        liquidity: position.liquidity,
          asset0: {
            amount: "",
            denom: this.cetusPoolManager.token0.denom,
          },
          asset1: {
            amount: "",
            denom: this.cetusPoolManager.token1.denom,
          },
          range,
        },
      };
    } catch (error) {
      console.error("Error getting position status:", error);
      return {
        poolInfo: poolInfo as any,
      };
    }
  }

  async withdrawPosition(): Promise<WithdrawPositionResult> {
    if (!this.config.poolId || !this.config.positionId) {
      throw new Error("No pool ID or position ID found");
    }

    const unknownPositionsResult = await this.withdrawUnknownPositions(
      this.config.positionId
    );

    if (unknownPositionsResult.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const suiBalances = await this.getSuiAccountBalances();

    assertEnoughBalanceForFees(
      suiBalances,
      this.chainInfo.nativeToken,
      CETUS_WITHDRAW_LP_POSITION_FEE,
      "withdraw position"
    );

    const withdrawPositionResult = await this.cetusPoolManager.withdrawPosition(
      this.config.positionId
    );

    let totalToken0Withdrawn = BigNumber(
      withdrawPositionResult.tokenAmount0.amount
    );
    let totalToken1Withdrawn = BigNumber(
      withdrawPositionResult.tokenAmount1.amount
    );
    let otherRewardsCount = 0;

    // Log withdrawal transaction
    const transactions: AccountTransaction[] = [
      {
        signerAddress: this.address,
        chainId: this.chainInfo.id,
        transactionType: TransactionType.WITHDRAW_POSITION,
        positionId: this.config.positionId,
        outputAmount: withdrawPositionResult.tokenAmount0.humanReadableAmount,
        outputTokenDenom: withdrawPositionResult.tokenAmount0.token.denom,
        outputTokenName: withdrawPositionResult.tokenAmount0.token.name,
        secondOutputAmount:
          withdrawPositionResult.tokenAmount1.humanReadableAmount,
        secondOutputTokenDenom: withdrawPositionResult.tokenAmount1.token.denom,
        secondOutputTokenName: withdrawPositionResult.tokenAmount1.token.name,
        gasFeeAmount: withdrawPositionResult.gasFees?.humanReadableAmount,
        gasFeeTokenDenom: withdrawPositionResult.gasFees?.token.denom,
        gasFeeTokenName: withdrawPositionResult.gasFees?.token.name,
        platformName: PlatformName.CETUS,
        txHash: withdrawPositionResult.txHash,
        successful: true,
      },
    ];

    // Add fee collection transaction if fees were collected
    for (
      let i = 0;
      i < (withdrawPositionResult.rewardsCollected?.length ?? 0);
      i++
    ) {
      const reward = withdrawPositionResult.rewardsCollected?.[i];
      if (reward?.token.denom === this.cetusPoolManager.token0.denom) {
        totalToken0Withdrawn = totalToken0Withdrawn.plus(
          BigNumber(reward.amount)
        );
      } else if (reward?.token.denom === this.cetusPoolManager.token1.denom) {
        totalToken1Withdrawn = totalToken1Withdrawn.plus(
          BigNumber(reward.amount)
        );
      } else {
        otherRewardsCount++;
      }
      if (reward) {
        transactions.push({
          signerAddress: this.address,
          chainId: this.chainInfo.id,
          transactionType: TransactionType.COLLECT_SPREAD_REWARDS,
          positionId: this.config.positionId,
          outputAmount: reward.humanReadableAmount,
          outputTokenDenom: reward.token.denom,
          outputTokenName: reward.token.name,
          platformName: PlatformName.CETUS,
          txHash: withdrawPositionResult.txHash,
          txActionIndex: i + 1,
          successful: true,
        });
      }
    }

    await this.database.addTransactionBatch(transactions);

    console.log(
      `Withdrew ${
        new TokenAmount(
          totalToken0Withdrawn.toFixed(0),
          this.cetusPoolManager.token0
        ).humanReadableAmount
      } ${this.cetusPoolManager.token0.name} and ${
        new TokenAmount(
          totalToken1Withdrawn.toFixed(0),
          this.cetusPoolManager.token1
        ).humanReadableAmount
      } ${this.cetusPoolManager.token1.name}${
        otherRewardsCount > 0 ? ` and ${otherRewardsCount} other rewards` : ""
      }`
    );

    // Clear position ID from config
    this.config.positionId = "";
    await this.saveConfig();

    return withdrawPositionResult;
  }

  private async withdrawUnknownPositions(
    currentPositionId?: string,
    suiBalances?: Record<string, TokenAmount>
  ): Promise<WithdrawPositionResult[]> {
    const openPositions = await this.cetusPoolManager.getPositions();
    const unknownPositions = openPositions.filter(
      (item) => item.pos_object_id !== currentPositionId
    );

    // Withdraw unknown positions if any
    const innerSuiBalances =
      suiBalances ?? (await this.getSuiAccountBalances());
    assertEnoughBalanceForFees(
      innerSuiBalances,
      this.chainInfo.nativeToken,
      BigNumber(CETUS_WITHDRAW_LP_POSITION_FEE).times(unknownPositions.length),
      "withdraw unknown positions"
    );
    const withdrawnPositions: WithdrawPositionResult[] = [];
    for (const auxPosition of unknownPositions) {
      console.log(
        `Withdrawing unknown position ${auxPosition.pos_object_id}...`
      );
      const withdrawResult = await this.cetusPoolManager.withdrawPosition(
        auxPosition.pos_object_id
      );

      withdrawnPositions.push(withdrawResult);

      await this.database.addTransaction({
        signerAddress: this.address,
        chainId: this.chainInfo.id,
        transactionType: TransactionType.WITHDRAW_RECONCILIATION,
        positionId: this.config.positionId,
        gasFeeAmount: withdrawResult.gasFees?.humanReadableAmount,
        gasFeeTokenDenom: withdrawResult.gasFees?.token.denom,
        gasFeeTokenName: withdrawResult.gasFees?.token.name,
        platformName: PlatformName.CETUS,
        txHash: withdrawResult.txHash,
        successful: true,
      });
    }

    return withdrawnPositions;
  }

  private async getSuiAccountBalances(): Promise<Record<string, TokenAmount>> {
    const suiAccount = new SuiAccount(this.address, this.environment);
    return await suiAccount.getAvailableBalances();
  }

  private async saveConfig(): Promise<void> {
    await fs.writeFile(
      this.configFilePath,
      JSON.stringify(this.config, undefined, 2),
      "utf-8"
    );
  }
}
