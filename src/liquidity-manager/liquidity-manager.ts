import { OfflineSigner } from "@cosmjs/proto-signing";
import { BigNumber } from "bignumber.js";
import fs from "fs/promises";
import path from "path";

import { OsmosisAccount, TokenAmount } from "../account-balances";
import {
  OSMOSIS_CREATE_POOL_FEE,
  OSMOSIS_WITHDRAW_LP_POSITION_FEE,
} from "./constants";
import { SQLiteTransactionRepository, TransactionType } from "../database";
import { SkipBridging } from "../ibc-bridging";
import {
  AbstractKeyStore,
  DEFAULT_KEY_NAME,
  KeyManager,
  KeyStoreType,
} from "../key-manager";
import {
  AuthorizedSpreadFactors,
  AuthorizedTickSpacing,
  OsmosisCLPool,
  OsmosisPoolManager,
  OsmosisTickMath,
} from "../osmosis-integration";
import { getPairPriceOnOsmosis } from "../prices";
import {
  ChainInfo,
  findArchwayChainInfo,
  findOsmosisChainInfo,
  findOsmosisTokensMap,
} from "../registry";
import { TokenRebalancer } from "./token-rebalancer";
import {
  assertEnoughBalanceForFees,
  getSignerAddress,
  getWorkingDirectory,
} from "../utils";

import {
  Config,
  LiquidityManagerConfig,
  MakeLiquidityManagerParams,
  PositionCreationResult,
  RebalanceResult,
  StatusResponse,
  WithdrawPositionResponse,
} from "./types";

export class LiquidityManager {
  public config: Config;
  private configPath: string;
  private poolManager: OsmosisPoolManager;
  private archwaySigner: OfflineSigner;
  private osmosisSigner: OfflineSigner;
  private osmosisAddress: string;
  private osmosisChainInfo: ChainInfo;
  private environment: "mainnet" | "testnet";
  private skipBridging: SkipBridging;
  private tokenRebalancer: TokenRebalancer;
  private database: SQLiteTransactionRepository;
  private keyStore: AbstractKeyStore;

  constructor(params: LiquidityManagerConfig) {
    this.config = params.config;
    this.configPath = params.configPath;
    this.archwaySigner = params.archwaySigner;
    this.osmosisSigner = params.osmosisSigner;
    this.osmosisAddress = params.osmosisAddress;
    this.environment = params.environment || "mainnet";
    this.osmosisChainInfo = findOsmosisChainInfo(this.environment);

    this.poolManager = new OsmosisPoolManager({
      environment: this.environment,
      rpcEndpoint: params.rpcEndpointsOverride?.[this.osmosisChainInfo.id],
      restEndpoint: params.restEndpointsOverride?.[this.osmosisChainInfo.id],
    });

    this.skipBridging = new SkipBridging(
      params.rpcEndpointsOverride,
      params.restEndpointsOverride
    );

    this.database = params.database;
    this.keyStore = params.keyStore;

    this.tokenRebalancer = new TokenRebalancer({
      archwaySigner: this.archwaySigner,
      osmosisSigner: this.osmosisSigner,
      environment: this.environment,
      skipBridging: this.skipBridging,
      database: this.database,
      keyStore: this.keyStore,
    });
  }

  static async make(
    params: MakeLiquidityManagerParams
  ): Promise<LiquidityManager> {
    const workingDir = await getWorkingDirectory();
    const configPath = path.join(workingDir, "config.json");
    const configContent = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(configContent) as Config;
    const keyStore = await KeyManager.create({
      type: KeyStoreType.ENV_VARIABLE,
    });

    const archwaySigner = await keyStore.getSigner(
      DEFAULT_KEY_NAME,
      findArchwayChainInfo(params.environment).prefix
    );
    const osmosisSigner = await keyStore.getSigner(
      DEFAULT_KEY_NAME,
      findOsmosisChainInfo(params.environment).prefix
    );
    const osmosisAddress = await getSignerAddress(osmosisSigner);

    const database = await SQLiteTransactionRepository.make(osmosisAddress);

    return new LiquidityManager({
      ...params,
      archwaySigner,
      osmosisSigner,
      osmosisAddress,
      config,
      configPath,
      database,
      keyStore,
    });
  }

