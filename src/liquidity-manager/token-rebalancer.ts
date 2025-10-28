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
} from "./constants";
import { SQLiteTransactionRepository, TransactionType } from "../database";
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

import { RebalancerOutput, TokenRebalancerConfig } from "./types";

export class TokenRebalancer {
  private archwaySigner: OfflineSigner;
  private osmosisSigner: OfflineSigner;
  private environment: "mainnet" | "testnet";
  private skipBridging: SkipBridging;
  private archwayChainInfo: ChainInfo;
  private archwayTokensMap: Record<string, RegistryToken>;
  private osmosisChainInfo: ChainInfo;
  private osmosisTokensMap: Record<string, RegistryToken>;
  private database: SQLiteTransactionRepository;
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
    const innerOsmosisBalances =
      osmosisBalances ?? (await this.getOsmosisAccountBalances());

    const expectedFeeNeededIfNative = BigNumber(OSMOSIS_IBC_TRANSFER_FEE).plus(
      OSMOSIS_CREATE_LP_POSITION_FEE
    );

    const balance0Value = BigNumber.max(
      BigNumber(innerOsmosisBalances[token0.denom]?.amount ?? 0).minus(
        token0.denom === this.osmosisChainInfo.nativeToken.denom
          ? expectedFeeNeededIfNative
          : 0
      ),
      0
    );
    const balance1Value = BigNumber.max(
      BigNumber(innerOsmosisBalances[token1.denom]?.amount ?? 0).minus(
        token1.denom === this.osmosisChainInfo.nativeToken.denom
          ? expectedFeeNeededIfNative
          : 0
      ),
      0
    );

    if (balance0Value.isZero() && balance1Value.isZero()) {
      throw new Error(
        `Your account doesn't have enough significant balance of ${token0.name} or ${token1.name} on Osmosis chain`
      );
    }

    // Calculate total value in terms of token1
    const balance0InToken1 = balance0Value.times(currentPrice);
    const totalValueInToken1 = balance0InToken1.plus(balance1Value);

    // Calculate target amounts for 50/50 split
    const targetValueInToken1 = totalValueInToken1.div(2);
    const targetAmount0 = targetValueInToken1.div(currentPrice);
    const targetAmount1 = targetValueInToken1;

    console.log(
      `Target amounts for 50/50: ${
        new TokenAmount(targetAmount0, token0).humanReadableAmount
      } ${token0.name}, ${
        new TokenAmount(targetAmount1, token1).humanReadableAmount
      } ${token1.name}`
    );

    // Check if we need to rebalance
    const token0Excess = balance0Value.minus(targetAmount0);
    const token1Excess = balance1Value.minus(targetAmount1);

    // If already balanced (within 0.1% tolerance), return current balances
    const tolerance = BigNumber(0.001);
    if (
      token0Excess.abs().div(targetAmount0).lt(tolerance) &&
      token1Excess.abs().div(targetAmount1).lt(tolerance)
    ) {
      console.log("Tokens already balanced within tolerance");
      return {
        token0: new TokenAmount(balance0Value, token0),
        token1: new TokenAmount(balance1Value, token0),
        osmosisBalances: innerOsmosisBalances,
      };
    }

