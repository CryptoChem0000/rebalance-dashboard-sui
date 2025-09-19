import { DirectSecp256k1HdWallet, OfflineSigner } from "@cosmjs/proto-signing";
import { BigNumber } from "bignumber.js";
import fs from "fs/promises";
import path from "path";

import { OsmosisAccount } from "../account-balances";
import { SkipBridging } from "../ibc-bridging";
import { KeyManager, KeyStoreType } from "../key-manager";
import {
  AuthorizedSpreadFactors,
  AuthorizedTickSpacing,
  OsmosisCLPool,
  OsmosisPoolManager,
  OsmosisTickMath,
} from "../osmosis-integration";
import { getPairPriceOnOsmosis } from "../prices";
import {
  findArchwayChainInfo,
  findOsmosisChainInfo,
  findOsmosisTokensMap,
} from "../registry";
import { TokenRebalancer } from "./token-rebalancer";
import { getSignerAddress, getWorkingDirectory } from "../utils";

import {
  Config,
  LiquidityManagerConfig,
  PositionCreationResult,
  RebalanceResult,
  StatusResponse,
  TokenPairBalances,
} from "./types";

export class LiquidityManager {
  public config: Config;
  private configPath: string;
  private poolManager: OsmosisPoolManager;
  private archwaySigner: OfflineSigner;
  private osmosisSigner: OfflineSigner;
  private environment: "mainnet" | "testnet";
  private skipBridging: SkipBridging;
  private tokenRebalancer: TokenRebalancer;

  constructor(params: LiquidityManagerConfig) {
    this.config = params.config;
    this.configPath = params.configPath;
    this.archwaySigner = params.archwaySigner;
    this.osmosisSigner = params.osmosisSigner;
    this.environment = params.environment || "mainnet";

    this.poolManager = new OsmosisPoolManager({
      environment: this.environment,
      rpcEndpoint:
        params.rpcEndpointsOverride?.[
          findOsmosisChainInfo(this.environment).id
        ],
      restEndpoint:
        params.restEndpointsOverride?.[
          findOsmosisChainInfo(this.environment).id
        ],
    });

    this.skipBridging = new SkipBridging(
      params.rpcEndpointsOverride,
      params.restEndpointsOverride
    );

    this.tokenRebalancer = new TokenRebalancer({
      archwaySigner: this.archwaySigner,
      osmosisSigner: this.osmosisSigner,
      environment: this.environment,
      skipBridging: this.skipBridging,
    });
  }

  static async make(
    params: Omit<
      LiquidityManagerConfig,
      "config" | "configPath" | "osmosisSigner" | "archwaySigner"
    >
  ): Promise<LiquidityManager> {
    const workingDir = await getWorkingDirectory();
    const configPath = path.join(workingDir, "config.json");
    const configContent = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(configContent) as Config;
    let mnemonic = await (
      await KeyManager.create({ type: KeyStoreType.ENV_VARIABLE })
    ).getKey("MNEMONIC");

    const archwaySigner = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
      prefix: findArchwayChainInfo(params.environment).prefix,
    });
    const osmosisSigner = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
      prefix: findOsmosisChainInfo(params.environment).prefix,
    });

    mnemonic = "";

    return new LiquidityManager({
      ...params,
      archwaySigner,
      osmosisSigner,
      config,
      configPath,
    });
  }

  async execute(): Promise<RebalanceResult> {
    console.log("Starting liquidity management execution...");

    // Get pool or create if it doesn't exist
    let pool: OsmosisCLPool;
    if (!this.config.osmosisPool.id) {
      console.log("No pool ID found, creating new pool...");
      pool = await this.createPool();
      console.log(`Pool created with ID: ${pool.poolId}`);
    } else {
      console.log(`Using existing pool ID: ${this.config.osmosisPool.id}`);
      pool = await this.poolManager.getOsmosisCLPool(
        this.config.osmosisPool.id,
        this.osmosisSigner
      );
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
    const positionResult = await this.createPosition(pool);

    return {
      poolId: pool.poolId,
      positionId: positionResult.positionId,
      action: this.config.osmosisPosition.id ? "rebalanced" : "created",
      message: `Position ${positionResult.positionId} created with liquidity ${positionResult.liquidityCreated}`,
    };
  }

  private async createPool(): Promise<OsmosisCLPool> {
    const poolConfig = this.config.osmosisPool;

    const pool = await this.poolManager.createOsmosisCLPool(
      {
        token0: poolConfig.token0,
        token1: poolConfig.token1,
        tickSpacing: poolConfig.tickSpacing as AuthorizedTickSpacing,
        spreadFactor: poolConfig.spreadFactor as AuthorizedSpreadFactors,
        environment: this.environment,
      },
      this.osmosisSigner
    );

    // Update config with new pool ID
    this.config.osmosisPool.id = pool.poolId;
    await this.saveConfig();

    return pool;
  }

  private async createPosition(
    pool: OsmosisCLPool
  ): Promise<PositionCreationResult> {
    const osmosisAddress = await getSignerAddress(this.osmosisSigner);
    const osmosisAccount = new OsmosisAccount(osmosisAddress, this.environment);

    // Get token registry
    const tokenMap = findOsmosisTokensMap(this.environment);

    const token0 = tokenMap[this.config.osmosisPool.token0];
    const token1 = tokenMap[this.config.osmosisPool.token1];

    if (!token0 || !token1) {
      throw new Error("Pool tokens not found in registry");
    }

    // Get current balances
    const balance0 = await osmosisAccount.getTokenAvailableBalance(
      token0.denom
    );
    const balance1 = await osmosisAccount.getTokenAvailableBalance(
      token1.denom
    );

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
    const poolInfo = await pool.getPoolInfo();
    const tickSpacing = Number(poolInfo.tickSpacing) as AuthorizedTickSpacing;

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

    // Calculate required amounts for 50/50 deposit
    const balances: TokenPairBalances = {
      token0: balance0,
      token1: balance1,
    };

    // Rebalance tokens if needed
    const rebalancedAmounts =
      await this.tokenRebalancer.rebalanceTokensFor5050Deposit(
        balances,
        currentPrice
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

  private async saveConfig(): Promise<void> {
    await fs.writeFile(
      this.configPath,
      JSON.stringify(this.config, null, 2),
      "utf-8"
    );
  }
}
