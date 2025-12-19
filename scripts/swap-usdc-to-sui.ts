#!/usr/bin/env tsx
/**
 * Script to swap 500 USDC to SUI using Bolt
 * 
 * Usage:
 *   tsx scripts/swap-usdc-to-sui.ts
 * 
 * Or with npm:
 *   npm run swap:usdc-to-sui
 */

import { BoltSuiClient } from "@bolt-liquidity-hq/sui-client";
import { BigNumber } from "bignumber.js";
import { normalizeStructTag, SUI_TYPE_ARG } from "@mysten/sui/utils";

import { TokenAmount } from "../src/account-balances";
import { extractGasFees, extractPlatformFees } from "../src/cetus-integration";
import { DEFAULT_KEY_NAME, KeyManager, KeyStoreType } from "../src/key-manager";
import {
  SUI_MAINNET_CHAIN_INFO,
  SUI_MAINNET_TOKENS_MAP,
  SUI_MAINNET_NATIVE_TOKEN,
} from "../src/registry/sui";
import { getSignerAddress } from "../src/utils";

async function swapUsdcToSui() {
  console.log("🔄 Starting USDC to SUI swap...\n");

  // Initialize key manager and get signer
  const keyStore = await KeyManager.create({
    type: KeyStoreType.ENV_VARIABLE,
  });

  const signer = await keyStore.getSuiSigner(DEFAULT_KEY_NAME);
  const address = await getSignerAddress(signer);
  console.log(`📍 Wallet address: ${address}\n`);

  // Get token info
  const usdcToken = SUI_MAINNET_TOKENS_MAP[
    "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC"
  ];
  const suiToken = SUI_MAINNET_NATIVE_TOKEN;

  if (!usdcToken) {
    throw new Error("USDC token not found in registry");
  }

  // Convert 500 USDC to smallest units (USDC has 6 decimals)
  const usdcAmount = BigNumber(500).times(10 ** usdcToken.decimals);
  const usdcTokenAmount = new TokenAmount(usdcAmount.toFixed(0), usdcToken);

  console.log(`💰 Swapping: ${usdcTokenAmount.humanReadableAmount} ${usdcToken.name}`);
  console.log(`   (${usdcAmount.toFixed(0)} smallest units)\n`);

  // Initialize Bolt client
  const boltClient = new BoltSuiClient();

  // Get current price
  const assetIn = normalizeStructTag(usdcToken.denom);
  const assetOut = normalizeStructTag(SUI_TYPE_ARG);

  console.log("📊 Fetching current price...");
  const priceResult = await boltClient.getPrice(assetIn, assetOut);
  const expectedSui = usdcAmount.times(priceResult.price);
  const expectedSuiTokenAmount = new TokenAmount(
    expectedSui.toFixed(0),
    suiToken
  );

  console.log(
    `   Price: 1 ${usdcToken.name} = ${priceResult.price} ${suiToken.name}`
  );
  console.log(
    `   Expected output: ~${expectedSuiTokenAmount.humanReadableAmount} ${suiToken.name}\n`
  );

  // Check minimum swap amount
  try {
    const poolConfig = await boltClient.getPoolConfigByDenom(
      assetIn,
      assetOut
    );
    if (poolConfig && expectedSui.lte(poolConfig.minBaseOut)) {
      throw new Error(
        `Swap amount is smaller than minimum output on Bolt exchange (${expectedSui.toString()} <= ${poolConfig.minBaseOut})`
      );
    }
  } catch (error) {
    console.log("⚠️  Could not check minimum swap amount, proceeding...\n");
  }

  // Confirm swap
  console.log("🚀 Executing swap on Bolt...\n");

  // Perform swap
  const swapResult = await boltClient.swap(
    {
      amountIn: usdcAmount.toFixed(0),
      assetIn,
      assetOut,
    },
    signer
  );

  // Extract fees
  const gasFees = extractGasFees(swapResult.txOutput, suiToken);
  const platformFees = extractPlatformFees(swapResult.txOutput, suiToken);

  // Display results
  console.log("✅ Swap completed successfully!\n");
  console.log("📋 Transaction Details:");
  console.log(`   Transaction Hash: ${swapResult.txHash}`);
  console.log(
    `   Input: ${usdcTokenAmount.humanReadableAmount} ${usdcToken.name}`
  );
  console.log(
    `   Output: ${new TokenAmount(swapResult.amountOut, suiToken).humanReadableAmount} ${suiToken.name}`
  );
  console.log(`   Gas Fee: ${gasFees.humanReadableAmount} ${gasFees.token.name}`);
  if (platformFees.amount !== "0") {
    console.log(
      `   Platform Fee: ${platformFees.humanReadableAmount} ${platformFees.token.name}`
    );
  }
  console.log(`\n🔗 View on explorer: https://suiexplorer.com/txblock/${swapResult.txHash}?network=mainnet`);
}

// Run the script
swapUsdcToSui()
  .then(() => {
    console.log("\n✨ Script completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error.message);
    console.error(error);
    process.exit(1);
  });

