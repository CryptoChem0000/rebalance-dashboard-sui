import { Command } from "commander";

import { formatDateRange, parseDateOptions, withDatabase } from "../helpers";

export function profitCommand(program: Command) {
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
      await withDatabase(options, async (db) => {
        console.log("💰 Calculating profitability...\n");

        const { startDate, endDate } = parseDateOptions(options);

        formatDateRange(startDate, endDate);

        const profitability = await db.getProfitability(startDate, endDate);
        console.log(db.formatProfitabilityData(profitability));

        if (options.csv) {
          console.log("\n📁 Exporting to CSV file...");
          const file = await db.exportProfitabilityToCSV(startDate, endDate);
          console.log(`\n✅ CSV file exported: ${file}`);
        }
      });
    });
}
