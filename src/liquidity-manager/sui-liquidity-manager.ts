import { BoltSuiClient } from "@bolt-liquidity-hq/sui-client";
import { TickMath } from "@cetusprotocol/common-sdk";
import { Pool } from "@cetusprotocol/sui-clmm-sdk";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { BigNumber } from "bignumber.js";
import fs from "fs/promises";

import { SuiAccount, TokenAmount } from "../account-balances";
import {
  CetusCLPoolManager,
  DEFAULT_POSITION_SLIPPAGE,
  extractGasFees,
} from "../cetus-integration";
import { loadConfigWithEnvOverrides } from "./config-loader";
import {
  CETUS_CREATE_LP_POSITION_FEE,
  CETUS_WITHDRAW_LP_POSITION_FEE,
  SUI_BOLT_SWAP_FEE,
} from "./constants";
import {
  AccountTransaction,
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
      const loadResult = await loadConfigWithEnvOverrides(
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
    const POSITION_SLIPPAGE = DEFAULT_POSITION_SLIPPAGE; // 1%
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
    const bandPercentage = BigNumber(this.config.positionBandPercentage).div(
      100
    );
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

    // Based on empirical observation, Cetus requires much more token1 than theory suggests
    // Let's use a very conservative approach: assume we can only use about 30-40% of our total value as token0
    const conservativeToken0Ratio = 0.35; // Use only 35% of total value as token0
    const idealToken0ToKeep = totalValueInToken0.times(conservativeToken0Ratio);

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

    const refreshedLowerPrice = BigNumber(refreshedPriceHumanReadable)
      .times(BigNumber(1).minus(bandPercentage))
      .toFixed(token1.decimals);
    const refreshedUpperPrice = BigNumber(refreshedPriceHumanReadable)
      .times(BigNumber(1).plus(bandPercentage))
      .toFixed(token1.decimals);

    console.log(
      `Available safe balances after swap: ${safeBalance0.humanReadableAmount} ${token0.name}, ${safeBalance1.humanReadableAmount} ${token1.name}`
    );

    const refreshedPrice = BigNumber(refreshedPriceHumanReadable).shiftedBy(
      token1.decimals - token0.decimals
    );
    const finalSafeToken0Amount = BigNumber(safeBalance0.amount);
    const finalSafeToken1Amount = BigNumber(safeBalance1.amount);

    const finalToken1ValueInToken0 = finalSafeToken1Amount.div(refreshedPrice);
    const finalTotalValueInToken0 = finalSafeToken0Amount.plus(
      finalToken1ValueInToken0
    );

    // Use the same conservative approach for final calculation
    const conservativeToken0RatioFinal = 0.35; // Use only 35% of total value as token0
    const optimalFinalToken0 = BigNumber.min(
      finalTotalValueInToken0.times(conservativeToken0RatioFinal),
      finalSafeToken0Amount
    );

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

    // Execute swap
    console.log(
      `Swapping ${
        new TokenAmount(amountToSwap.toFixed(0), swapFromToken)
          .humanReadableAmount
      } ${swapFromToken.name} for ${swapToToken.name}...`
    );

    const innerSuiBalances =
      suiBalances ?? (await this.getSuiAccountBalances());
    assertEnoughBalanceForFees(
      innerSuiBalances,
      this.chainInfo.nativeToken,
      BigNumber(SUI_BOLT_SWAP_FEE),
      "swap on Bolt"
    );

    const swapResult = await this.boltClient.swap(
      {
        amountIn: amountToSwap.toFixed(0),
        assetIn,
        assetOut,
      },
      this.signer
    );

    const swapGasFees = extractGasFees(
      swapResult.txOutput,
      this.chainInfo.nativeToken
    );

    // Log swap transaction
    await this.database.addTransaction({
      signerAddress: this.address,
      chainId: this.chainInfo.id,
      transactionType: TransactionType.BOLT_SUI_SWAP,
      inputAmount: new TokenAmount(amountToSwap.toFixed(0), swapFromToken)
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
