import { convertAddress } from "@archway-kit/utils";
import { OfflineSigner } from "@cosmjs/proto-signing";
import { BigNumber } from "bignumber.js";

import { OsmosisAccount, TokenAmount } from "../account-balances";
import { BoltOnArchway } from "../bolt-liquidity";
import { SkipBridging } from "../ibc-bridging";
import { getPairPriceOnBoltArchway } from "../prices";
import {
  findRegistryTokenEquivalentOnOtherChain,
  findArchwayChainInfo,
  findOsmosisChainInfo,
} from "../registry";
import { getSignerAddress, humanReadablePrice } from "../utils";

import { TokenPairBalances, TokenRebalancerConfig } from "./types";

export class TokenRebalancer {
  private archwaySigner: OfflineSigner;
  private osmosisSigner: OfflineSigner;
  private environment: "mainnet" | "testnet";
  private skipBridging: SkipBridging;

  constructor(config: TokenRebalancerConfig) {
    this.archwaySigner = config.archwaySigner;
    this.osmosisSigner = config.osmosisSigner;
    this.environment = config.environment;
    this.skipBridging = config.skipBridging;
  }

  async rebalanceTokensFor5050Deposit(
    currentBalances: TokenPairBalances,
    currentPrice: string
  ): Promise<TokenPairBalances> {
    const token0 = currentBalances.token0.token;
    const token1 = currentBalances.token1.token;
    const balance0Value = BigNumber(currentBalances.token0.amount);
    const balance1Value = BigNumber(currentBalances.token1.amount);

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
      return currentBalances;
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
        currentBalances,
        token0Excess,
        currentPrice
      );
    } else {
      // We have excess token1, need to swap some for token0
      console.log(
        `Excess ${token1.name}: ${
          new TokenAmount(token1Excess.abs(), token1).humanReadableAmount
        }`
      );
      return await this.handleExcessToken1(
        currentBalances,
        token1Excess.abs(),
        currentPrice
      );
    }
  }

  private async handleExcessToken0(
    currentBalances: TokenPairBalances,
    excessAmount: BigNumber,
    osmosisPrice: string
  ): Promise<TokenPairBalances> {
    const token0 = currentBalances.token0.token;
    const token1 = currentBalances.token1.token;

    const osmosisAddress = await getSignerAddress(this.osmosisSigner);
    const archwayAddress = await getSignerAddress(this.archwaySigner);
    const archwayChainInfo = findArchwayChainInfo(this.environment);
    const osmosisChainInfo = findOsmosisChainInfo(this.environment);

    // Find Archway equivalents
    const token0Archway = findRegistryTokenEquivalentOnOtherChain(
      token0,
      archwayChainInfo.id
    );
    const token1Archway = findRegistryTokenEquivalentOnOtherChain(
      token1,
      archwayChainInfo.id
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

    // Calculate the exact amount to bridge based on Bolt price
    // We need to solve: amountToBridge * boltPrice * slippage = (excessAmount - amountToBridge) * osmosisPrice
    // This ensures after swapping, both tokens will have equal value
    const slippageFactor = BigNumber(1); // 0% slippage tolerance
    const numerator = excessAmount.times(osmosisPrice);
    const denominator = BigNumber(osmosisPrice).plus(
      BigNumber(boltPrice).times(slippageFactor)
    );
    const amountToBridge = numerator.div(denominator);

    console.log(
      `Calculated optimal bridge amount: ${
        new TokenAmount(amountToBridge, token0).humanReadableAmount
      } ${token0.name}`
    );
    const expectedOutput = BigNumber(amountToBridge)
      .times(boltPrice)
      .times(slippageFactor);
    console.log(
      `Expected token1 output: ${
        new TokenAmount(expectedOutput, token1).humanReadableAmount
      } ${token1.name}`
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
      return currentBalances;
    }

    // Bridge to Archway
    const bridgeResult = await this.skipBridging.bridgeToken(
      this.osmosisSigner,
      {
        [osmosisChainInfo.id]: osmosisAddress,
        [archwayChainInfo.id]: archwayAddress,
        // TODO: fix hardcoded address conversion
        "noble-1": convertAddress(archwayAddress, "noble")!,
        "cosmoshub-4": convertAddress(archwayAddress, "cosmos")!,
      },
      {
        fromToken: token0,
        toChainId: archwayChainInfo.id,
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
        [osmosisChainInfo.id]: osmosisAddress,
        [archwayChainInfo.id]: archwayAddress,
        // TODO: fix hardcoded address conversion
        "noble-1": convertAddress(archwayAddress, "noble")!,
        "cosmoshub-4": convertAddress(archwayAddress, "cosmos")!,
      },
      {
        fromToken: token1Archway,
        toChainId: osmosisChainInfo.id,
        amount: boltSwapOutput.toFixed(0),
      }
    );

    console.log(`Bridge back complete. Tx: ${bridgeBackResult.txHash}`);

    // Get updated balances
    const osmosisAccount = new OsmosisAccount(osmosisAddress, this.environment);
    const newBalance0 = await osmosisAccount.getTokenAvailableBalance(
      token0.denom
    );
    const newBalance1 = await osmosisAccount.getTokenAvailableBalance(
      token1.denom
    );

    return {
      token0: newBalance0,
      token1: newBalance1,
    };
  }

  private async handleExcessToken1(
    currentBalances: TokenPairBalances,
    excessAmount: BigNumber,
    osmosisPrice: string
  ): Promise<TokenPairBalances> {
    const token0 = currentBalances.token0.token;
    const token1 = currentBalances.token1.token;

    const archwayAddress = await getSignerAddress(this.archwaySigner);
    const osmosisAddress = await getSignerAddress(this.osmosisSigner);
    const archwayChainInfo = findArchwayChainInfo(this.environment);
    const osmosisChainInfo = findOsmosisChainInfo(this.environment);

    // Find Archway equivalents
    const token0Archway = findRegistryTokenEquivalentOnOtherChain(
      token0,
      archwayChainInfo.id
    );
    const token1Archway = findRegistryTokenEquivalentOnOtherChain(
      token1,
      archwayChainInfo.id
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

    // Calculate the exact amount to bridge based on Bolt price
    // For excess token1: amountToBridge / boltPrice * slippage = (excessAmount - amountToBridge) / osmosisPrice
    // This ensures after swapping, both tokens will have equal value
    const slippageFactor = BigNumber(1); // 0% slippage tolerance
    const numerator = excessAmount.div(osmosisPrice);
    const denominator = BigNumber(1)
      .div(osmosisPrice)
      .plus(BigNumber(1).div(boltPrice).times(slippageFactor));
    const amountToBridge = numerator.div(denominator);

    console.log(
      `Calculated optimal bridge amount: ${
        new TokenAmount(amountToBridge, token1).humanReadableAmount
      } ${token1.name}`
    );
    const expectedOutput = amountToBridge.div(boltPrice).times(slippageFactor);
    console.log(
      `Expected token0 output: ${
        new TokenAmount(expectedOutput, token0).humanReadableAmount
      } ${token0.name}`
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
      return currentBalances;
    }

    // Bridge to Archway
    const bridgeResult = await this.skipBridging.bridgeToken(
      this.osmosisSigner,
      {
        [osmosisChainInfo.id]: osmosisAddress,
        [archwayChainInfo.id]: archwayAddress,
        // TODO: fix hardcoded address conversion
        "noble-1": convertAddress(archwayAddress, "noble")!,
        "cosmoshub-4": convertAddress(archwayAddress, "cosmos")!,
      },
      {
        fromToken: token1,
        toChainId: archwayChainInfo.id,
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
        [osmosisChainInfo.id]: osmosisAddress,
        [archwayChainInfo.id]: archwayAddress,
        // TODO: fix hardcoded address conversion
        "noble-1": convertAddress(archwayAddress, "noble")!,
        "cosmoshub-4": convertAddress(archwayAddress, "cosmos")!,
      },
      {
        fromToken: token0Archway,
        toChainId: osmosisChainInfo.id,
        amount: boltSwapOutput.toFixed(0),
      }
    );

    console.log(`Bridge back complete. Tx: ${bridgeBackResult.txHash}`);

    // Get updated balances
    const osmosisAccount = new OsmosisAccount(osmosisAddress, this.environment);
    const newBalance0 = await osmosisAccount.getTokenAvailableBalance(
      token0.denom
    );
    const newBalance1 = await osmosisAccount.getTokenAvailableBalance(
      token1.denom
    );

    return {
      token0: newBalance0,
      token1: newBalance1,
    };
  }
}
