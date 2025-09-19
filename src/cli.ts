#!/usr/bin/env node
import { Command } from "commander";

import { LiquidityManager } from "./liquidity-manager";
import { Logger, createRangeVisual, sleep } from "./utils";

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
  .option(
    "-w, --watch <seconds>",
    "Keep running and check position every X seconds",
    (value) => parseInt(value, 10)
  )
  .option("--no-log", "Disable logging to file")
  .option("--log-file <filename>", "Custom log filename")
  .action(async (options) => {
    const logger = new Logger(options.logFile);

    try {
      // Initialize logger if logging is enabled
      if (options.log !== false) {
        await logger.initialize();
        console.log(`📝 Logging to: ${logger.getLogPath()}`);
      }

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
        logger.close();
        process.exit(1);
      }

      // If watch mode is enabled, keep running
      if (options.watch && options.watch > 0) {
        console.log(
          `\n👁️  Watch mode enabled - checking every ${options.watch} seconds...`
        );

        while (true) {
          await sleep(options.watch * 1000);

          console.log(
            `\n⏰ Checking position... [${new Date().toLocaleTimeString()}]`
          );

          try {
            const watchResult = await manager.execute();

            if (watchResult.action !== "none") {
              console.log("\n🔄 Position updated!");
              console.log(`Action: ${watchResult.action}`);
              console.log(`Message: ${watchResult.message}`);
            } else {
              console.log("✅ Position still in range");
            }
          } catch (error: any) {
            console.error("⚠️  Error during check:", error?.message);
          }
        }
      }
    } catch (error: any) {
      console.error("\n❌ Error:", error?.message);
      console.error(error);
      logger.close();
      process.exit(1);
    } finally {
      // Close logger when process ends normally (not in watch mode)
      if (options.watch === undefined || options.watch <= 0) {
        logger.close();
      }
    }
  });

program
  .command("status")
  .description("Show current pool and position status")
  .option(
    "-e, --environment <env>",
    "Environment (mainnet or testnet)",
    "mainnet"
  )
  .option("--no-log", "Disable logging to file")
  .option("--log-file <filename>", "Custom log filename")
  .action(async (options) => {
    const logger = new Logger(options.logFile);

    try {
      // Initialize logger if logging is enabled
      if (options.log !== false) {
        await logger.initialize();
        console.log(`📝 Logging to: ${logger.getLogPath()}`);
      }

      console.log("📊 Checking status...\n");

      const manager = await LiquidityManager.make({
        environment: options.environment,
        // TODO: pass the correct endpoints override if set in cli params
        rpcEndpointsOverride: {},
        restEndpointsOverride: {},
      });

      const status = await manager.getStatus();

      if (!status.poolInfo) {
        console.log("\nℹ️  No pool configured yet");
        logger.close();
        return;
      }

      // Get pool info
      console.log("🏊 Pool Information:");
      console.log("─".repeat(50));
      console.log(`Pool ID: ${status.poolInfo.id}`);
      console.log(`Token 0: ${status.poolInfo.token0}`);
      console.log(`Token 1: ${status.poolInfo.token1}`);
      console.log(`Tick Spacing: ${status.poolInfo.tickSpacing}`);
      console.log(`Spread Factor: ${status.poolInfo.spreadFactor}`);
      console.log(`Current Tick: ${status.poolInfo.currentTick}`);

      if (!status.positionInfo) {
        console.log("\nℹ️  No position configured yet");
        logger.close();
        return;
      }

      // Get position info
      console.log("\n📍 Position Information:");
      console.log("─".repeat(50));
      console.log(`Position ID: ${status.positionInfo.position.positionId}`);
      console.log(`Lower Tick: ${status.positionInfo.position.lowerTick}`);
      console.log(`Upper Tick: ${status.positionInfo.position.upperTick}`);
      console.log(`Lower Price: ${status.positionLowerPrice}`);
      console.log(`Upper Price: ${status.positionUpperPrice}`);

      console.log(`Liquidity: ${status.positionInfo.position.liquidity}`);
      console.log(
        `Asset 0: ${status.positionInfo.asset0.amount} ${status.positionInfo.asset0.denom}`
      );
      console.log(
        `Asset 1: ${status.positionInfo.asset1.amount} ${status.positionInfo.asset1.denom}`
      );

      if (!status.positionRange) {
        console.log("\nℹ️  Failed to calculate position range");
        logger.close();
        return;
      }

      // Check if in range
      console.log("\n📈 Range Status:");
      console.log("─".repeat(50));

      const statusIcon = status.positionRange.isInRange ? "✅" : "❌";
      console.log(
        `Status: ${statusIcon} ${
          status.positionRange.isInRange ? "IN RANGE" : "OUT OF RANGE"
        }`
      );
      console.log(
        `Position Balance: ${status.positionRange.percentageBalance.toFixed(
          2
        )}%`
      );
      console.log(`Threshold: ${manager.config.rebalanceThresholdPercent}%`);

      // Visual representation
      console.log("\n📊 Position Range Visual:");
      console.log("0%                       50%                      100%");
      console.log(createRangeVisual(status.positionRange.percentageBalance));

      if (!status.positionRange.isInRange) {
        if (
          status.positionRange.percentageBalance <=
          100 - manager.config.rebalanceThresholdPercent
        ) {
          console.log("\n⚠️  Position is below lower range - mostly token1");
        } else if (
          status.positionRange.percentageBalance >=
          manager.config.rebalanceThresholdPercent
        ) {
          console.log("\n⚠️  Position is above upper range - mostly token0");
        }
      }
    } catch (error: any) {
      console.error("\n❌ Error:", error?.message);
      logger.close();
      process.exit(1);
    } finally {
      logger.close();
    }
  });

// Handle process termination
process.on("SIGINT", () => {
  console.log("\n\n🛑 Process interrupted by user");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n\n🛑 Process terminated");
  process.exit(0);
});

program.parse();

// Handle no command
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