    // Determine which token we have excess of
    // Determine which token we have excess of
    if (token0Excess.gt(0)) {
      // We have excess token0, need to swap some for token1
      console.log(
        `Excess ${token0.name}: ${
          new TokenAmount(token0Excess, token0).humanReadableAmount
        }`
      );
      return await this.handleExcessToken(
        new TokenAmount(balance0Value, token0),
        new TokenAmount(balance1Value, token1),
        currentPrice,
        innerOsmosisBalances,
        0 // excess token index
      );
    } else {
      // We have excess token1, need to swap some for token0
      console.log(
        `Excess ${token1.name}: ${
          new TokenAmount(token1Excess.abs(), token1).humanReadableAmount
        }`
      );
      return await this.handleExcessToken(
        new TokenAmount(balance0Value, token0),
        new TokenAmount(balance1Value, token1),
        currentPrice,
        innerOsmosisBalances,
        1 // excess token index
      );
    }
  }

  private async handleExcessToken(
    tokenAmount0: TokenAmount,
    tokenAmount1: TokenAmount,
    osmosisPrice: string,
    osmosisBalances: Record<string, TokenAmount>,
    excessTokenIndex: 0 | 1
  ): Promise<RebalancerOutput> {
    const token0 = tokenAmount0.token;
    const token1 = tokenAmount1.token;

    // Determine which token we have excess of
    const excessToken = excessTokenIndex === 0 ? token0 : token1;
    const targetToken = excessTokenIndex === 0 ? token1 : token0;

    const osmosisAddress = await getSignerAddress(this.osmosisSigner);
    const archwayAddress = await getSignerAddress(this.archwaySigner);

    // Find Archway equivalents
    const token0Archway = findRegistryTokenEquivalentOnOtherChain(
      token0,
      this.archwayChainInfo.id
    );
    const token1Archway = findRegistryTokenEquivalentOnOtherChain(
      token1,
      this.archwayChainInfo.id
    );

    if (!token0Archway || !token1Archway) {
      throw new Error("Tokens not found on Archway");
    }

    const excessTokenArchway =
      excessTokenIndex === 0 ? token0Archway : token1Archway;
    const targetTokenArchway =
      excessTokenIndex === 0 ? token1Archway : token0Archway;

    // Get Bolt price on Archway
    const boltPrice = await getPairPriceOnBoltArchway(
      token0Archway,
      token1Archway,
      {
        environment: this.environment,
      }
    );

    console.log(
      `Bolt price: ${humanReadablePrice(
        boltPrice,
        token0,
        token1
      )}, Osmosis price: ${humanReadablePrice(osmosisPrice, token0, token1)}`
    );

    // Calculate the exact amount to bridge
    const balance0 = BigNumber(tokenAmount0.amount);
    const balance1 = BigNumber(tokenAmount1.amount);

    let amountToBridge: BigNumber;
    let expectedOutput: BigNumber;

    if (excessTokenIndex === 0) {
      // Excess token0 logic
      const numerator = balance0.times(osmosisPrice).minus(balance1);
      const denominator = BigNumber(osmosisPrice).plus(BigNumber(boltPrice));
      amountToBridge = numerator.div(denominator);
      expectedOutput = BigNumber(amountToBridge).times(boltPrice);
    } else {
      // Excess token1 logic
      const numerator = balance1.minus(balance0.times(osmosisPrice));
      const denominator = BigNumber(osmosisPrice).div(boltPrice).plus(1);
      amountToBridge = numerator.div(denominator);
      expectedOutput = amountToBridge.div(boltPrice);
    }

    const inputTokenAmount = new TokenAmount(amountToBridge, excessToken);
    const expectedOutputTokenAmount = new TokenAmount(
      expectedOutput,
      targetToken
    );

    console.log(
      `Calculated optimal bridge amount: ${inputTokenAmount.humanReadableAmount} ${inputTokenAmount.token.name}`
    );
    console.log(
      `Expected ${targetToken.name} output: ${expectedOutputTokenAmount.humanReadableAmount} ${targetToken.name}`
    );

    // Verify minimum swap amount on bolt
    const boltClient = BoltOnArchway.makeBoltClient(this.environment);
    const boltPoolConfig = await boltClient.getPoolConfigByDenom(
      targetTokenArchway.denom
    );
    if (expectedOutput.lte(boltPoolConfig.minBaseOut)) {
      console.log(
        "Amount we want to bridge and swap is smaller than the minimum out on bolt exchange"
      );
      return {
        token0: tokenAmount0,
        token1: tokenAmount1,
        osmosisBalances,
      };
    }
    boltClient.getCosmWasmClient();
    // Assert fees on both chains
    assertEnoughBalanceForFees(
      osmosisBalances,
      this.osmosisChainInfo.nativeToken,
      BigNumber(OSMOSIS_IBC_TRANSFER_FEE).plus(OSMOSIS_CREATE_LP_POSITION_FEE),
      "bridging to Archway for rebalancing"
    );
    const archwayBalances = await this.getArchwayAccountBalances();
    assertEnoughBalanceForFees(
      archwayBalances,
      this.archwayChainInfo.nativeToken,
      BigNumber(ARCHWAY_BOLT_SWAP_FEE).plus(ARCHWAY_IBC_TRANSFER_FEE),
      "bridge and swap on archway"
    );

    // Bridge excess token to Archway
    console.log(
      `Bridging ${inputTokenAmount.humanReadableAmount} ${inputTokenAmount.token.name} to Archway...`
    );
    const bridgeResult = await this.skipBridging.bridgeToken(
      this.osmosisSigner,
      this.keyStore,
      {
        fromToken: inputTokenAmount.token,
        toChainId: this.archwayChainInfo.id,
        amount: inputTokenAmount.amount,
      }
    );

    const bridgeGasFees = await this.findGasFeesOfTx(
      bridgeResult.txHash,
      this.osmosisChainInfo,
      this.osmosisTokensMap
    );

    this.database.addTransaction({
      signerAddress: osmosisAddress,
      chainId: this.osmosisChainInfo.id,
      transactionType: TransactionType.IBC_TRANSFER,
      inputAmount: inputTokenAmount.humanReadableAmount,
      inputTokenDenom: inputTokenAmount.token.denom,
      inputTokenName: inputTokenAmount.token.name,
      outputAmount: inputTokenAmount.humanReadableAmount,
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

    // Swap on Bolt
    console.log(
      `Swapping ${inputTokenAmount.humanReadableAmount} ${excessTokenArchway.name} for ~${expectedOutputTokenAmount.humanReadableAmount} ${targetTokenArchway.name} on Bolt...`
    );

    const swapResult = await boltClient.swap(
      {
        assetIn: excessTokenArchway.denom,
        assetOut: targetTokenArchway.denom,
        amountIn: inputTokenAmount.amount,
      },
      this.archwaySigner
    );

    const boltSwapOutput = new TokenAmount(
      swapResult.amountOut,
      targetTokenArchway
    );

    const boltSwapGasFees = await this.findGasFeesOfTx(
      swapResult.txHash,
      this.archwayChainInfo,
      this.archwayTokensMap
    );

    this.database.addTransaction({
      signerAddress: archwayAddress,
      chainId: this.archwayChainInfo.id,
      transactionType: TransactionType.BOLT_ARCHWAY_SWAP,
      inputAmount: inputTokenAmount.humanReadableAmount,
      inputTokenDenom: excessTokenArchway.denom,
      inputTokenName: excessTokenArchway.name,
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

    // Bridge target token back to Osmosis
    console.log(
      `Bridging ${boltSwapOutput.humanReadableAmount} ${targetTokenArchway.name} back to Osmosis...`
    );

    const bridgeBackResult = await this.skipBridging.bridgeToken(
      this.archwaySigner,
      this.keyStore,
      {
        fromToken: targetTokenArchway,
        toChainId: this.osmosisChainInfo.id,
        amount: boltSwapOutput.amount,
      }
    );

    const bridgeBackGasFees = await this.findGasFeesOfTx(
      bridgeBackResult.txHash,
      this.archwayChainInfo,
      this.archwayTokensMap
    );

    this.database.addTransaction({
      signerAddress: archwayAddress,
      chainId: this.archwayChainInfo.id,
      transactionType: TransactionType.IBC_TRANSFER,
      inputAmount: boltSwapOutput.humanReadableAmount,
      inputTokenDenom: boltSwapOutput.token.denom,
      inputTokenName: boltSwapOutput.token.name,
      outputAmount: boltSwapOutput.humanReadableAmount,
      outputTokenDenom: bridgeBackResult.destinationToken.denom,
      outputTokenName: bridgeBackResult.destinationToken.name,
      destinationAddress: bridgeBackResult.destinationAddress,
      destinationChainId: bridgeBackResult.destinationToken.chainId,
      gasFeeAmount: bridgeBackGasFees?.humanReadableAmount,
      gasFeeTokenDenom: bridgeBackGasFees?.token.denom,
      gasFeeTokenName: bridgeBackGasFees?.token.name,
      txHash: bridgeBackResult.txHash,
      successful: true,
    });

    console.log(`Bridge back complete. Tx: ${bridgeBackResult.txHash}`);

    // Get updated balances
    const newOsmosisBalances = await this.getOsmosisAccountBalances();
    const newBalance0 =
      newOsmosisBalances[token0.denom] ?? new TokenAmount(0, token0);
    const newBalance1 =
      newOsmosisBalances[token1.denom] ?? new TokenAmount(0, token1);

    return {
      token0: newBalance0,
      token1: newBalance1,
      osmosisBalances: newOsmosisBalances,
    };
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
    chainInfo: ChainInfo,
    tokensMap: Record<string, RegistryToken>
  ): Promise<TokenAmount | undefined> {
    try {
      const response = await axios.get(
        `${chainInfo.restEndpoint}/cosmos/tx/v1beta1/txs/${txHash}`
      );

      const coin = response.data?.tx?.auth_info?.fee?.amount?.[0] as
        | Coin
        | undefined;

      return coin ? parseCoinToTokenAmount(coin, tokensMap) : undefined;
    } catch {
      return undefined;
    }
  }
}
