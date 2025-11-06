import { Command } from "commander";

import {
  sleep,
  gracefulShutdown,
  withErrorHandling,
  withLogger,
} from "../helpers";
import { LiquidityManager } from "../../liquidity-manager";

export function runCommand(program: Command) {
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
    .option("--log-file <filename>", "Custom log filename")
    .option("--no-log", "Disable logging to file")
    .option("--config-file <path>", "Path to config file")
    .action(
      withErrorHandling(async (options) => {
        await withLogger(options, async (logger) => {
          console.log("🚀 Starting Liquidity Manager...");
          console.log(`Environment: ${options.environment}`);
          if (options.configFile) {
            console.log(`Config file: ${options.configFile}`);
          }

          const manager = await LiquidityManager.make({
            environment: options.environment,
            configFilePath: options.configFile,
            // TODO: pass the correct endpoints override if set in cli params
            rpcEndpointsOverride: {},
            restEndpointsOverride: {},
          });

          // Register cleanup handler
          gracefulShutdown.registerHandler({
            waitForOperation: async () => {},
            cleanup: async () => {
              manager?.database?.close();
              logger.close();
            },
          });

          // Execute operation
          const result = await executeWithTracking(manager);
          displayResult(result);

          // Handle watch mode
          if (options.watch && options.watch > 0) {
            await handleWatchMode(manager, options.watch);
          }
        });
      })
    );
}

async function executeWithTracking(manager: LiquidityManager) {
  const executeOperation = manager.execute();
  gracefulShutdown.setCurrentOperation(executeOperation);
  const result = await executeOperation;
  gracefulShutdown.setCurrentOperation(null);
  return result;
}

function displayResult(result: any) {
  console.log("\n✅ Liquidity management completed!");
  console.log(`Pool ID: ${result.poolId}`);
  console.log(`Position ID: ${result.positionId}`);
  console.log(`Action: ${result.action}`);
  console.log(`Message: ${result.message}`);

  if (result.error) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }
}

async function handleWatchMode(
  manager: LiquidityManager,
  watchInterval: number
) {
  console.log(
    `\n👁️  Watch mode enabled - checking every ${watchInterval} seconds...`
  );

  while (!gracefulShutdown.isShutdownRequested()) {
    await sleep(watchInterval * 1000);

    if (gracefulShutdown.isShutdownRequested()) break;

    console.log(
      `\n⏰ Checking position... [${new Date().toLocaleTimeString()}]`
    );

    try {
      const watchResult = await executeWithTracking(manager);

      if (watchResult.action !== "none") {
        console.log("\n🔄 Position updated!");
        console.log(`Action: ${watchResult.action}`);
        console.log(`Message: ${watchResult.message}`);
      } else {
        console.log("✅ Position still in range");
      }
    } catch (error: any) {
      gracefulShutdown.setCurrentOperation(null);
      console.error("⚠️  Error during check:", error?.message);
    }
  }
}
