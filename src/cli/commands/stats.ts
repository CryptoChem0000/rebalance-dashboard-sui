import { Command } from "commander";

import { formatDateRange, parseDateOptions, withDatabase } from "../helpers";

export function statsCommand(program: Command) {
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
      await withDatabase(options, async (db) => {
        console.log("📈 Transaction Statistics\n");

        const { startDate, endDate } = parseDateOptions(options);

        formatDateRange(startDate, endDate);

        const summary = await db.getTransactionTypeSummary(startDate, endDate);
        console.log(db.formatTransactionSummary(summary));

        // Also show account stats
        const accountStats = await db.getAccountStats(startDate, endDate);
        if (accountStats.length > 0) {
          displayDetailedStats(accountStats);
        }

        if (options.csv) {
          await exportStatsToCSV(db, startDate, endDate);
        }
      });
    });
}

function displayDetailedStats(accountStats: any[]) {
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
    console.log(`  Success Rate: ${(stat.successRate * 100).toFixed(1)}%`);
    console.log(
      `  First: ${new Date(stat.firstTransaction * 1000).toLocaleString()}`
    );
    console.log(
      `  Last: ${new Date(stat.lastTransaction * 1000).toLocaleString()}`
    );
  });
}

async function exportStatsToCSV(db: any, startDate?: Date, endDate?: Date) {
  console.log("\n📁 Exporting to CSV files...");
  const summaryFile = await db.exportTransactionSummaryToCSV(
    startDate,
    endDate
  );
  const statsFile = await db.exportAccountStatsToCSV(startDate, endDate);
  console.log("\n✅ CSV files exported:");
  console.log(`   - ${summaryFile}`);
  console.log(`   - ${statsFile}`);
}
