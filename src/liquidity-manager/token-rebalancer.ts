import { Coin, OfflineSigner } from "@cosmjs/proto-signing";
import axios from "axios";
import { BigNumber } from "bignumber.js";

import {
  ArchwayAccount,
  OsmosisAccount,
  TokenAmount,
} from "../account-balances";
import { BoltOnArchway } from "../bolt-liquidity";
import {
  ARCHWAY_BOLT_SWAP_FEE,
  ARCHWAY_IBC_TRANSFER_FEE,
  OSMOSIS_CREATE_LP_POSITION_FEE,
  OSMOSIS_IBC_TRANSFER_FEE,
  OSMOSIS_WITHDRAW_LP_POSITION_FEE,
} from "./constants";
import { TransactionRepository, TransactionType } from "../database";
import { SkipBridging } from "../ibc-bridging";
import { AbstractKeyStore } from "../key-manager";
import { getPairPriceOnBoltArchway } from "../prices";
import {
  findRegistryTokenEquivalentOnOtherChain,
  findArchwayChainInfo,
  findOsmosisChainInfo,
  RegistryToken,
  ChainInfo,
  findArchwayTokensMap,
  findOsmosisTokensMap,
} from "../registry";
import {
  assertEnoughBalanceForFees,
  getSignerAddress,
  humanReadablePrice,
  parseCoinToTokenAmount,
} from "../utils";

import {
  MultiChainTokenBalances,
  RebalancerOutput,
  TokenRebalancerConfig,
} from "./types";

export class TokenRebalancer {
  private archwaySigner: OfflineSigner;
  private osmosisSigner: OfflineSigner;
  private environment: "mainnet" | "testnet";
  private skipBridging: SkipBridging;
  private archwayChainInfo: ChainInfo;
  private archwayTokensMap: Record<string, RegistryToken>;
  private osmosisChainInfo: ChainInfo;
  private osmosisTokensMap: Record<string, RegistryToken>;
  private database: TransactionRepository;
  private keyStore: AbstractKeyStore;

  constructor(config: TokenRebalancerConfig) {
    this.archwaySigner = config.archwaySigner;
    this.osmosisSigner = config.osmosisSigner;
    this.environment = config.environment;
    this.skipBridging = config.skipBridging;
    this.archwayChainInfo = findArchwayChainInfo(this.environment);
    this.archwayTokensMap = findArchwayTokensMap(this.environment);
    this.osmosisChainInfo = findOsmosisChainInfo(this.environment);
    this.osmosisTokensMap = findOsmosisTokensMap(this.environment);
    this.database = config.database;
    this.keyStore = config.keyStore;
  }

