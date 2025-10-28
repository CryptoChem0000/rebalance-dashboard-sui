#!/usr/bin/env node
import { Command } from "commander";

import { DatabaseQueryClient, TransactionType } from "./database";
import { LiquidityManager } from "./liquidity-manager";
import { Logger, createRangeVisual, parseDateOptions, sleep } from "./utils";

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
  .command("withdraw")
  .description("Withdraw current position and remove it from config")
  .option(
    "-e, --environment <env>",
    "Environment (mainnet or testnet)",
    "mainnet"
  )
  .option("--log-file <filename>", "Custom log filename")
  .action(async (options) => {
    const logger = new Logger(options.logFile);

    try {
      // Initialize logger if logging is enabled
      if (options.log !== false) {
        await logger.initialize();
        console.log(`📝 Logging to: ${logger.getLogPath()}`);
      }

      console.log("💰 Starting position withdrawal...\n");

      const manager = await LiquidityManager.make({
        environment: options.environment,
        // TODO: pass the correct endpoints override if set in cli params
        rpcEndpointsOverride: {},
        restEndpointsOverride: {},
      });

      await manager.withdrawPosition();
    } catch (error: any) {
      console.error("\n❌ Error:", error?.message);
      logger.close();
      process.exit(1);
    } finally {
      logger.close();
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
        return;
      }

      // Get pool info
      console.log("🏊 Pool Information:");
      console.log("─".repeat(50));
      console.log(status.poolInfo);
      console.log(`Pool ID: ${status.poolInfo.id}`);
      console.log(`Token 0: ${status.poolInfo.token0}`);
      console.log(`Token 1: ${status.poolInfo.token1}`);
      console.log(`Tick Spacing: ${status.poolInfo.tickSpacing}`);
      console.log(`Spread Factor: ${status.poolInfo.spreadFactor}`);
      console.log(`Current Tick: ${status.poolInfo.currentTick}`);

      if (!status.positionInfo) {
        console.log("\nℹ️  No position configured yet");
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

program
  .command("report")
  .description("Generate a full database report of all transactions")
  .option(
    "-e, --environment <env>",
    "Environment (mainnet or testnet)",
    "mainnet"
  )
  .option("--csv", "Export report to CSV files in reports/ folder")
  .option("-s, --start <date>", "Start date (DD-MM-YYYY)")
  .option("-E, --end <date>", "End date (DD-MM-YYYY)")
  .action(async (options) => {
    let dbQueryClient: DatabaseQueryClient | undefined;

    try {
      console.log("📊 Generating database report...\n");

      const { startDate, endDate } = parseDateOptions(options);

      dbQueryClient = await DatabaseQueryClient.make({
        environment: options.environment,
      });

      const report = await dbQueryClient.getFullReport(startDate, endDate);
      console.log(report);

      if (options.csv) {
        console.log("\n📁 Exporting to CSV files...");
        const files = await dbQueryClient.exportFullReportToCSV(
          startDate,
          endDate
        );
        console.log("\n✅ CSV files exported:");
        files.forEach((file) => console.log(`   - ${file}`));
      }
    } catch (error: any) {
      console.error("\n❌ Error:", error?.message);
      process.exit(1);
    } finally {
      dbQueryClient?.close();
    }
  });

// Volume command - shows trading volumes
program
  .command("volume")
  .description("Show trading volume statistics")
  .option(
    "-e, --environment <env>",
    "Environment (mainnet or testnet)",
    "mainnet"
  )
  .option(
    "-t, --type <type>",
    "Volume type: archway, osmosis, bridge, or all",
    "all"
  )
  .option("--csv", "Export to CSV file in reports/ folder")
  .option("-s, --start <date>", "Start date (DD-MM-YYYY)")
  .option("-E, --end <date>", "End date (DD-MM-YYYY)")
  .action(async (options) => {
    let dbQueryClient: DatabaseQueryClient | undefined;

    try {
      const { startDate, endDate } = parseDateOptions(options);

      dbQueryClient = await DatabaseQueryClient.make({
        environment: options.environment,
      });

      if (startDate || endDate) {
        console.log(
          `📅 Date range: ${
            startDate ? startDate.toLocaleDateString() : "All"
          } to ${endDate ? endDate.toLocaleDateString() : "Now"}\n`
        );
      }

      if (options.type === "all" || options.type === "archway") {
        console.log("🔄 Archway Bolt Volume:");
        console.log("─".repeat(60));
        const archwayVolume = await dbQueryClient.getArchwayBoltVolume(
          startDate,
          endDate
        );
        console.log(dbQueryClient.formatVolumeData(archwayVolume) || "No data");
        console.log();
      }

      if (options.type === "all" || options.type === "osmosis") {
        console.log("🌊 Osmosis Volume:");
        console.log("─".repeat(60));
        const osmosisVolume = await dbQueryClient.getOsmosisVolume(
          startDate,
          endDate
        );
        console.log(dbQueryClient.formatVolumeData(osmosisVolume) || "No data");
        console.log();
      }

      if (options.type === "all" || options.type === "bridge") {
        console.log("🌉 Bridge Volume:");
        console.log("─".repeat(60));
        const bridgeVolume = await dbQueryClient.getBridgeVolume(
          startDate,
          endDate
        );
        console.log(dbQueryClient.formatVolumeData(bridgeVolume) || "No data");
        console.log();
      }

      if (options.csv) {
        console.log("\n📁 Exporting to CSV file(s)...");
        const files = await dbQueryClient.exportVolumeToCSV(
          options.type as "archway" | "osmosis" | "bridge" | "all",
          startDate,
          endDate
        );
        console.log("\n✅ CSV file(s) exported:");
        files.forEach((file) => console.log(`   - ${file}`));
      }
    } catch (error: any) {
      console.error("\n❌ Error:", error?.message);
      process.exit(1);
    } finally {
      dbQueryClient?.close();
    }
  });

// Profit command - shows profitability analysis
program
  .command("profit")
  .description("Show profitability analysis")
  .option(
    "-e, --environment <env>",
    "Environment (mainnet or testnet)",
    "mainnet"
  )
  .option("--csv", "Export to CSV file in reports/ folder")
  .option("-s, --start <date>", "Start date (DD-MM-YYYY)")
  .option("-E, --end <date>", "End date (DD-MM-YYYY)")
  .action(async (options) => {
    let dbQueryClient: DatabaseQueryClient | undefined;

    try {
      console.log("💰 Calculating profitability...\n");

      const { startDate, endDate } = parseDateOptions(options);

      dbQueryClient = await DatabaseQueryClient.make({
        environment: options.environment,
      });

      if (startDate || endDate) {
        console.log(
          `📅 Date range: ${
            startDate ? startDate.toLocaleDateString() : "All"
          } to ${endDate ? endDate.toLocaleDateString() : "Now"}\n`
        );
      }

      const profitability = await dbQueryClient.getProfitability(
        startDate,
        endDate
      );
      console.log(dbQueryClient.formatProfitabilityData(profitability));

      if (options.csv) {
        console.log("\n📁 Exporting to CSV file...");
        const file = await dbQueryClient.exportProfitabilityToCSV(
          startDate,
          endDate
        );
        console.log(`\n✅ CSV file exported: ${file}`);
      }
    } catch (error: any) {
      console.error("\n❌ Error:", error?.message);
      process.exit(1);
    } finally {
      dbQueryClient?.close();
    }
  });

// Transactions command - lists transactions
program
  .command("transactions")
  .description("List recent transactions")
  .option(
    "-e, --environment <env>",
    "Environment (mainnet or testnet)",
    "mainnet"
  )
  .option("-l, --limit <number>", "Number of transactions to show", "20")
  .option(
    "-t, --type <type>",
    "Filter by transaction type (bolt_archway_swap, create_position, etc.)"
  )
  .option("--csv", "Export to CSV file in reports/ folder")
  .option("-s, --start <date>", "Start date (DD-MM-YYYY)")
  .option("-E, --end <date>", "End date (DD-MM-YYYY)")
  .action(async (options) => {
    let dbQueryClient: DatabaseQueryClient | undefined;

    try {
      const { startDate, endDate } = parseDateOptions(options);

      dbQueryClient = await DatabaseQueryClient.make({
        environment: options.environment,
      });

      const limit = parseInt(options.limit, 10);

      let transactions: any[];
      if (options.type) {
        console.log(`📄 Recent ${options.type} transactions:\n`);
        transactions = await dbQueryClient.getTransactionsByType(
          options.type as TransactionType,
          limit,
          startDate,
          endDate
        );
      } else {
        console.log(`📄 Recent transactions (limit: ${limit}):\n`);
        transactions = await dbQueryClient.getRecentTransactions(
          limit,
          0,
          startDate,
          endDate
        );
      }

      if (startDate || endDate) {
        console.log(
          `📅 Date range: ${
            startDate ? startDate.toLocaleDateString() : "All"
          } to ${endDate ? endDate.toLocaleDateString() : "Now"}\n`
        );
      }

      if (transactions.length === 0) {
        console.log("No transactions found");
        return;
      }

      // Display transactions
      transactions.forEach((tx, index) => {
        console.log(
          `${index + 1}. ${new Date(
            (tx.timestamp || 0) * 1000
          ).toLocaleString()}`
        );
        console.log(`   Type: ${tx.transactionType}`);
        console.log(`   Chain: ${tx.chainId}`);
        console.log(`   Hash: ${tx.txHash}`);
        console.log(`   Status: ${tx.successful ? "✅ Success" : "❌ Failed"}`);

        if (tx.inputTokenName && tx.inputAmount) {
          console.log(`   Input: ${tx.inputAmount} ${tx.inputTokenName}`);
        }
        if (tx.secondInputTokenName && tx.secondInputAmount) {
          console.log(
            `   Second Input: ${tx.secondInputAmount} ${tx.secondInputTokenName}`
          );
        }
        if (tx.outputTokenName && tx.outputAmount) {
          console.log(`   Output: ${tx.outputAmount} ${tx.outputTokenName}`);
        }
        if (tx.secondOutputTokenName && tx.secondOutputAmount) {
          console.log(
            `   Second Output: ${tx.secondOutputAmount} ${tx.secondOutputTokenName}`
          );
        }
        if (tx.gasFeeAmount && tx.gasFeeTokenName) {
          console.log(`   Gas: ${tx.gasFeeAmount} ${tx.gasFeeTokenName}`);
        }
        if (tx.destinationAddress) {
          console.log(`   Destination: ${tx.destinationAddress}`);
        }
        if (!tx.successful && tx.error) {
          console.log(`   Error: ${tx.error}`);
        }
        console.log();
      });

      if (options.csv) {
        console.log("\n📁 Exporting to CSV file...");
        const file = await dbQueryClient.exportTransactionsToCSV(
          limit,
          options.type as TransactionType,
          startDate,
          endDate
        );
        console.log(`\n✅ CSV file exported: ${file}`);
      }
    } catch (error: any) {
      console.error("\n❌ Error:", error?.message);
      process.exit(1);
    } finally {
      dbQueryClient?.close();
    }
  });

// Stats command - shows transaction statistics
program
  .command("stats")
  .description("Show transaction statistics")
  .option(
    "-e, --environment <env>",
    "Environment (mainnet or testnet)",
    "mainnet"
  )
  .option("--csv", "Export to CSV file in reports/ folder")
  .option("-s, --start <date>", "Start date (DD-MM-YYYY)")
  .option("-E, --end <date>", "End date (DD-MM-YYYY)")
  .action(async (options) => {
    let dbQueryClient: DatabaseQueryClient | undefined;

    try {
      console.log("📈 Transaction Statistics\n");

      const { startDate, endDate } = parseDateOptions(options);

      dbQueryClient = await DatabaseQueryClient.make({
        environment: options.environment,
      });

      if (startDate || endDate) {
        console.log(
          `📅 Date range: ${
            startDate ? startDate.toLocaleDateString() : "All"
          } to ${endDate ? endDate.toLocaleDateString() : "Now"}\n`
        );
      }

      const summary = await dbQueryClient.getTransactionTypeSummary(
        startDate,
        endDate
      );
      console.log(dbQueryClient.formatTransactionSummary(summary));

      // Also show account stats
      const accountStats = await dbQueryClient.getAccountStats(
        startDate,
        endDate
      );
      if (accountStats.length > 0) {
        console.log("\n📊 Detailed Statistics:");
        console.log("─".repeat(60));

        accountStats.forEach((stat: any) => {
          const typeFormatted = stat.transactionType
            .split("_")
            .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");

          console.log(`\n${typeFormatted}:`);
          console.log(`  Total: ${stat.count}`);
          console.log(`  Successful: ${stat.successfulCount}`);
          console.log(
            `  Success Rate: ${(stat.successRate * 100).toFixed(1)}%`
          );
          console.log(
            `  First: ${new Date(
              stat.firstTransaction * 1000
            ).toLocaleString()}`
          );
          console.log(
            `  Last: ${new Date(stat.lastTransaction * 1000).toLocaleString()}`
          );
        });
      }

      if (options.csv) {
        console.log("\n📁 Exporting to CSV files...");
        const summaryFile = await dbQueryClient.exportTransactionSummaryToCSV(
          startDate,
          endDate
        );
        const statsFile = await dbQueryClient.exportAccountStatsToCSV(
          startDate,
          endDate
        );
        console.log("\n✅ CSV files exported:");
        console.log(`   - ${summaryFile}`);
        console.log(`   - ${statsFile}`);
      }
    } catch (error: any) {
      console.error("\n❌ Error:", error?.message);
      process.exit(1);
    } finally {
      dbQueryClient?.close();
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