  async execute(): Promise<RebalanceResult> {
    console.log("Starting liquidity management execution...");
    let osmosisBalances = await this.getOsmosisAccountBalances();

    // Get pool or create if it doesn't exist
    let pool: OsmosisCLPool;
    if (!this.config.osmosisPool.id) {
      console.log("No pool ID found, creating new pool...");
      assertEnoughBalanceForFees(
        osmosisBalances,
        this.osmosisChainInfo.nativeToken,
        OSMOSIS_CREATE_POOL_FEE,
        "creating a pool"
      );
      pool = await this.createPool();
      console.log(`Pool created with ID: ${pool.poolId}`);
      osmosisBalances = await this.getOsmosisAccountBalances();
    } else {
      console.log(`Using existing pool ID: ${this.config.osmosisPool.id}`);

      pool = await this.poolManager.getOsmosisCLPool(
        this.config.osmosisPool.id,
        this.osmosisSigner
      );

      if (
        !this.config.osmosisPool.token0 ||
        !this.config.osmosisPool.token1 ||
        !this.config.osmosisPool.tickSpacing ||
        !this.config.osmosisPool.spreadFactor ||
        !this.isValidTickSpacing()
      ) {
        console.log("Missing some pool config, will now query them onchain");
        await this.updatePoolInfoConfigFile(pool);
        console.log(
          `Config file updated for pool id ${this.config.osmosisPool.id}`
        );
      }
    }

    // Check if we have a position and if it needs rebalancing
    if (this.config.osmosisPosition.id) {
      console.log(
        `Checking position ${this.config.osmosisPosition.id} for rebalancing...`
      );

      try {
        const positionCheck = await pool.isPositionInRange(
          this.config.osmosisPosition.id,
          Number(this.config.rebalanceThresholdPercent)
        );

        if (positionCheck.isInRange) {
          console.log(
            `Position is in range (${positionCheck.percentageBalance.toFixed(
              2
            )}% balance). No rebalancing needed.`
          );
          return {
            poolId: pool.poolId,
            positionId: this.config.osmosisPosition.id,
            action: "none",
            message: `Position in range at ${positionCheck.percentageBalance.toFixed(
              2
            )}% balance`,
          };
        }

        console.log(
          `Position out of range (${positionCheck.percentageBalance.toFixed(
            2
          )}% balance). Rebalancing needed...`
        );

        // Withdraw position
        assertEnoughBalanceForFees(
          osmosisBalances,
          this.osmosisChainInfo.nativeToken,
          OSMOSIS_WITHDRAW_LP_POSITION_FEE,
          "withdraw position"
        );
        console.log("Withdrawing position...");
        const positionInfo = await pool.getPositionInfo(
          this.config.osmosisPosition.id
        );
        await pool.withdrawPosition({
          positionId: this.config.osmosisPosition.id,
          liquidityAmount: positionInfo.position.liquidity,
        });

        // Clear position ID from config
        this.config.osmosisPosition.id = "";
        await this.saveConfig();
        osmosisBalances = await this.getOsmosisAccountBalances();
      } catch (error) {
        console.error(
          "Error checking position, it might not exist. Creating new position...",
          error
        );
        this.config.osmosisPosition.id = "";
        await this.saveConfig();
      }
    }

    // Create new position
    console.log("Creating new position...");
    const positionResult = await this.createPosition(pool, osmosisBalances);

    return {
      poolId: pool.poolId,
      positionId: positionResult.positionId,
      action: this.config.osmosisPosition.id ? "rebalanced" : "created",
      message: `Position ${positionResult.positionId} created with liquidity ${positionResult.liquidityCreated}`,
    };
  }

  private async createPool(): Promise<OsmosisCLPool> {
    const poolConfig = this.config.osmosisPool;

    const result = await this.poolManager.createOsmosisCLPool(
      {
        token0: poolConfig.token0,
        token1: poolConfig.token1,
        tickSpacing: poolConfig.tickSpacing as AuthorizedTickSpacing,
        spreadFactor: poolConfig.spreadFactor as AuthorizedSpreadFactors,
        environment: this.environment,
      },
      this.osmosisSigner
    );

    this.database.addTransaction({
      signerAddress: this.osmosisAddress,
      chainId: this.osmosisChainInfo.id,
      transactionType: TransactionType.CREATE_POOL,
      gasFeeAmount: result.gasFees?.amount,
      gasFeeToken: result.gasFees?.denom,
      txHash: result.txHash,
      successful: true,
    });

    // Update config with new pool ID
    this.config.osmosisPool.id = result.pool.poolId;
    await this.saveConfig();

    return result.pool;
  }

  private async updatePoolInfoConfigFile(
    pool: OsmosisCLPool
  ): Promise<OsmosisCLPool> {
    const poolInfo = await pool.getPoolInfo();

    // Update pool object
    pool.token0 = poolInfo.token0;
    pool.token1 = poolInfo.token1;

    // Update pool config
    this.config.osmosisPool.token0 = poolInfo.token0;
    this.config.osmosisPool.token1 = poolInfo.token1;
    this.config.osmosisPool.tickSpacing = Number(poolInfo.tickSpacing);
    this.config.osmosisPool.spreadFactor = Number(poolInfo.spreadFactor);
    await this.saveConfig();

    return pool;
  }