  async rebalanceTokensFor5050Deposit(
    token0: RegistryToken,
    token1: RegistryToken,
    currentPrice: string,
    osmosisBalances?: Record<string, TokenAmount>
  ): Promise<RebalancerOutput> {
    // Get balances from both chains
    const [archwayBalances, innerOsmosisBalances] = await Promise.all([
      this.getArchwayAccountBalances(),
      osmosisBalances ?? (await this.getOsmosisAccountBalances()),
    ]);

    // Get token balance information for both tokens across both chains
    const token0MultiChainBalances = await this.getMultichainTokenBalances(
      token0,
      innerOsmosisBalances,
      archwayBalances
    );
    const token1MultiChainBalances = await this.getMultichainTokenBalances(
      token1,
      innerOsmosisBalances,
      archwayBalances
    );

    // Use the total available balances that already consider fees
    const availableToken0Total = token0MultiChainBalances.totalAvailableBalance;
    const availableToken1Total = token1MultiChainBalances.totalAvailableBalance;

    if (availableToken0Total.isZero() && availableToken1Total.isZero()) {
      throw new Error(
        `Your account doesn't have enough significant balance of ${token0.name} or ${token1.name} across Osmosis and Archway chains after considering gas fees`
      );
    }

    // Log multi-chain balances
    console.log(`Multi-chain balances:`);
    console.log(
      `  ${token0.name}: ${
        new TokenAmount(availableToken0Total, token0).humanReadableAmount
      } available (Osmosis: ${
        new TokenAmount(
          token0MultiChainBalances.availableOsmosisBalance,
          token0
        ).humanReadableAmount
      }, Archway: ${
        new TokenAmount(
          token0MultiChainBalances.availableArchwayBalance,
          token0
        ).humanReadableAmount
      })`
    );
    console.log(
      `  ${token1.name}: ${
        new TokenAmount(availableToken1Total, token1).humanReadableAmount
      } available (Osmosis: ${
        new TokenAmount(
          token1MultiChainBalances.availableOsmosisBalance,
          token1
        ).humanReadableAmount
      }, Archway: ${
        new TokenAmount(
          token1MultiChainBalances.availableArchwayBalance,
          token1
        ).humanReadableAmount
      })`
    );

    // Calculate total value in terms of token1
    const balance0InToken1 = availableToken0Total.times(currentPrice);
    const totalValueInToken1 = balance0InToken1.plus(availableToken1Total);

    // Calculate target amounts for 50/50 split
    const targetValueInToken1 = totalValueInToken1
      .div(2)
      .decimalPlaces(0, BigNumber.ROUND_FLOOR);
    const targetAmount0 = targetValueInToken1
      .div(currentPrice)
      .decimalPlaces(0, BigNumber.ROUND_FLOOR);
    const targetAmount1 = targetValueInToken1;

    console.log(
      `Target amounts for 50/50: ${
        new TokenAmount(targetAmount0, token0).humanReadableAmount
      } ${token0.name}, ${
        new TokenAmount(targetAmount1, token1).humanReadableAmount
      } ${token1.name}`
    );

    // Check if we need to rebalance
    const token0Excess = availableToken0Total.minus(targetAmount0);
    const token1Excess = availableToken1Total.minus(targetAmount1);

    // If already balanced (within 0.1% tolerance), return current balances
    const tolerance = BigNumber(0.001);
    if (
      token0Excess.abs().div(targetAmount0).lt(tolerance) &&
      token1Excess.abs().div(targetAmount1).lt(tolerance)
    ) {
      console.log("Tokens already balanced within tolerance");
      // Bridge any tokens on Archway back to Osmosis if needed
      await this.bridgeArchwayBalancesToOsmosisIfNeeded(
        token0MultiChainBalances,
        token1MultiChainBalances,
        archwayBalances
      );

      return this.getSafeOsmosisBalancesRebalancerOutput(
        token0MultiChainBalances.osmosisToken,
        token1MultiChainBalances.osmosisToken
      );
    }

    // Determine which token we have excess of
    if (token0Excess.gt(0)) {
      // We have excess token0, need to swap some for token1
      console.log(
        `Excess ${token0.name}: ${
          new TokenAmount(token0Excess, token0).humanReadableAmount
        }`
      );
      return await this.handleExcessTokenWithMultiChain(
        token0MultiChainBalances,
        token1MultiChainBalances,
        currentPrice,
        innerOsmosisBalances,
        archwayBalances,
        0 // excess token index
      );
    } else {
      // We have excess token1, need to swap some for token0
      console.log(
        `Excess ${token1.name}: ${
          new TokenAmount(token1Excess.abs(), token1).humanReadableAmount
        }`
      );
      return await this.handleExcessTokenWithMultiChain(
        token0MultiChainBalances,
        token1MultiChainBalances,
        currentPrice,
        innerOsmosisBalances,
        archwayBalances,
        1 // excess token index
      );
    }
  }

