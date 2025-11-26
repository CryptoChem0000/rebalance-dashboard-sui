import { OfflineSigner } from "@cosmjs/proto-signing";
import { BigNumber } from "bignumber.js";
import fs from "fs/promises";

import { OsmosisAccount, TokenAmount } from "../account-balances";
import { loadConfigWithEnvOverrides } from "./config-loader";
import { OSMOSIS_WITHDRAW_LP_POSITION_FEE } from "./constants";
import {
  PostgresTransactionRepository,
  SQLiteTransactionRepository,
  TransactionRepository,
  TransactionType,
} from "../database";
import { SkipBridging } from "../ibc-bridging";
import {
  AbstractKeyStore,
  DEFAULT_KEY_NAME,
  KeyManager,
  KeyStoreType,
} from "../key-manager";
import {
  AuthorizedTickSpacing,
  OsmosisCLPoolManager,
  OsmosisTickMath,
} from "../osmosis-integration";
import {
  ChainInfo,
  findArchwayChainInfo,
  findOsmosisChainInfo,
} from "../registry";
import { TokenRebalancer } from "./token-rebalancer";
import { assertEnoughBalanceForFees, getSignerAddress } from "../utils";

import {
  Config,
  OsmosisLiquidityManagerConfig,
  MakeOsmosisLiquidityManagerParams,
  CreatePositionResult,
  RebalanceResult,
  StatusResponse,
  WithdrawPositionResult,
  StatusPoolInfo,
} from "./types";

export class OsmosisLiquidityManager {
  public config: Config;
  private configFilePath: string;
  private osmosisPoolManager: OsmosisCLPoolManager;
  private archwaySigner: OfflineSigner;
  private osmosisSigner: OfflineSigner;
  private osmosisAddress: string;
  private osmosisChainInfo: ChainInfo;
  private environment: "mainnet" | "testnet";
  private skipBridging: SkipBridging;
  private tokenRebalancer: TokenRebalancer;
  public database: TransactionRepository;
  private keyStore: AbstractKeyStore;

  constructor(params: OsmosisLiquidityManagerConfig) {
    this.config = params.config;
    this.configFilePath = params.configFilePath;
    this.archwaySigner = params.archwaySigner;
    this.osmosisSigner = params.osmosisSigner;
    this.osmosisAddress = params.osmosisAddress;
    this.environment = params.environment || "mainnet";
    this.osmosisChainInfo = findOsmosisChainInfo(this.environment);

    this.osmosisPoolManager = params.osmosisPoolManager;

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
    params: MakeOsmosisLiquidityManagerParams
  ): Promise<OsmosisLiquidityManager> {
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

    const archwaySigner = await keyStore.getCosmWasmSigner(
      DEFAULT_KEY_NAME,
      findArchwayChainInfo(params.environment).prefix
    );
    const osmosisSigner = await keyStore.getCosmWasmSigner(
      DEFAULT_KEY_NAME,
      findOsmosisChainInfo(params.environment).prefix
    );
    const osmosisAddress = await getSignerAddress(osmosisSigner);

    const database = await (process.env.DATABASE_URL
      ? PostgresTransactionRepository.make()
      : SQLiteTransactionRepository.make(osmosisAddress));

    const osmosisPoolManager = await OsmosisCLPoolManager.make(
      osmosisSigner,
      config.poolId,
      params.environment,
      params.rpcEndpointsOverride?.[findOsmosisChainInfo(params.environment).id]
    );

    return new OsmosisLiquidityManager({
      ...params,
      archwaySigner,
      osmosisSigner,
      osmosisAddress,
      config,
      configFilePath,
      osmosisPoolManager,
      database,
      keyStore,
    });
  }