  private async createPosition(
    pool: OsmosisCLPool,
    osmosisBalances?: Record<string, TokenAmount>
  ): Promise<PositionCreationResult> {
    // Get token registry
    const tokenMap = findOsmosisTokensMap(this.environment);

    const token0 = tokenMap[this.config.osmosisPool.token0];
    const token1 = tokenMap[this.config.osmosisPool.token1];

    if (!token0 || !token1) {
      throw new Error("Pool tokens not found in registry");
    }

    // Get current balances
    const innerOsmosisBalances =
      osmosisBalances ?? (await this.getOsmosisAccountBalances());

    const balance0 =
      innerOsmosisBalances[token0.denom] ?? new TokenAmount(0, token0);
    const balance1 =
      innerOsmosisBalances[token1.denom] ?? new TokenAmount(0, token1);

    console.log(
      `Current balances: ${balance0.humanReadableAmount} ${token0.name}, ${balance1.humanReadableAmount} ${token1.name}`
    );

    // Get current price and calculate tick range
    const currentPrice = await getPairPriceOnOsmosis(
      token0,
      token1,
      this.environment
    );
    const bandPercentage = BigNumber(
      this.config.osmosisPosition.bandPercentage
    ).div(100);

    const lowerPrice = BigNumber(currentPrice).times(
      BigNumber(1).minus(bandPercentage)
    );
    const upperPrice = BigNumber(currentPrice).times(
      BigNumber(1).plus(bandPercentage)
    );

    // Convert prices to ticks with proper rounding
    if (!this.isValidTickSpacing()) {
      throw new Error(
        `Invalid tick spacing of ${this.config.osmosisPool.tickSpacing} on the osmosis pool config file`
      );
    }

    const tickSpacing = this.config.osmosisPool
      .tickSpacing as AuthorizedTickSpacing;

    const lowerTick = OsmosisTickMath.roundToTickSpacing(
      OsmosisTickMath.priceToTick(lowerPrice),
      tickSpacing
    );
    const upperTick = OsmosisTickMath.roundToTickSpacing(
      OsmosisTickMath.priceToTick(upperPrice),
      tickSpacing
    );

    console.log(
      `Price range: ${lowerPrice.toFixed(6)} - ${upperPrice.toFixed(6)}`
    );
    console.log(`Tick range: ${lowerTick} - ${upperTick}`);

    // Rebalance tokens if needed
    const rebalancedAmounts =
      await this.tokenRebalancer.rebalanceTokensFor5050Deposit(
        token0,
        token1,
        currentPrice,
        osmosisBalances
      );

    console.log(
      `Depositing: ${rebalancedAmounts.token0.humanReadableAmount} ${token0.name}, ${rebalancedAmounts.token1.humanReadableAmount} ${token1.name}`
    );

    // Create position
    const result = await pool.createPosition({
      lowerTick,
      upperTick,
      tokensProvided: [
        {
          denom: token0.denom,
          amount: rebalancedAmounts.token0.amount,
        },
        {
          denom: token1.denom,
          amount: rebalancedAmounts.token1.amount,
        },
      ],
      tokenMinAmount0: "0",
      tokenMinAmount1: "0",
    });

    console.log(
      `Actual deposited amounts: ${
        new TokenAmount(result.amount0, token0).humanReadableAmount
      } ${token0.name}, ${
        new TokenAmount(result.amount1, token1).humanReadableAmount
      } ${token1.name}`
    );

    this.database.addTransaction({
      signerAddress: this.osmosisAddress,
      chainId: this.osmosisChainInfo.id,
      transactionType: TransactionType.CREATE_POSITION,
      inputAmount: result.amount0,
      inputToken: token0.denom,
      secondInputAmount: result.amount1,
      secondInputToken: token1.denom,
      gasFeeAmount: result.gasFees?.amount,
      gasFeeToken: result.gasFees?.denom,
      txHash: result.txHash,
      successful: true,
    });

    // Update config with position ID
    this.config.osmosisPosition.id = result.positionId;
    await this.saveConfig();

    return result;
  }

  async getStatus(): Promise<StatusResponse> {
    if (!this.config.osmosisPool.id) {
      return {};
    }

    const pool = await this.poolManager.getOsmosisCLPool(
      this.config.osmosisPool.id,
      this.osmosisSigner
    );
    const poolInfo = await pool.getPoolInfo();

    if (!this.config.osmosisPosition.id) {
      return {
        poolInfo,
      };
    }

    const positionInfo = await pool.getPositionInfo(
      this.config.osmosisPosition.id
    );
    const positionRange = await pool.isPositionInRange(
      this.config.osmosisPosition.id,
      Number(this.config.rebalanceThresholdPercent)
    );

    return {
      poolInfo,
      positionInfo,
      positionRange,
      positionLowerPrice: OsmosisTickMath.tickToPrice(
        positionInfo.position.lowerTick
      ),
      positionUpperPrice: OsmosisTickMath.tickToPrice(
        positionInfo.position.upperTick
      ),
    };
  }

