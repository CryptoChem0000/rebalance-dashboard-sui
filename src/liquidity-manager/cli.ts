#!/usr/bin/env node
import { Command } from "commander";

import { LiquidityManager } from "./liquidity-manager";

const program = new Command();

program
  .name("liquidity-manager")
  .description(
    "Automated liquidity management for Osmosis concentrated liquidity pools"
  )
  .version("1.0.0");

program
  .command("run")
  .description("Run the liquidity management process")
  .option(
    "-e, --environment <env>",
    "Environment (mainnet or testnet)",
    "mainnet"
  )
  .option("--rpc <url>", "Custom RPC endpoint")
  .option("--rest <url>", "Custom REST endpoint")
  .action(async (options) => {
    try {
      console.log("🚀 Starting Liquidity Manager...");
      console.log(`Environment: ${options.environment}`);

      // Initialize manager
      const manager = await LiquidityManager.make({
        environment: options.environment,
        // TODO: pass the correct endpoints override if set in cli params
        rpcEndpointsOverride: {},
        restEndpointsOverride: {},
      });

      // Execute
      const result = await manager.execute();

      console.log("\n✅ Liquidity management completed!");
      console.log(`Pool ID: ${result.poolId}`);
      console.log(`Position ID: ${result.positionId}`);
      console.log(`Action: ${result.action}`);
      console.log(`Message: ${result.message}`);

      if (result.error) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
    } catch (error: any) {
      console.error("\n❌ Error:", error?.message);
      console.error(error);
      process.exit(1);
    }
  });

program
  .command("check")
  .description("Check current position status without making changes")
  .option(
    "-e, --environment <env>",
    "Environment (mainnet or testnet)",
    "mainnet"
  )
  .option("--rpc <url>", "Custom RPC endpoint")
  .option("--rest <url>", "Custom REST endpoint")
  .action(async (options) => {
    try {
      console.log("🔍 Checking position status...");

      const manager = await LiquidityManager.make({
        environment: options.environment,
        // TODO: pass the correct endpoints override if set in cli params
        rpcEndpointsOverride: {},
        restEndpointsOverride: {},
      });

      // TODO: Implement status check
      console.log(
        "Position check functionality to be implemented",
        manager ? ":)" : ":("
      );
    } catch (error: any) {
      console.error("\n❌ Error:", error?.message);
      process.exit(1);
    }
  });

program.parse();

// Handle no command
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
