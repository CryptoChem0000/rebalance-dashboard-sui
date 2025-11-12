import { Command } from "commander";

import { TransactionType } from "../../database";
import {
  displayTransactionDetails,
  formatDateRange,
  getAddress,
  parseDateOptions,
  withDatabase,
} from "../helpers";

export function transactionsCommand(program: Command) {
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
      await withDatabase(options, async (db) => {
        const address = await getAddress();
        const { startDate, endDate } = parseDateOptions(options);
        const limit = parseInt(options.limit, 10);

        let transactions: any[];
        if (options.type) {
          console.log(`📄 Recent ${options.type} transactions:\n`);
          transactions = await db.getTransactionsByType(
            options.type as TransactionType,
            address,
            limit,
            startDate,
            endDate
          );
        } else {
          console.log(`📄 Recent transactions (limit: ${limit}):\n`);
          transactions = await db.getRecentTransactions(
            address,
            limit,
            0,
            startDate,
            endDate
          );
        }

        formatDateRange(startDate, endDate);

        if (transactions.length === 0) {
          console.log("No transactions found");
          return;
        }

        // Display transactions
        transactions.forEach((tx, index) =>
          displayTransactionDetails(tx, index)
        );

        if (options.csv) {
          console.log("\n📁 Exporting to CSV file...");
          const file = await db.exportTransactionsToCSV(
            address,
            limit,
            options.type as TransactionType,
            startDate,
            endDate
          );
          console.log(`\n✅ CSV file exported: ${file}`);
        }
      });
    });
}