  private async getMultichainTokenBalances(
    token: RegistryToken,
    osmosisBalances: Record<string, TokenAmount>,
    archwayBalances: Record<string, TokenAmount>
  ): Promise<MultiChainTokenBalances> {
    const archwayToken = findRegistryTokenEquivalentOnOtherChain(
      token,
      this.archwayChainInfo.id
    );

    if (!archwayToken) {
      throw new Error(`Token ${token.name} not found on Archway`);
    }

    const osmosisBalance =
      osmosisBalances[token.denom] ?? new TokenAmount(0, token);
    const archwayBalance =
      archwayBalances[archwayToken.denom] ?? new TokenAmount(0, archwayToken);

    // Calculate available Osmosis balance considering fees if it's the native token
    const osmosisFeeReserve =
      token.denom === this.osmosisChainInfo.nativeToken.denom
        ? BigNumber(OSMOSIS_IBC_TRANSFER_FEE)
            .plus(OSMOSIS_CREATE_LP_POSITION_FEE)
            .plus(OSMOSIS_WITHDRAW_LP_POSITION_FEE)
            .times(2)
        : BigNumber(0);

    const availableOsmosisBalance = BigNumber.max(
      BigNumber(osmosisBalance.amount).minus(osmosisFeeReserve),
      0
    );

    // Calculate available Archway balance considering fees if it's the native token (use double IBC fees in case there is leftover of both tokens)
    const archwayFeeReserve =
      archwayToken.denom === this.archwayChainInfo.nativeToken.denom
        ? BigNumber(ARCHWAY_BOLT_SWAP_FEE)
            .plus(ARCHWAY_IBC_TRANSFER_FEE)
            .plus(ARCHWAY_IBC_TRANSFER_FEE)
            .times(2)
        : BigNumber(0);

    const availableArchwayBalance = BigNumber.max(
      BigNumber(archwayBalance.amount).minus(archwayFeeReserve),
      0
    );

    const totalAvailableBalance = availableOsmosisBalance.plus(
      availableArchwayBalance
    );

    return {
      osmosisBalance,
      archwayBalance,
      availableOsmosisBalance,
      availableArchwayBalance,
      totalAvailableBalance,
      osmosisToken: token,
      archwayToken,
    };
  }

