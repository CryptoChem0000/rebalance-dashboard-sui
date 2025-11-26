import { Command } from "commander";

import {
  createRangeVisual,
  gracefulShutdown,
  simpleGracefulShutdown,
  withLogger,
} from "../helpers";
import {
  loadConfigWithEnvOverrides,
  OsmosisLiquidityManager,
  PositionRangeResult,
  StatusPoolInfo,
  StatusPositionInfo,
  SuiLiquidityManager,
} from "../../liquidity-manager";

export function statusCommand(program: Command) {
  program
    .command("status")
    .description("Show current pool and position status")
    .option(
      "-e, --environment <env>",
      "Environment (mainnet or testnet)",
      "mainnet"
    )
    .option("--log-file <filename>", "Custom log filename")
    .option("--no-log", "Disable logging")
    .option("--config-file <path>", "Path to config file")
    .action(async (options) => {
      await simpleGracefulShutdown(async () => {
        await withLogger(options, async (logger) => {
          console.log("📊 Checking status...\n");
          if (options.configFile) {
            console.log(`Config file: ${options.configFile}`);
          }

          const { config, configFilePath } = await loadConfigWithEnvOverrides(
            options.configFile
          );

          const manager =
            config.chain === "sui"
              ? await SuiLiquidityManager.make({
                  environment: options.environment,
                  configFilePath,
                  config,
                  // TODO: pass the correct endpoint override if set in cli params
                  rpcEndpointOverride: undefined,
                })
              : await OsmosisLiquidityManager.make({
                  environment: options.environment,
                  configFilePath,
                  config,
                  // TODO: pass the correct endpoints override if set in cli params
                  rpcEndpointsOverride: {},
                  restEndpointsOverride: {},
                });

          gracefulShutdown.registerHandler({
            waitForOperation: async () => {},
            cleanup: async () => {
              manager?.database?.close();
              logger.close();
            },
          });

          const status = await manager.getStatus();
          displayPoolInfo(status.poolInfo);
          displayPositionInfo(status.positionInfo);
          displayRangeStatus(
            manager.config.rebalanceThresholdPercent,
            status.positionInfo?.range
          );
        });
      });
    });
}

function displayPoolInfo(poolInfo?: StatusPoolInfo) {
  if (!poolInfo) {
    console.log("\nℹ️  No pool configured yet");
    return;
  }

  console.log("🏊 Pool Information:");
  console.log("─".repeat(50));
  console.log(`Pool ID: ${poolInfo.id}`);
  console.log(`Token 0: ${poolInfo.token0}`);
  console.log(`Token 1: ${poolInfo.token1}`);
  console.log(`Tick Spacing: ${poolInfo.tickSpacing}`);
  console.log(`Spread Factor: ${poolInfo.spreadFactor}`);
  console.log(`Current Tick: ${poolInfo.currentTick}`);
}

function displayPositionInfo(positionInfo?: StatusPositionInfo) {
  if (!positionInfo) {
    console.log("\nℹ️  No position configured yet");
    return;
  }

  console.log("\n📍 Position Information:");
  console.log("─".repeat(50));
  console.log(`Position ID: ${positionInfo.id}`);
  console.log(`Lower Tick: ${positionInfo.lowerTick}`);
  console.log(`Upper Tick: ${positionInfo.upperTick}`);
  console.log(`Lower Price: ${positionInfo.lowerPrice}`);
  console.log(`Upper Price: ${positionInfo.upperPrice}`);
  console.log(`Liquidity: ${positionInfo.liquidity}`);
  console.log(
    `Asset 0: ${positionInfo.asset0.amount} ${positionInfo.asset0.denom}`
  );
  console.log(
    `Asset 1: ${positionInfo.asset1.amount} ${positionInfo.asset1.denom}`
  );
}

function displayRangeStatus(
  rebalanceThresholdPercent: number,
  positionRange?: PositionRangeResult
) {
  if (!positionRange) {
    console.log("\nℹ️  Failed to calculate position range");
    return;
  }

  console.log("\n📈 Range Status:");
  console.log("─".repeat(50));

  const statusIcon = positionRange.isInRange ? "✅" : "❌";
  console.log(
    `Status: ${statusIcon} ${
      positionRange.isInRange ? "IN RANGE" : "OUT OF RANGE"
    }`
  );
  console.log(
    `Position Balance: ${positionRange.percentageBalance.toFixed(2)}%`
  );
  console.log(`Threshold: ${rebalanceThresholdPercent}%`);

  // Visual representation
  console.log("\n📊 Position Range Visual:");
  console.log("0%                       50%                      100%");
  console.log(createRangeVisual(positionRange.percentageBalance));

  if (!positionRange.isInRange) {
    if (positionRange.percentageBalance <= 100 - rebalanceThresholdPercent) {
      console.log("\n⚠️  Position is below lower range - mostly token1");
    } else if (positionRange.percentageBalance >= rebalanceThresholdPercent) {
      console.log("\n⚠️  Position is above upper range - mostly token0");
    }
  }
}
