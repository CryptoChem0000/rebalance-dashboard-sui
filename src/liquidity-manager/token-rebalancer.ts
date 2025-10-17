import { convertAddress } from "@archway-kit/utils";
import { OfflineSigner } from "@cosmjs/proto-signing";
import { BigNumber } from "bignumber.js";

import {
  ArchwayAccount,
  OsmosisAccount,
  TokenAmount,
} from "../account-balances";
import { BoltOnArchway } from "../bolt-liquidity";
import { SkipBridging } from "../ibc-bridging";
import { getPairPriceOnBoltArchway } from "../prices";
import {
  findRegistryTokenEquivalentOnOtherChain,
  findArchwayChainInfo,
  findOsmosisChainInfo,
  RegistryToken,
  ChainInfo,
} from "../registry";
import { getSignerAddress, humanReadablePrice } from "../utils";

import { RebalancerOutput, TokenRebalancerConfig } from "./types";
import { assertEnoughBalanceForFees } from "./utils";

export class TokenRebalancer {
  private archwaySigner: OfflineSigner;
  private osmosisSigner: OfflineSigner;
  private environment: "mainnet" | "testnet";
  private skipBridging: SkipBridging;
  private archwayChainInfo: ChainInfo;
  private osmosisChainInfo: ChainInfo;

  constructor(config: TokenRebalancerConfig) {
    this.archwaySigner = config.archwaySigner;
    this.osmosisSigner = config.osmosisSigner;
    this.environment = config.environment;
    this.skipBridging = config.skipBridging;
    this.archwayChainInfo = findArchwayChainInfo(this.environment);
    this.osmosisChainInfo = findOsmosisChainInfo(this.environment);
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
    if (token0Excess.gt(0)) {
      // We have excess token0, need to swap some for token1
      console.log(
        `Excess ${token0.name}: ${
          new TokenAmount(token0Excess, token0).humanReadableAmount
        }`
      );
      return await this.handleExcessToken0(
        new TokenAmount(balance0Value, token0),
        new TokenAmount(balance1Value, token1),
        currentPrice,
        innerOsmosisBalances
      );
    } else {
      // We have excess token1, need to swap some for token0
      console.log(
        `Excess ${token1.name}: ${
          new TokenAmount(token1Excess.abs(), token1).humanReadableAmount
        }`
      );
      return await this.handleExcessToken1(
        new TokenAmount(balance0Value, token0),
        new TokenAmount(balance1Value, token1),
        currentPrice,
        innerOsmosisBalances
      );
    }
  }