  private async handleExcessTokenWithMultiChain(
    token0MultiChainBalances: MultiChainTokenBalances,
    token1MultiChainBalances: MultiChainTokenBalances,
    osmosisPrice: string,
    osmosisBalances: Record<string, TokenAmount>,
    archwayBalances: Record<string, TokenAmount>,
    excessTokenIndex: 0 | 1
  ): Promise<RebalancerOutput> {
    const excessTokenInfo =
      excessTokenIndex === 0
        ? token0MultiChainBalances
        : token1MultiChainBalances;
    const targetTokenInfo =
      excessTokenIndex === 0
        ? token1MultiChainBalances
        : token0MultiChainBalances;

    const osmosisAddress = await getSignerAddress(this.osmosisSigner);
    const archwayAddress = await getSignerAddress(this.archwaySigner);

    // Get Bolt price on Archway
    const boltPrice = await getPairPriceOnBoltArchway(
      token0MultiChainBalances.archwayToken,
      token1MultiChainBalances.archwayToken,
      {
        environment: this.environment,
      }
    );

    console.log(
      `Bolt price: ${humanReadablePrice(
        boltPrice,
        token0MultiChainBalances.osmosisToken,
        token1MultiChainBalances.osmosisToken
      )}, Osmosis price: ${humanReadablePrice(
        osmosisPrice,
        token0MultiChainBalances.osmosisToken,
        token1MultiChainBalances.osmosisToken
      )}`
    );

    // Calculate the exact amount to swap using available totals
    const availableToken0Total = token0MultiChainBalances.totalAvailableBalance;
    const availableToken1Total = token1MultiChainBalances.totalAvailableBalance;

    let amountToSwap: BigNumber;
    let expectedOutput: BigNumber;

    if (excessTokenIndex === 0) {
      // Excess token0 logic
      const numerator = availableToken0Total
        .times(osmosisPrice)
        .minus(availableToken1Total);
      const denominator = BigNumber(osmosisPrice).plus(BigNumber(boltPrice));
      amountToSwap = numerator.div(denominator);
      expectedOutput = BigNumber(amountToSwap).times(boltPrice);
    } else {
      // Excess token1 logic
      const numerator = availableToken1Total.minus(
        availableToken0Total.times(osmosisPrice)
      );
      const denominator = BigNumber(osmosisPrice).div(boltPrice).plus(1);
      amountToSwap = numerator.div(denominator);
      expectedOutput = amountToSwap.div(boltPrice);
    }

    const swapTokenAmount = new TokenAmount(
      amountToSwap,
      excessTokenInfo.osmosisToken
    );
    const expectedOutputTokenAmount = new TokenAmount(
      expectedOutput,
      targetTokenInfo.osmosisToken
    );

    console.log(
      `Calculated optimal swap amount: ${swapTokenAmount.humanReadableAmount} ${swapTokenAmount.token.name}`
    );
    console.log(
      `Expected ${targetTokenInfo.osmosisToken.name} output: ${expectedOutputTokenAmount.humanReadableAmount}`
    );

    // Verify minimum swap amount on bolt
    const boltClient = BoltOnArchway.makeBoltClient(this.environment);
    const boltPoolConfig = await boltClient.getPoolConfigByDenom(
      targetTokenInfo.archwayToken.denom
    );

    if (expectedOutput.lte(boltPoolConfig.minBaseOut)) {
      console.log(
        "Swap amount is smaller than minimum output on Bolt exchange"
      );
      // Just bridge any Archway balances back to Osmosis
      await this.bridgeArchwayBalancesToOsmosisIfNeeded(
        token0MultiChainBalances,
        token1MultiChainBalances,
        archwayBalances
      );
      return {
        token0: new TokenAmount(
          token0MultiChainBalances.totalAvailableBalance,
          token0MultiChainBalances.osmosisToken
        ),
        token1: new TokenAmount(
          token1MultiChainBalances.totalAvailableBalance,
          token1MultiChainBalances.osmosisToken
        ),
      };
    }

    // Assert fees on Archway for swap
    assertEnoughBalanceForFees(
      archwayBalances,
      this.archwayChainInfo.nativeToken,
      BigNumber(ARCHWAY_BOLT_SWAP_FEE).plus(ARCHWAY_IBC_TRANSFER_FEE),
      "swap on Bolt and bridge back"
    );

    // Determine how much we need on Archway for the swap
    let amountNeededOnArchway = amountToSwap;
    let amountToBridgeToArchway = BigNumber.max(
      amountNeededOnArchway.minus(excessTokenInfo.availableArchwayBalance),
      0
    );

    // Handle bridging excess token to Archway if needed
    if (amountToBridgeToArchway.gt(0)) {
      // Assert fees on Osmosis
      assertEnoughBalanceForFees(
        osmosisBalances,
        this.osmosisChainInfo.nativeToken,
        BigNumber(OSMOSIS_IBC_TRANSFER_FEE).plus(
          OSMOSIS_CREATE_LP_POSITION_FEE
        ),
        "bridging to Archway for rebalancing"
      );

      console.log(
        `Bridging ${
          new TokenAmount(amountToBridgeToArchway, excessTokenInfo.osmosisToken)
            .humanReadableAmount
        } ${excessTokenInfo.osmosisToken.name} to Archway...`
      );

      const bridgeResult = await this.skipBridging.bridgeToken(
        this.osmosisSigner,
        this.keyStore,
        {
          fromToken: excessTokenInfo.osmosisToken,
          toChainId: this.archwayChainInfo.id,
          amount: amountToBridgeToArchway.toFixed(0),
        }
      );

      const bridgeGasFees = await this.findGasFeesOfTx(
        bridgeResult.txHash,
        this.osmosisChainInfo
      );

      await this.database.addTransaction({
        signerAddress: osmosisAddress,
        chainId: this.osmosisChainInfo.id,
        transactionType: TransactionType.IBC_TRANSFER,
        inputAmount: new TokenAmount(
          amountToBridgeToArchway,
          excessTokenInfo.osmosisToken
        ).humanReadableAmount,
        inputTokenDenom: excessTokenInfo.osmosisToken.denom,
        inputTokenName: excessTokenInfo.osmosisToken.name,
        outputAmount: new TokenAmount(
          amountToBridgeToArchway,
          excessTokenInfo.archwayToken
        ).humanReadableAmount,
        outputTokenDenom: bridgeResult.destinationToken.denom,
        outputTokenName: bridgeResult.destinationToken.name,
        destinationAddress: bridgeResult.destinationAddress,
        destinationChainId: bridgeResult.destinationToken.chainId,
        gasFeeAmount: bridgeGasFees?.humanReadableAmount,
        gasFeeTokenDenom: bridgeGasFees?.token.denom,
        gasFeeTokenName: bridgeGasFees?.token.name,
        txHash: bridgeResult.txHash,
        successful: true,
      });

      console.log(`Bridge complete. Tx: ${bridgeResult.txHash}`);
    } else {
      console.log(
        `Already have ${
          new TokenAmount(
            excessTokenInfo.availableArchwayBalance,
            excessTokenInfo.archwayToken
          ).humanReadableAmount
        } ${
          excessTokenInfo.archwayToken.name
        } available on Archway, no bridging needed for swap`
      );
    }

    // Swap on Bolt
    console.log(
      `Swapping ${swapTokenAmount.humanReadableAmount} ${excessTokenInfo.archwayToken.name} for ~${expectedOutputTokenAmount.humanReadableAmount} ${targetTokenInfo.archwayToken.name} on Bolt...`
    );

    const swapResult = await boltClient.swap(
      {
        assetIn: excessTokenInfo.archwayToken.denom,
        assetOut: targetTokenInfo.archwayToken.denom,
        amountIn: amountToSwap.toFixed(0),
      },
      this.archwaySigner
    );

    const boltSwapOutput = new TokenAmount(
      swapResult.amountOut,
      targetTokenInfo.archwayToken
    );

    const boltSwapGasFees = await this.findGasFeesOfTx(
      swapResult.txHash,
      this.archwayChainInfo
    );

    await this.database.addTransaction({
      signerAddress: archwayAddress,
      chainId: this.archwayChainInfo.id,
      transactionType: TransactionType.BOLT_ARCHWAY_SWAP,
      inputAmount: swapTokenAmount.humanReadableAmount,
      inputTokenDenom: excessTokenInfo.archwayToken.denom,
      inputTokenName: excessTokenInfo.archwayToken.name,
      outputAmount: boltSwapOutput.humanReadableAmount,
      outputTokenDenom: boltSwapOutput.token.denom,
      outputTokenName: boltSwapOutput.token.name,
      gasFeeAmount: boltSwapGasFees?.humanReadableAmount,
      gasFeeTokenDenom: boltSwapGasFees?.token.denom,
      gasFeeTokenName: boltSwapGasFees?.token.name,
      txHash: swapResult.txHash,
      successful: true,
    });

    console.log(`Swap complete. Tx: ${swapResult.txHash}`);

    // Bridge all balances back to Osmosis
    await this.bridgeAllArchwayBalancesToOsmosis(
      token0MultiChainBalances.archwayToken,
      token1MultiChainBalances.archwayToken
    );

    return this.getSafeOsmosisBalancesRebalancerOutput(
      token0MultiChainBalances.osmosisToken,
      token1MultiChainBalances.osmosisToken
    );
  }

