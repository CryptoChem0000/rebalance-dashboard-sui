import { Command } from "commander";

import {
  gracefulShutdown,
  simpleGracefulShutdown,
  withLogger,
} from "../helpers";
import { LiquidityManager } from "../../liquidity-manager";

export function withdrawCommand(program: Command) {
  program
    .command("withdraw")
    .description("Withdraw current position and remove it from config")
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
          console.log("💰 Starting position withdrawal...\n");
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

          gracefulShutdown.registerHandler({
            waitForOperation: async () => {},
            cleanup: async () => {
              manager?.database?.close();
              logger.close();
            },
          });

          await manager.withdrawPosition();
        });
      });
    });
}