  private async handleExcessToken0(
    tokenAmount0: TokenAmount,
    tokenAmount1: TokenAmount,
    osmosisPrice: string,
    osmosisBalances: Record<string, TokenAmount>
  ): Promise<RebalancerOutput> {
    const token0 = tokenAmount0.token;
    const token1 = tokenAmount1.token;

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

    // Get Bolt price on Archway first to calculate optimal amount
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

    // Calculate the exact amount to bridge to achieve 50/50 balance
    // Current balances:
    const balance0 = BigNumber(tokenAmount0.amount);
    const balance1 = BigNumber(tokenAmount1.amount);

    // We want: (balance0 - amountToBridge) * osmosisPrice = balance1 + (amountToBridge * boltPrice)
    // Solving for amountToBridge:
    // balance0 * osmosisPrice - amountToBridge * osmosisPrice = balance1 + amountToBridge * boltPrice
    // balance0 * osmosisPrice - balance1 = amountToBridge * (osmosisPrice + boltPrice)
    // amountToBridge = (balance0 * osmosisPrice - balance1) / (osmosisPrice + boltPrice)

    const numerator = balance0.times(osmosisPrice).minus(balance1);
    const denominator = BigNumber(osmosisPrice).plus(BigNumber(boltPrice));
    const amountToBridge = numerator.div(denominator);

    console.log(
      `Calculated optimal bridge amount: ${
        new TokenAmount(amountToBridge, token0).humanReadableAmount
      } ${token0.name}`
    );
    const expectedOutput = BigNumber(amountToBridge).times(boltPrice);
    console.log(
      `Expected token1 output: ${
        new TokenAmount(expectedOutput, token1).humanReadableAmount
      } ${token1.name}`
    );

    // Verify if we are higher than the minimum swap amount out on bolt
    const boltClient = BoltOnArchway.makeBoltClient(this.environment);
    const boltPoolConfig = await boltClient.getPoolConfigByBaseAsset(
      token1Archway.denom
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

    // Bridge to Archway
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

    console.log(
      `Bridging ${
        new TokenAmount(amountToBridge, token0).humanReadableAmount
      } ${token1Archway.name} to Archway...`
    );
    const bridgeResult = await this.skipBridging.bridgeToken(
      this.osmosisSigner,
      {
        [this.osmosisChainInfo.id]: osmosisAddress,
        [this.archwayChainInfo.id]: archwayAddress,
        "noble-1": convertAddress(archwayAddress, "noble")!,
        "cosmoshub-4": convertAddress(archwayAddress, "cosmos")!,
        celestia: convertAddress(archwayAddress, "celestia")!,
        "axelar-dojo-1": convertAddress(archwayAddress, "axelar")!,
        "akashnet-2": convertAddress(archwayAddress, "akash")!,
        // TODO: implement a way to get injective singer/address conversion
      },
      {
        fromToken: token0,
        toChainId: this.archwayChainInfo.id,
        amount: amountToBridge.toFixed(0),
      }
    );

    console.log(`Bridge complete. Tx: ${bridgeResult.txHash}`);

    // Swap on Bolt
    console.log(
      `Swapping ${
        new TokenAmount(amountToBridge, token0).humanReadableAmount
      } ${token0Archway.name} for ~${
        new TokenAmount(expectedOutput, token1).humanReadableAmount
      } ${token1Archway.name} on Bolt...`
    );

    const swapResult = await boltClient.swap(
      {
        assetIn: token0Archway.denom,
        assetOut: token1Archway.denom,
        amountIn: amountToBridge.toFixed(0),
      },
      this.archwaySigner
    );

    console.log(`Swap complete. Tx: ${swapResult.txHash}`);

    const boltSwapOutput = BigNumber(swapResult.amountOut);

    // Bridge token1 back to Osmosis
    console.log(
      `Bridging ${
        new TokenAmount(boltSwapOutput, token1).humanReadableAmount
      } ${token1Archway.name} back to Osmosis...`
    );

    const bridgeBackResult = await this.skipBridging.bridgeToken(
      this.archwaySigner,
      {
        [this.osmosisChainInfo.id]: osmosisAddress,
        [this.archwayChainInfo.id]: archwayAddress,
        "noble-1": convertAddress(archwayAddress, "noble")!,
        "cosmoshub-4": convertAddress(archwayAddress, "cosmos")!,
        celestia: convertAddress(archwayAddress, "celestia")!,
        "axelar-dojo-1": convertAddress(archwayAddress, "axelar")!,
        "akashnet-2": convertAddress(archwayAddress, "akash")!,
        // TODO: implement a way to get injective singer/address conversion
      },
      {
        fromToken: token1Archway,
        toChainId: this.osmosisChainInfo.id,
        amount: boltSwapOutput.toFixed(0),
      }
    );

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

  private async handleExcessToken1(
    tokenAmount0: TokenAmount,
    tokenAmount1: TokenAmount,
    osmosisPrice: string,
    osmosisBalances: Record<string, TokenAmount>
  ): Promise<RebalancerOutput> {
    const token0 = tokenAmount0.token;
    const token1 = tokenAmount1.token;

    const archwayAddress = await getSignerAddress(this.archwaySigner);
    const osmosisAddress = await getSignerAddress(this.osmosisSigner);

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

    // Get Bolt price on Archway first to calculate optimal amount
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

    // Calculate the exact amount to bridge to achieve 50/50 balance
    // Current balances:
    const balance0 = BigNumber(tokenAmount0.amount);
    const balance1 = BigNumber(tokenAmount1.amount);

    // We want: (balance0 + amountToBridge / boltPrice) * osmosisPrice = balance1 - amountToBridge
    // Solving for amountToBridge:
    // (balance0 * osmosisPrice) + (amountToBridge * osmosisPrice / boltPrice) = balance1 - amountToBridge
    // balance0 * osmosisPrice + amountToBridge * osmosisPrice / boltPrice + amountToBridge = balance1
    // amountToBridge * (osmosisPrice / boltPrice + 1) = balance1 - balance0 * osmosisPrice
    // amountToBridge = (balance1 - balance0 * osmosisPrice) / (osmosisPrice / boltPrice + 1)

    const numerator = balance1.minus(balance0.times(osmosisPrice));
    const denominator = BigNumber(osmosisPrice).div(boltPrice).plus(1);
    const amountToBridge = numerator.div(denominator);

    console.log(
      `Calculated optimal bridge amount: ${
        new TokenAmount(amountToBridge, token1).humanReadableAmount
      } ${token1.name}`
    );
    const expectedOutput = amountToBridge.div(boltPrice);
    console.log(
      `Expected token0 output: ${
        new TokenAmount(expectedOutput, token0).humanReadableAmount
      } ${token0.name}`
    );

    // Verify if we are higher than the minimum swap amount out on bolt
    const boltClient = BoltOnArchway.makeBoltClient(this.environment);
    const boltPoolConfig = await boltClient.getPoolConfigByBaseAsset(
      token0Archway.denom
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

    // Bridge to Archway
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

    console.log(
      `Bridging ${
        new TokenAmount(amountToBridge, token1).humanReadableAmount
      } ${token1Archway.name} to Archway...`
    );
    const bridgeResult = await this.skipBridging.bridgeToken(
      this.osmosisSigner,
      {
        [this.osmosisChainInfo.id]: osmosisAddress,
        [this.archwayChainInfo.id]: archwayAddress,
        "noble-1": convertAddress(archwayAddress, "noble")!,
        "cosmoshub-4": convertAddress(archwayAddress, "cosmos")!,
        celestia: convertAddress(archwayAddress, "celestia")!,
        "axelar-dojo-1": convertAddress(archwayAddress, "axelar")!,
        "akashnet-2": convertAddress(archwayAddress, "akash")!,
        // TODO: implement a way to get injective singer/address conversion
      },
      {
        fromToken: token1,
        toChainId: this.archwayChainInfo.id,
        amount: amountToBridge.toFixed(0),
      }
    );

    console.log(`Bridge complete. Tx: ${bridgeResult.txHash}`);

    // Swap on Bolt
    console.log(
      `Swapping ${
        new TokenAmount(amountToBridge, token1).humanReadableAmount
      } ${token1Archway.name} for ~${
        new TokenAmount(expectedOutput, token0).humanReadableAmount
      } ${token0Archway.name} on Bolt...`
    );

    const swapResult = await boltClient.swap(
      {
        assetIn: token1Archway.denom,
        assetOut: token0Archway.denom,
        amountIn: amountToBridge.toFixed(0),
      },
      this.archwaySigner
    );

    console.log(`Swap complete. Tx: ${swapResult.txHash}`);

    const boltSwapOutput = BigNumber(swapResult.amountOut);

    // Bridge token0 back to Osmosis
    console.log(
      `Bridging ${
        new TokenAmount(boltSwapOutput, token0).humanReadableAmount
      } ${token0Archway.name} back to Osmosis...`
    );

    const bridgeBackResult = await this.skipBridging.bridgeToken(
      this.archwaySigner,
      {
        [this.osmosisChainInfo.id]: osmosisAddress,
        [this.archwayChainInfo.id]: archwayAddress,
        "noble-1": convertAddress(archwayAddress, "noble")!,
        "cosmoshub-4": convertAddress(archwayAddress, "cosmos")!,
        celestia: convertAddress(archwayAddress, "celestia")!,
        "axelar-dojo-1": convertAddress(archwayAddress, "axelar")!,
        "akashnet-2": convertAddress(archwayAddress, "akash")!,
        // TODO: implement a way to get injective singer/address conversion
      },
      {
        fromToken: token0Archway,
        toChainId: this.osmosisChainInfo.id,
        amount: boltSwapOutput.toFixed(0),
      }
    );

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
}