  private async bridgeArchwayBalancesToOsmosisIfNeeded(
    token0MultiChainBalances: MultiChainTokenBalances,
    token1MultiChainBalances: MultiChainTokenBalances,
    archwayBalances: Record<string, TokenAmount>
  ): Promise<void> {
    const archwayAddress = await getSignerAddress(this.archwaySigner);

    // Bridge token0 if it has available balance on Archway
    if (token0MultiChainBalances.availableArchwayBalance.gt(0)) {
      console.log(
        `Bridging ${
          new TokenAmount(
            token0MultiChainBalances.availableArchwayBalance,
            token0MultiChainBalances.archwayToken
          ).humanReadableAmount
        } ${
          token0MultiChainBalances.archwayToken.name
        } from Archway to Osmosis...`
      );

      // Assert fees on Archway for bridge
      assertEnoughBalanceForFees(
        archwayBalances,
        this.archwayChainInfo.nativeToken,
        ARCHWAY_IBC_TRANSFER_FEE,
        "bridge from Archway to Osmosis"
      );

      const bridgeResult = await this.skipBridging.bridgeToken(
        this.archwaySigner,
        this.keyStore,
        {
          fromToken: token0MultiChainBalances.archwayToken,
          toChainId: this.osmosisChainInfo.id,
          amount: token0MultiChainBalances.availableArchwayBalance.toFixed(0),
        }
      );

      const bridgeGasFees = await this.findGasFeesOfTx(
        bridgeResult.txHash,
        this.archwayChainInfo
      );

      await this.database.addTransaction({
        signerAddress: archwayAddress,
        chainId: this.archwayChainInfo.id,
        transactionType: TransactionType.IBC_TRANSFER,
        inputAmount: new TokenAmount(
          token0MultiChainBalances.availableArchwayBalance,
          token0MultiChainBalances.archwayToken
        ).humanReadableAmount,
        inputTokenDenom: token0MultiChainBalances.archwayToken.denom,
        inputTokenName: token0MultiChainBalances.archwayToken.name,
        outputAmount: new TokenAmount(
          token0MultiChainBalances.availableArchwayBalance,
          token0MultiChainBalances.osmosisToken
        ).humanReadableAmount,
        outputTokenDenom: bridgeResult.destinationToken.denom,
        outputTokenName: bridgeResult.destinationToken.name,
        destinationAddress: bridgeResult.destinationAddress,
        destinationChainId: bridgeResult.destinationToken.chainId,
        gasFeeAmount: bridgeGasFees?.humanReadableAmount,
        gasFeeTokenDenom: bridgeGasFees?.token.denom,
        gasFeeTokenName: bridgeGasFees?.token.name,
        txHash: bridgeResult.txHash,
        successful: true,
      });

      console.log(`Bridge complete. Tx: ${bridgeResult.txHash}`);
    }

    // Bridge token1 if it has available balance on Archway
    if (token1MultiChainBalances.availableArchwayBalance.gt(0)) {
      console.log(
        `Bridging ${
          new TokenAmount(
            token1MultiChainBalances.availableArchwayBalance,
            token1MultiChainBalances.archwayToken
          ).humanReadableAmount
        } ${
          token1MultiChainBalances.archwayToken.name
        } from Archway to Osmosis...`
      );

      // Assert fees on Archway for bridge
      assertEnoughBalanceForFees(
        archwayBalances,
        this.archwayChainInfo.nativeToken,
        ARCHWAY_IBC_TRANSFER_FEE,
        "bridge from Archway to Osmosis"
      );

      const bridgeResult = await this.skipBridging.bridgeToken(
        this.archwaySigner,
        this.keyStore,
        {
          fromToken: token1MultiChainBalances.archwayToken,
          toChainId: this.osmosisChainInfo.id,
          amount: token1MultiChainBalances.availableArchwayBalance.toFixed(0),
        }
      );

      const bridgeGasFees = await this.findGasFeesOfTx(
        bridgeResult.txHash,
        this.archwayChainInfo
      );

      await this.database.addTransaction({
        signerAddress: archwayAddress,
        chainId: this.archwayChainInfo.id,
        transactionType: TransactionType.IBC_TRANSFER,
        inputAmount: new TokenAmount(
          token1MultiChainBalances.availableArchwayBalance,
          token1MultiChainBalances.archwayToken
        ).humanReadableAmount,
        inputTokenDenom: token1MultiChainBalances.archwayToken.denom,
        inputTokenName: token1MultiChainBalances.archwayToken.name,
        outputAmount: new TokenAmount(
          token1MultiChainBalances.availableArchwayBalance,
          token1MultiChainBalances.osmosisToken
        ).humanReadableAmount,
        outputTokenDenom: bridgeResult.destinationToken.denom,
        outputTokenName: bridgeResult.destinationToken.name,
        destinationAddress: bridgeResult.destinationAddress,
        destinationChainId: bridgeResult.destinationToken.chainId,
        gasFeeAmount: bridgeGasFees?.humanReadableAmount,
        gasFeeTokenDenom: bridgeGasFees?.token.denom,
        gasFeeTokenName: bridgeGasFees?.token.name,
        txHash: bridgeResult.txHash,
        successful: true,
      });

      console.log(`Bridge complete. Tx: ${bridgeResult.txHash}`);
    }
  }

