import { Command } from "commander";

import { interruptibleSleep, gracefulShutdown, withLogger } from "../helpers";
import { SuiLiquidityManager, loadSuiConfigWithEnvOverrides } from "../../liquidity-manager";

export function suiCommand(program: Command) {
  program
    .command("sui")
    .description("Run the Sui liquidity management process")
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
    .option("--config-file <path>", "Path to config file (defaults to sui-config.json)")
    .action(async (options) => {
      try {
        await withLogger(options, async (logger) => {
          console.log("🚀 Starting Sui Liquidity Manager...");
          console.log(`Environment: ${options.environment}`);
          if (options.configFile) {
            console.log(`Config file: ${options.configFile}`);
          }
          if (options.watch) {
            console.log(`Watch interval: ${options.watch} seconds`);
            console.log(
              `Retry strategy: Exponential backoff (doubles each error, capped at ${options.watch}s)`
            );
          }

          const { config, configFilePath } = await loadSuiConfigWithEnvOverrides(
            options.configFile
          );

          const manager = await SuiLiquidityManager.make({
            environment: options.environment,
            configFilePath,
            config,
            rpcEndpointOverride: undefined,
          });

          // Register cleanup handler
          gracefulShutdown.registerHandler({
            waitForOperation: async () => {},
            cleanup: async () => {
              try {
                manager?.database?.close();
              } catch (error) {
                console.error("Error closing database:", error);
              }
              try {
                logger.close();
              } catch (error) {
                console.error("Error closing logger:", error);
              }
            },
          });

          // Execute operation
          const result = await executeWithTracking(manager, !!options.watch);
          displayResult(result);

          // If in watch mode, continue regardless of first run result
          if (options.watch && options.watch > 0) {
            // If first run failed, adjust the initial delay
            if (result.error) {
              console.error(
                `\nFirst run failed. Starting watch mode with exponential backoff...`
              );

              // Start handleWatchMode with a pre-set error state
              let consecutiveErrors = 1;
              const MIN_RETRY_DELAY = 2;
              let currentRetryDelay = Math.min(MIN_RETRY_DELAY, options.watch);
              console.error(`Retrying in ${currentRetryDelay} seconds...`);

              while (!gracefulShutdown.isShutdownRequested()) {
                await interruptibleSleep(
                  currentRetryDelay * 1000,
                  () => gracefulShutdown.isShutdownRequested()
                );

                if (gracefulShutdown.isShutdownRequested()) break;

                console.log(
                  `\n⏰ Checking position... [${new Date().toLocaleTimeString()}]`
                );

                const watchResult = await executeWithTracking(manager, true);

                if (watchResult.error) {
                  consecutiveErrors++;

                  // Exponential backoff from MIN_RETRY_DELAY
                  currentRetryDelay = Math.min(
                    Math.max(
                      MIN_RETRY_DELAY,
                      MIN_RETRY_DELAY * Math.pow(2, consecutiveErrors - 1)
                    ),
                    options.watch
                  );

                  console.error(
                    `\n❌ Error #${consecutiveErrors} during check`
                  );
                  console.error(
                    `Next retry in ${currentRetryDelay} seconds...`
                  );
                } else {
                  // Reset on success
                  if (consecutiveErrors > 0) {
                    console.log(
                      `✅ Recovered from ${consecutiveErrors} consecutive error(s)`
                    );
                  }
                  // Success - switch to normal watch mode
                  await handleWatchMode(manager, options.watch);
                  break; // Exit this loop since handleWatchMode will take over
                }
              }
            } else {
              // First run succeeded, use normal watch mode
              await handleWatchMode(manager, options.watch);
            }
          } else if (!options.watch && result.error) {
            // Not in watch mode and there was an error
            process.exit(1);
          }
        });
      } catch (error: any) {
        console.error("\n❌ Error:", error?.message);
        console.error(error);
        if (!options.watch) {
          process.exit(1);
        }
      }
    });
}

async function executeWithTracking(
  manager: SuiLiquidityManager,
  isWatchMode: boolean = false
) {
  try {
    const executeOperation = manager.execute();
    gracefulShutdown.setCurrentOperation(executeOperation);
    const result = await executeOperation;
    gracefulShutdown.setCurrentOperation(null);
    return result;
  } catch (error) {
    gracefulShutdown.setCurrentOperation(null);
    if (isWatchMode) {
      // In watch mode, log the error but return a safe result
      console.error("⚠️  Error during execution:", error);

      return {
        poolId: manager.config.poolId || "unknown",
        positionId: manager.config.positionId || "unknown",
        action: "error" as const,
        message: `Error: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error: error instanceof Error ? error.message : String(error),
      };
    } else {
      // In non-watch mode, re-throw the error
      throw error;
    }
  }
}

function displayResult(result: any) {
  if (result.error) {
    console.error(`Error: ${result.error}`);
  } else {
    console.log("\n✅ Liquidity management completed!");
    console.log(`Pool ID: ${result.poolId}`);
    console.log(`Position ID: ${result.positionId}`);
    console.log(`Action: ${result.action}`);
    console.log(`Message: ${result.message}`);
  }
}

async function handleWatchMode(
  manager: SuiLiquidityManager,
  watchInterval: number
) {
  console.log(
    `\n👁️  Watch mode enabled - checking every ${watchInterval} seconds...`
  );

  let consecutiveErrors = 0;
  let currentRetryDelay = watchInterval; // Start with normal interval
  const MIN_RETRY_DELAY = 2; // Minimum 2 seconds between retries

  while (!gracefulShutdown.isShutdownRequested()) {
    await interruptibleSleep(
      currentRetryDelay * 1000,
      () => gracefulShutdown.isShutdownRequested()
    );

    if (gracefulShutdown.isShutdownRequested()) break;

    console.log(
      `\n⏰ Checking position... [${new Date().toLocaleTimeString()}]`
    );

    const watchResult = await executeWithTracking(manager, true);

    if (watchResult.error) {
      consecutiveErrors++;

      // Calculate exponential backoff: double the delay each time
      // Start from MIN_RETRY_DELAY for the first error
      currentRetryDelay = Math.min(
        Math.max(
          MIN_RETRY_DELAY,
          MIN_RETRY_DELAY * Math.pow(2, consecutiveErrors - 1)
        ),
        watchInterval
      );

      console.error(`\n❌ Error #${consecutiveErrors} during check`);
      console.error(`Next retry in ${currentRetryDelay} seconds...`);
    } else {
      // Reset on success
      if (consecutiveErrors > 0) {
        console.log(
          `✅ Recovered from ${consecutiveErrors} consecutive error(s)`
        );
      }
      consecutiveErrors = 0;
      currentRetryDelay = watchInterval; // Reset to normal interval

      if (watchResult.action !== "none") {
        console.log("\n🔄 Position updated!");
        console.log(`Action: ${watchResult.action}`);
        console.log(`Message: ${watchResult.message}`);
      } else {
        console.log("✅ Position still in range");
      }
    }
  }
}