  async withdrawPosition(): Promise<WithdrawPositionResponse> {
    // Get pool
    if (!this.config.osmosisPool.id) {
      throw new Error("No pool ID found");
    }

    const pool = await this.poolManager.getOsmosisCLPool(
      this.config.osmosisPool.id,
      this.osmosisSigner
    );

    const osmosisBalances = await this.getOsmosisAccountBalances();

    assertEnoughBalanceForFees(
      osmosisBalances,
      this.osmosisChainInfo.nativeToken,
      OSMOSIS_WITHDRAW_LP_POSITION_FEE,
      "withdraw position"
    );

    // Withdraw position
    console.log("Withdrawing position...");
    const positionInfo = await pool.getPositionInfo(
      this.config.osmosisPosition.id
    );
    const tokenMap = findOsmosisTokensMap(this.environment);

    const token0 = tokenMap[this.config.osmosisPool.token0];
    const token1 = tokenMap[this.config.osmosisPool.token1];

    if (!token0 || !token1) {
      throw new Error("Pool tokens not found in registry");
    }

    const result = await pool.withdrawPosition({
      positionId: this.config.osmosisPosition.id,
      liquidityAmount: positionInfo.position.liquidity,
    });

    this.database.addTransactionBatch([
      {
        signerAddress: this.osmosisAddress,
        chainId: this.osmosisChainInfo.id,
        transactionType: TransactionType.WITHDRAW_POSITION,
        outputAmount: result.amount0,
        outputToken: token0.denom,
        secondOutputAmount: result.amount1,
        secondOutputToken: token1.denom,
        gasFeeAmount: result.gasFees?.amount,
        gasFeeToken: result.gasFees?.denom,
        txHash: result.txHash,
        successful: true,
      },
      ...(result.rewardsCollected?.length
        ? [
            {
              signerAddress: this.osmosisAddress,
              chainId: this.osmosisChainInfo.id,
              transactionType: TransactionType.COLLECT_SPREAD_REWARDS,
              outputAmount: result.rewardsCollected[0]?.amount,
              outputToken: result.rewardsCollected[0]?.denom,
              secondOutputAmount: result.rewardsCollected[1]?.amount,
              secondOutputToken: result.rewardsCollected[1]?.denom,
              txHash: result.txHash,
              txActionIndex: 1,
              successful: true,
            },
          ]
        : []),
    ]);

    const amount0Withdrawn = new TokenAmount(result.amount0, token0);
    const amount1Withdrawn = new TokenAmount(result.amount1, token1);

    console.log(
      `Withdrew ${amount0Withdrawn.humanReadableAmount} ${token0.name} and ${amount1Withdrawn.humanReadableAmount} ${token1.name}`
    );

    if (result.rewardsCollected?.length) {
      const amount0Rewards = new TokenAmount(
        result.rewardsCollected[0]!.amount,
        token0.denom === result.rewardsCollected[0]?.denom ? token0 : token1
      );
      const amount1Rewards = result.rewardsCollected[1]?.amount
        ? new TokenAmount(
            result.rewardsCollected[1].amount,
            token0.denom === result.rewardsCollected[1].denom ? token0 : token1
          )
        : undefined;

      console.log(
        `Claimed ${amount0Rewards.humanReadableAmount} ${
          amount0Rewards.token.name
        } ${
          amount1Rewards
            ? `and ${amount1Rewards.humanReadableAmount} ${amount1Rewards.token.name}`
            : ""
        } in Spread Rewards`
      );
    }

    // Clear position ID from config
    this.config.osmosisPosition.id = "";
    await this.saveConfig();

    return {
      amount0Withdrawn,
      amount1Withdrawn,
    };
  }

  private isValidTickSpacing(): boolean {
    const AUTHORIZED_TICK_SPACING_SET = new Set<AuthorizedTickSpacing>([
      1, 10, 100, 1000,
    ]);
    return AUTHORIZED_TICK_SPACING_SET.has(
      this.config.osmosisPool.tickSpacing as AuthorizedTickSpacing
    );
  }

  private async getOsmosisAccountBalances(): Promise<
    Record<string, TokenAmount>
  > {
    const osmosisAccount = new OsmosisAccount(
      this.osmosisAddress,
      this.environment
    );
    return await osmosisAccount.getAvailableBalances();
  }

  private async saveConfig(): Promise<void> {
    await fs.writeFile(
      this.configPath,
      JSON.stringify(this.config, null, 2),
      "utf-8"
    );
  }
}