  private async bridgeAllArchwayBalancesToOsmosis(
    token0Archway: RegistryToken,
    token1Archway: RegistryToken
  ): Promise<void> {
    const archwayAddress = await getSignerAddress(this.archwaySigner);
    const archwayBalances = await this.getArchwayAccountBalances();

    // Calculate fee reserve for native token
    const nativeTokenFeeReserve = BigNumber(ARCHWAY_BOLT_SWAP_FEE).plus(
      ARCHWAY_IBC_TRANSFER_FEE
    );

    // Bridge token0 if present
    const token0Balance = archwayBalances[token0Archway.denom];
    if (token0Balance && token0Balance.amount !== "0") {
      // Calculate available amount considering fees if it's the native token
      let availableAmount = BigNumber(token0Balance.amount);

      if (token0Archway.denom === this.archwayChainInfo.nativeToken.denom) {
        availableAmount = BigNumber.max(
          availableAmount.minus(nativeTokenFeeReserve),
          0
        );

        if (availableAmount.isZero()) {
          console.log(
            `Skipping bridge of ${token0Archway.name} - insufficient balance after reserving gas fees`
          );
          return;
        }
      }

      console.log(
        `Bridging ${
          new TokenAmount(availableAmount, token0Archway).humanReadableAmount
        } ${token0Archway.name} back to Osmosis...`
      );

      const bridgeResult = await this.skipBridging.bridgeToken(
        this.archwaySigner,
        this.keyStore,
        {
          fromToken: token0Archway,
          toChainId: this.osmosisChainInfo.id,
          amount: availableAmount.toFixed(0),
        }
      );

      const bridgeGasFees = await this.findGasFeesOfTx(
        bridgeResult.txHash,
        this.archwayChainInfo
      );

      await this.database.addTransaction({
        signerAddress: archwayAddress,
        chainId: this.archwayChainInfo.id,
        transactionType: TransactionType.IBC_TRANSFER,
        inputAmount: new TokenAmount(availableAmount, token0Archway)
          .humanReadableAmount,
        inputTokenDenom: token0Archway.denom,
        inputTokenName: token0Archway.name,
        outputAmount: new TokenAmount(
          availableAmount,
          bridgeResult.destinationToken
        ).humanReadableAmount,
        outputTokenDenom: bridgeResult.destinationToken.denom,
        outputTokenName: bridgeResult.destinationToken.name,
        destinationAddress: bridgeResult.destinationAddress,
        destinationChainId: bridgeResult.destinationToken.chainId,
        gasFeeAmount: bridgeGasFees?.humanReadableAmount,
        gasFeeTokenDenom: bridgeGasFees?.token.denom,
        gasFeeTokenName: bridgeGasFees?.token.name,
        txHash: bridgeResult.txHash,
        successful: true,
      });

      console.log(`Bridge complete. Tx: ${bridgeResult.txHash}`);
    }

    // Bridge token1 if present
    const token1Balance = archwayBalances[token1Archway.denom];
    if (token1Balance && token1Balance.amount !== "0") {
      // Calculate available amount considering fees if it's the native token
      let availableAmount = BigNumber(token1Balance.amount);

      if (token1Archway.denom === this.archwayChainInfo.nativeToken.denom) {
        availableAmount = BigNumber.max(
          availableAmount.minus(nativeTokenFeeReserve),
          0
        );

        if (availableAmount.isZero()) {
          console.log(
            `Skipping bridge of ${token1Archway.name} - insufficient balance after reserving gas fees`
          );
          return;
        }
      }

      console.log(
        `Bridging ${
          new TokenAmount(availableAmount, token1Archway).humanReadableAmount
        } ${token1Archway.name} back to Osmosis...`
      );

      const bridgeResult = await this.skipBridging.bridgeToken(
        this.archwaySigner,
        this.keyStore,
        {
          fromToken: token1Archway,
          toChainId: this.osmosisChainInfo.id,
          amount: availableAmount.toFixed(0),
        }
      );

      const bridgeGasFees = await this.findGasFeesOfTx(
        bridgeResult.txHash,
        this.archwayChainInfo
      );

      await this.database.addTransaction({
        signerAddress: archwayAddress,
        chainId: this.archwayChainInfo.id,
        transactionType: TransactionType.IBC_TRANSFER,
        inputAmount: new TokenAmount(availableAmount, token1Archway)
          .humanReadableAmount,
        inputTokenDenom: token1Archway.denom,
        inputTokenName: token1Archway.name,
        outputAmount: new TokenAmount(
          availableAmount,
          bridgeResult.destinationToken
        ).humanReadableAmount,
        outputTokenDenom: bridgeResult.destinationToken.denom,
        outputTokenName: bridgeResult.destinationToken.name,
        destinationAddress: bridgeResult.destinationAddress,
        destinationChainId: bridgeResult.destinationToken.chainId,
        gasFeeAmount: bridgeGasFees?.humanReadableAmount,
        gasFeeTokenDenom: bridgeGasFees?.token.denom,
        gasFeeTokenName: bridgeGasFees?.token.name,
        txHash: bridgeResult.txHash,
        successful: true,
      });

      console.log(`Bridge complete. Tx: ${bridgeResult.txHash}`);
    }
  }

