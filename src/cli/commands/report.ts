import { Command } from "commander";

import { parseDateOptions, withDatabase } from "../helpers";

export function reportCommand(program: Command) {
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
      await withDatabase(options, async (db) => {
        console.log("📊 Generating database report...\n");

        const { startDate, endDate } = parseDateOptions(options);
        const report = await db.getFullReport(startDate, endDate);
        console.log(report);

        if (options.csv) {
          console.log("\n📁 Exporting to CSV files...");
          const files = await db.exportFullReportToCSV(startDate, endDate);
          console.log("\n✅ CSV files exported:");
          files.forEach((file) => console.log(`   - ${file}`));
        }
      });
    });
}