  async execute(): Promise<RebalanceResult> {
    console.log("Starting liquidity management execution...");
    let osmosisBalances = await this.getOsmosisAccountBalances();

    // Withdraw unknown existing positions if any
    const unknownPositionsResult = await this.withdrawUnknownPositions(
      this.config.positionId
    );

    // Refresh balance if there were unknown positions
    if (unknownPositionsResult.length > 0) {
      osmosisBalances = await this.getOsmosisAccountBalances();
    }

    // Check if we have a position and if it needs rebalancing
    if (this.config.positionId) {
      console.log(
        `Checking position ${this.config.positionId} for rebalancing...`
      );

      try {
        const positionCheck = await this.osmosisPoolManager.isPositionInRange(
          this.config.positionId,
          Number(this.config.rebalanceThresholdPercent)
        );

        if (positionCheck.isInRange) {
          console.log(
            `Position is in range (${positionCheck.percentageBalance.toFixed(
              2
            )}% balance). No rebalancing needed.`
          );
          return {
            poolId: this.config.poolId,
            positionId: this.config.positionId,
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
        await this.withdrawPosition();

        osmosisBalances = await this.getOsmosisAccountBalances();
      } catch (error: any) {
        if (error?.message?.includes?.("position not found")) {
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

    // Create new position
    console.log("Creating new position...");
    const positionResult = await this.createPosition(osmosisBalances);

    return {
      poolId: this.config.poolId,
      positionId: positionResult.positionId,
      action: this.config.positionId ? "rebalanced" : "created",
      message: `Position ${positionResult.positionId} created with liquidity ${positionResult.liquidityCreated}`,
    };
  }

  private async createPosition(
    osmosisBalances?: Record<string, TokenAmount>
  ): Promise<CreatePositionResult> {
    // Get current balances
    const innerOsmosisBalances =
      osmosisBalances ?? (await this.getOsmosisAccountBalances());

    const balance0 =
      innerOsmosisBalances[this.osmosisPoolManager.token0.denom] ??
      new TokenAmount(0, this.osmosisPoolManager.token0);
    const balance1 =
      innerOsmosisBalances[this.osmosisPoolManager.token1.denom] ??
      new TokenAmount(0, this.osmosisPoolManager.token1);

    console.log(
      `Current balances on Osmosis: ${balance0.humanReadableAmount} ${this.osmosisPoolManager.token0.name}, ${balance1.humanReadableAmount} ${this.osmosisPoolManager.token1.name}`
    );

    // Get INITIAL price for rebalancing calculations
    const initialPrice = await this.osmosisPoolManager.getPoolPrice();

    // Rebalance tokens if needed - now considers both chains
    const rebalancedAmounts =
      await this.tokenRebalancer.rebalanceTokensFor5050Deposit(
        this.osmosisPoolManager.token0,
        this.osmosisPoolManager.token1,
        initialPrice,
        innerOsmosisBalances // Pass current osmosis balances to avoid re-fetching
      );

    console.log(
      `After rebalancing - available amounts: ${rebalancedAmounts.token0.humanReadableAmount} ${this.osmosisPoolManager.token0.name}, ${rebalancedAmounts.token1.humanReadableAmount} ${this.osmosisPoolManager.token1.name}`
    );

    // CRITICAL: Get the CURRENT price again after all rebalancing operations
    const currentPrice = await this.osmosisPoolManager.getPoolPrice();

    // Check if price has moved significantly
    const priceDrift = BigNumber(currentPrice)
      .minus(initialPrice)
      .abs()
      .div(initialPrice);

    if (priceDrift.gt(0.01)) {
      // More than 1% drift
      console.log(
        `Price has moved ${priceDrift
          .times(100)
          .toFixed(2)}% during rebalancing. ` +
          `Initial: ${BigNumber(initialPrice)
            .shiftedBy(
              this.osmosisPoolManager.token0.decimals -
                this.osmosisPoolManager.token1.decimals
            )
            .toFixed(
              this.osmosisPoolManager.token1.decimals
            )}, Current: ${BigNumber(currentPrice)
            .shiftedBy(
              this.osmosisPoolManager.token0.decimals -
                this.osmosisPoolManager.token1.decimals
            )
            .toFixed(this.osmosisPoolManager.token1.decimals)}`
      );
    }

    // Calculate tick range using the CURRENT price
    const bandPercentage = BigNumber(this.config.positionBandPercentage).div(
      100
    );

    const lowerPrice = BigNumber(currentPrice)
      .times(BigNumber(1).minus(bandPercentage))
      .decimalPlaces(
        this.osmosisPoolManager.token0.decimals,
        BigNumber.ROUND_FLOOR
      );
    const upperPrice = BigNumber(currentPrice)
      .times(BigNumber(1).plus(bandPercentage))
      .decimalPlaces(
        this.osmosisPoolManager.token0.decimals,
        BigNumber.ROUND_FLOOR
      );

    const tickSpacing = this.validateTickSpacing();

    const lowerTick = OsmosisTickMath.roundToTickSpacing(
      OsmosisTickMath.priceToTick(lowerPrice),
      tickSpacing
    );
    const upperTick = OsmosisTickMath.roundToTickSpacing(
      OsmosisTickMath.priceToTick(upperPrice),
      tickSpacing
    );

    console.log(
      `Price range: ${BigNumber(lowerPrice)
        .shiftedBy(
          this.osmosisPoolManager.token0.decimals -
            this.osmosisPoolManager.token1.decimals
        )
        .toFixed(this.osmosisPoolManager.token1.decimals)} - ${BigNumber(
        upperPrice
      )
        .shiftedBy(
          this.osmosisPoolManager.token0.decimals -
            this.osmosisPoolManager.token1.decimals
        )
        .toFixed(
          this.osmosisPoolManager.token1.decimals
        )} (based on current price: ${BigNumber(currentPrice)
        .shiftedBy(
          this.osmosisPoolManager.token0.decimals -
            this.osmosisPoolManager.token1.decimals
        )
        .toFixed(this.osmosisPoolManager.token1.decimals)})`
    );
    console.log(`Tick range: ${lowerTick} - ${upperTick}`);

    console.log(
      `Depositing: ${rebalancedAmounts.token0.humanReadableAmount} ${this.osmosisPoolManager.token0.name}, ${rebalancedAmounts.token1.humanReadableAmount} ${this.osmosisPoolManager.token1.name}`
    );

    // Create position with current ticks
    const result = await this.osmosisPoolManager.createPosition({
      lowerTick,
      upperTick,
      tokensProvided: [
        {
          denom: this.osmosisPoolManager.token0.denom,
          amount: rebalancedAmounts.token0.amount,
        },
        {
          denom: this.osmosisPoolManager.token1.denom,
          amount: rebalancedAmounts.token1.amount,
        },
      ],
      tokenMinAmount0: "0",
      tokenMinAmount1: "0",
    });

    console.log(
      `Actual deposited amounts: ${result.tokenAmount0.humanReadableAmount} ${this.osmosisPoolManager.token0.name}, ${result.tokenAmount1.humanReadableAmount} ${this.osmosisPoolManager.token1.name}`
    );

    this.database.addTransaction({
      signerAddress: this.osmosisAddress,
      chainId: this.osmosisChainInfo.id,
      transactionType: TransactionType.CREATE_POSITION,
      positionId: result.positionId,
      inputAmount: result.tokenAmount0.humanReadableAmount,
      inputTokenDenom: result.tokenAmount0.token.denom,
      inputTokenName: result.tokenAmount0.token.name,
      secondInputAmount: result.tokenAmount1.humanReadableAmount,
      secondInputTokenDenom: result.tokenAmount1.token.denom,
      secondInputTokenName: result.tokenAmount1.token.name,
      gasFeeAmount: result.gasFees?.humanReadableAmount,
      gasFeeTokenDenom: result.gasFees?.token.denom,
      gasFeeTokenName: result.gasFees?.token.name,
      txHash: result.txHash,
      successful: true,
    });

    // Update config with position ID
    this.config.positionId = result.positionId;
    await this.saveConfig();

    return result;
  }

  async getStatus(): Promise<StatusResponse> {
    if (!this.config.poolId) {
      return {};
    }

    const poolInfo: StatusPoolInfo = {
      id: this.osmosisPoolManager.poolInfo.id,
      token0: this.osmosisPoolManager.token0.denom,
      token1: this.osmosisPoolManager.token1.denom,
      currentTick: this.osmosisPoolManager.poolInfo.currentTick,
      tickSpacing: this.osmosisPoolManager.poolInfo.tickSpacing,
      spreadFactor: this.osmosisPoolManager.poolInfo.spreadFactor,
    };

    if (!this.config.positionId) {
      return {
        poolInfo,
      };
    }

    const positionInfoResponse = await this.osmosisPoolManager.getPositionInfo(
      this.config.positionId
    );
    const range = await this.osmosisPoolManager.isPositionInRange(
      this.config.positionId,
      Number(this.config.rebalanceThresholdPercent)
    );

    return {
      poolInfo: this.osmosisPoolManager.poolInfo,
      positionInfo: {
        id: positionInfoResponse.position.positionId,
        lowerTick: positionInfoResponse.position.lowerTick,
        upperTick: positionInfoResponse.position.upperTick,
        lowerPrice: OsmosisTickMath.tickToPrice(
          positionInfoResponse.position.lowerTick
        ),
        upperPrice: OsmosisTickMath.tickToPrice(
          positionInfoResponse.position.upperTick
        ),
        liquidity: positionInfoResponse.position.liquidity,
        asset0: positionInfoResponse.asset0,
        asset1: positionInfoResponse.asset1,
        range,
      },
    };
  }

  async withdrawPosition(): Promise<WithdrawPositionResult> {
    await this.withdrawUnknownPositions(this.config.positionId);

    const osmosisBalances = await this.getOsmosisAccountBalances();

    assertEnoughBalanceForFees(
      osmosisBalances,
      this.osmosisChainInfo.nativeToken,
      OSMOSIS_WITHDRAW_LP_POSITION_FEE,
      "withdraw position"
    );

    if (!this.config.positionId) {
      throw new Error("No position ID found");
    }

    // Withdraw position
    console.log("Withdrawing position...");
    const positionInfo = await this.osmosisPoolManager.getPositionInfo(
      this.config.positionId
    );

    const result = await this.osmosisPoolManager.withdrawPosition({
      positionId: this.config.positionId,
      liquidityAmount: positionInfo.position.liquidity,
    });

    this.database.addTransactionBatch([
      {
        signerAddress: this.osmosisAddress,
        chainId: this.osmosisChainInfo.id,
        transactionType: TransactionType.WITHDRAW_POSITION,
        positionId: this.config.positionId,
        outputAmount: result.tokenAmount0.humanReadableAmount,
        outputTokenDenom: result.tokenAmount0.token.denom,
        outputTokenName: result.tokenAmount0.token.name,
        secondOutputAmount: result.tokenAmount1.humanReadableAmount,
        secondOutputTokenDenom: result.tokenAmount1.token.denom,
        secondOutputTokenName: result.tokenAmount1.token.name,
        gasFeeAmount: result.gasFees?.humanReadableAmount,
        gasFeeTokenDenom: result.gasFees?.token.denom,
        gasFeeTokenName: result.gasFees?.token.name,
        txHash: result.txHash,
        successful: true,
      },
      ...(result.rewardsCollected?.length
        ? [
            {
              signerAddress: this.osmosisAddress,
              chainId: this.osmosisChainInfo.id,
              transactionType: TransactionType.COLLECT_SPREAD_REWARDS,
              positionId: this.config.positionId,
              outputAmount: result.rewardsCollected[0]?.humanReadableAmount,
              outputTokenDenom: result.rewardsCollected[0]?.token.denom,
              outputTokenName: result.rewardsCollected[0]?.token.name,
              secondOutputAmount:
                result.rewardsCollected[1]?.humanReadableAmount,
              secondOutputTokenDenom: result.rewardsCollected[1]?.token.denom,
              secondOutputTokenName: result.rewardsCollected[1]?.token.name,
              txHash: result.txHash,
              txActionIndex: 1,
              successful: true,
            },
          ]
        : []),
    ]);

    console.log(
      `Withdrew ${result.tokenAmount0.humanReadableAmount} ${this.osmosisPoolManager.token0.name} and ${result.tokenAmount1.humanReadableAmount} ${this.osmosisPoolManager.token1.name}`
    );

    if (result.rewardsCollected?.length) {
      console.log(
        `Claimed ${result.rewardsCollected[0]!.humanReadableAmount} ${
          result.rewardsCollected[0]!.token.name
        } ${
          result.rewardsCollected[1]
            ? `and ${result.rewardsCollected[1].humanReadableAmount} ${result.rewardsCollected[1].token.name}`
            : ""
        } in Spread Rewards`
      );
    }

    // Clear position ID from config
    this.config.positionId = "";
    await this.saveConfig();

    return result;
  }

  private async withdrawUnknownPositions(
    currentPositionId?: string,
    osmosisBalances?: Record<string, TokenAmount>
  ): Promise<WithdrawPositionResult[]> {
    const openPositions = await this.osmosisPoolManager.getPositions();
    const unknownPositions = openPositions.filter(
      (item) => item.position.positionId !== currentPositionId
    );

    // Withdraw unknown positions if any
    const innerOsmosisBalances =
      osmosisBalances ?? (await this.getOsmosisAccountBalances());
    assertEnoughBalanceForFees(
      innerOsmosisBalances,
      this.osmosisChainInfo.nativeToken,
      BigNumber(OSMOSIS_WITHDRAW_LP_POSITION_FEE).times(
        unknownPositions.length
      ),
      "withdraw unknown positions"
    );
    const withdrawnPositions: WithdrawPositionResult[] = [];
    for (const auxPosition of unknownPositions) {
      console.log(
        `Withdrawing unknown position ${auxPosition.position.positionId}...`
      );
      const withdrawResult = await this.osmosisPoolManager.withdrawPosition({
        positionId: auxPosition.position.positionId,
        liquidityAmount: auxPosition.position.liquidity,
      });
      withdrawnPositions.push(withdrawResult);

      this.database.addTransaction({
        signerAddress: this.osmosisAddress,
        chainId: this.osmosisChainInfo.id,
        transactionType: TransactionType.WITHDRAW_RECONCILIATION,
        positionId: auxPosition.position.liquidity,
        gasFeeAmount: withdrawResult.gasFees?.humanReadableAmount,
        gasFeeTokenDenom: withdrawResult.gasFees?.token.denom,
        gasFeeTokenName: withdrawResult.gasFees?.token.name,
        txHash: withdrawResult.txHash,
        successful: true,
      });
    }

    return withdrawnPositions;
  }

  private validateTickSpacing(): AuthorizedTickSpacing {
    const AUTHORIZED_TICK_SPACING_SET = new Set<AuthorizedTickSpacing>([
      1, 10, 100, 1000,
    ]);

    const tickSpacing = Number(
      this.osmosisPoolManager.poolInfo.tickSpacing
    ) as AuthorizedTickSpacing;

    if (!AUTHORIZED_TICK_SPACING_SET.has(tickSpacing)) {
      throw new Error(
        `Invalid tick spacing of ${tickSpacing} on the osmosis pool config file`
      );
    }

    return tickSpacing;
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
      this.configFilePath,
      JSON.stringify(this.config, undefined, 2),
      "utf-8"
    );
  }
}