  private async getSafeOsmosisBalancesRebalancerOutput(
    token0: RegistryToken,
    token1: RegistryToken
  ): Promise<RebalancerOutput> {
    const newOsmosisBalances = await this.getOsmosisAccountBalances();

    // Calculate available amounts
    return {
      token0: this.getSafeOsmosisBalanceForPosition(token0, newOsmosisBalances),
      token1: this.getSafeOsmosisBalanceForPosition(token1, newOsmosisBalances),
    };
  }

  private getSafeOsmosisBalanceForPosition(
    token: RegistryToken,
    osmosisBalances: Record<string, TokenAmount>
  ): TokenAmount {
    const balance = osmosisBalances[token.denom] ?? new TokenAmount(0, token);

    const osmosisFeeReserve =
      token.denom === this.osmosisChainInfo.nativeToken.denom
        ? BigNumber(OSMOSIS_CREATE_LP_POSITION_FEE).plus(
            OSMOSIS_WITHDRAW_LP_POSITION_FEE
          )
        : BigNumber(0);

    return new TokenAmount(
      BigNumber.max(BigNumber(balance.amount).minus(osmosisFeeReserve), 0),
      token
    );
  }

  private async getArchwayAccountBalances(): Promise<
    Record<string, TokenAmount>
  > {
    const archwayAddress = await getSignerAddress(this.archwaySigner);
    const archwayAccount = new ArchwayAccount(archwayAddress, this.environment);
    return await archwayAccount.getAvailableBalances();
  }

  private async getOsmosisAccountBalances(): Promise<
    Record<string, TokenAmount>
  > {
    const osmosisAddress = await getSignerAddress(this.osmosisSigner);
    const osmosisAccount = new OsmosisAccount(osmosisAddress, this.environment);
    return await osmosisAccount.getAvailableBalances();
  }

  private async findGasFeesOfTx(
    txHash: string,
    chainInfo: ChainInfo
  ): Promise<TokenAmount | undefined> {
    try {
      const response = await axios.get(
        `${chainInfo.restEndpoint}/cosmos/tx/v1beta1/txs/${txHash}`
      );

      const coin = response.data?.tx?.auth_info?.fee?.amount?.[0] as
        | Coin
        | undefined;

      const tokensMap =
        chainInfo.id === this.osmosisChainInfo.id
          ? this.osmosisTokensMap
          : this.archwayTokensMap;

      return coin ? parseCoinToTokenAmount(coin, tokensMap) : undefined;
    } catch {
      return undefined;
    }
  }
}
