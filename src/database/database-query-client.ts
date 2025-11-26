import path from "node:path";
import { access, mkdir, writeFile } from "node:fs/promises";

import { PostgresTransactionRepository } from "./postgres-transaction-repository";
import { DEFAULT_KEY_NAME, KeyManager, KeyStoreType } from "../key-manager";
import { findOsmosisChainInfo, findArchwayChainInfo } from "../registry";
import { getSignerAddress, getWorkingDirectory } from "../utils";

import type {
  AccountStats,
  AccountTransaction,
  DatabaseQueriesConfig,
  MakeDatabaseQueriesParams,
  ProfitabilityByToken,
  TransactionRepository,
  TransactionType,
  TransactionTypeSummary,
  VolumeByToken,
  SignerAddresses,
} from "./types";
import { SQLiteTransactionRepository } from "./sqlite-transaction-repository";

export class DatabaseQueryClient {
  private database: TransactionRepository;
  private addresses: string[];

  constructor(params: DatabaseQueriesConfig) {
    this.database = params.database;
    this.addresses = params.addresses;
  }

  static async make(
    params: MakeDatabaseQueriesParams
  ): Promise<DatabaseQueryClient> {
    const keyStore = await KeyManager.create({
      type: KeyStoreType.ENV_VARIABLE,
    });

    const addresses: string[] = [];

    if (params.chain === "osmosis") {
      // Get the Osmosis address
      const osmosisSigner = await keyStore.getCosmWasmSigner(
        DEFAULT_KEY_NAME,
        findOsmosisChainInfo(params.environment).prefix
      );
      const osmosisAddress = await getSignerAddress(osmosisSigner);
      addresses.push(osmosisAddress);

      // Get the Archway address
      const archwaySigner = await keyStore.getCosmWasmSigner(
        DEFAULT_KEY_NAME,
        findArchwayChainInfo(params.environment).prefix
      );
      const archwayAddress = await getSignerAddress(archwaySigner);
      addresses.push(archwayAddress);
    } else if (params.chain === "sui") {
      const suiSigner = await keyStore.getSuiSigner(DEFAULT_KEY_NAME);
      const suiAddress = await getSignerAddress(suiSigner);
      addresses.push(suiAddress);
    }

    const database = await (process.env.DATABASE_URL
      ? PostgresTransactionRepository.make()
      : SQLiteTransactionRepository.make(addresses[0]));

    return new DatabaseQueryClient({
      database,
      addresses,
    });
  }

  // Get recent transactions
  async getRecentTransactions(
    signerAddress?: SignerAddresses,
    limit: number = 100,
    offset: number = 0,
    startTime?: Date,
    endTime?: Date
  ): Promise<AccountTransaction[]> {
    return this.database.getAccountTransactions(
      signerAddress ?? this.addresses,
      limit,
      offset,
      startTime,
      endTime
    );
  }

  // Get transactions by type
  async getTransactionsByType(
    transactionType: TransactionType,
    signerAddress?: SignerAddresses,
    limit: number = 100,
    startTime?: Date,
    endTime?: Date
  ): Promise<AccountTransaction[]> {
    return this.database.getTransactionsByType(
      transactionType,
      signerAddress ?? this.addresses,
      limit,
      startTime,
      endTime
    );
  }

  // Get account statistics
  async getAccountStats(
    signerAddress?: SignerAddresses,
    startTime?: Date,
    endTime?: Date
  ): Promise<AccountStats[]> {
    return this.database.getAccountStats(
      signerAddress ?? this.addresses,
      startTime,
      endTime
    );
  }

  // Get Archway Bolt volume
  async getArchwayBoltVolume(
    signerAddress?: SignerAddresses,
    startTime?: Date,
    endTime?: Date
  ): Promise<VolumeByToken[]> {
    return this.database.getArchwayBoltVolume(
      signerAddress ?? this.addresses,
      startTime,
      endTime
    );
  }

  // Get Osmosis volume
  async getOsmosisVolume(
    signerAddress?: SignerAddresses,
    startTime?: Date,
    endTime?: Date
  ): Promise<VolumeByToken[]> {
    return this.database.getOsmosisVolume(
      signerAddress ?? this.addresses,
      startTime,
      endTime
    );
  }

  // Get bridge volume
  async getBridgeVolume(
    signerAddress?: SignerAddresses,
    startTime?: Date,
    endTime?: Date
  ): Promise<VolumeByToken[]> {
    return this.database.getBridgeVolume(
      signerAddress ?? this.addresses,
      startTime,
      endTime
    );
  }

  // Get profitability with optional exclusion of last create_position
  async getProfitability(
    signerAddress?: SignerAddresses,
    startTime?: Date,
    endTime?: Date
  ): Promise<ProfitabilityByToken[]> {
    return this.database.getProfitability(
      signerAddress ?? this.addresses,
      startTime,
      endTime
    );
  }

  // Get transaction type summary
  async getTransactionTypeSummary(
    signerAddress?: SignerAddresses,
    startTime?: Date,
    endTime?: Date
  ): Promise<TransactionTypeSummary[]> {
    return this.database.getTransactionTypeSummary(
      signerAddress ?? this.addresses,
      startTime,
      endTime
    );
  }

  // Format volume data for display
  formatVolumeData(volumeData: VolumeByToken[]): string {
    if (volumeData.length === 0) {
      return "No volume data available";
    }

    let output = "";
    volumeData.forEach((item) => {
      output += `${item.tokenName}: ${item.totalVolume.toLocaleString(
        undefined,
        {
          minimumFractionDigits: 2,
          maximumFractionDigits: 6,
        }
      )}`;
      if (item.totalSwaps !== undefined) {
        output += ` (${item.totalSwaps} swaps)`;
      } else if (item.totalOperations !== undefined) {
        output += ` (${item.totalOperations} operations)`;
      } else if (item.totalTransfers !== undefined) {
        output += ` (${item.totalTransfers} transfers)`;
      }
      output += "\n";
    });

    return output.trim();
  }

  // Format profitability data for display
  formatProfitabilityData(profitData: ProfitabilityByToken[]): string {
    if (profitData.length === 0) {
      return "No profitability data available";
    }

    let output = "Token Profitability:\n";
    output += "─".repeat(60) + "\n";

    profitData.forEach((item) => {
      output += `${item.tokenName}:\n`;
      output += `  Spent: ${item.totalSent.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      })}\n`;
      output += `  Received: ${item.totalReceived.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      })}\n`;
      output += `  Net: ${
        item.netBalance > 0 ? "+" : ""
      }${item.netBalance.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      })}`;
      if (item.roiPercentage !== null) {
        output += ` (${
          item.roiPercentage > 0 ? "+" : ""
        }${item.roiPercentage.toFixed(2)}% ROI)`;
      }
      output += "\n\n";
    });

    return output.trim();
  }

  // Format transaction summary for display
  formatTransactionSummary(summary: TransactionTypeSummary[]): string {
    if (summary.length === 0) {
      return "No transaction data available";
    }

    let output = "Transaction Summary:\n";
    output += "─".repeat(60) + "\n";

    summary.forEach((item) => {
      const typeFormatted = item.transactionType
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");

      output += `${typeFormatted}:\n`;
      output += `  Total: ${item.totalCount}\n`;
      output += `  Success: ${item.successCount} (${(
        item.successRate * 100
      ).toFixed(1)}%)\n`;
      if (item.failedCount > 0) {
        output += `  Failed: ${item.failedCount}\n`;
      }
      output += "\n";
    });

    return output.trim();
  }

  // Get all statistics in a formatted report
  async getFullReport(
    signerAddress?: SignerAddresses,
    startTime?: Date,
    endTime?: Date
  ): Promise<string> {
    const addresses = signerAddress ?? this.addresses;
    const [
      accountStats,
      archwayVolume,
      osmosisVolume,
      bridgeVolume,
      profitability,
      transactionSummary,
    ] = await Promise.all([
      this.getAccountStats(addresses, startTime, endTime),
      this.getArchwayBoltVolume(addresses, startTime, endTime),
      this.getOsmosisVolume(addresses, startTime, endTime),
      this.getBridgeVolume(addresses, startTime, endTime),
      this.getProfitability(addresses, startTime, endTime),
      this.getTransactionTypeSummary(addresses, startTime, endTime),
    ]);

    let report = "📊 Account Activity Report\n";
    report += "═".repeat(60) + "\n\n";

    // Show which addresses are included
    if (Array.isArray(addresses)) {
      report += "📍 Addresses:\n";
      addresses.forEach((addr) => {
        report += `  • ${addr}\n`;
      });
      report += "\n";
    } else {
      report += `📍 Address: ${addresses}\n\n`;
    }

    // Add date range if provided
    if (startTime || endTime) {
      report += "📅 Date Range: ";
      if (startTime) {
        report += `From ${startTime.toLocaleDateString()}`;
      }
      if (startTime && endTime) {
        report += " ";
      }
      if (endTime) {
        report += `To ${endTime.toLocaleDateString()}`;
      }
      report += "\n\n";
    }

    // Transaction Summary
    report +=
      "📝 " + this.formatTransactionSummary(transactionSummary) + "\n\n";

    // Volume Data
    if (archwayVolume.length > 0) {
      report += "🔄 Archway Bolt Volume:\n";
      report += "─".repeat(60) + "\n";
      report += this.formatVolumeData(archwayVolume) + "\n\n";
    }

    if (osmosisVolume.length > 0) {
      report += "🌊 Osmosis Volume:\n";
      report += "─".repeat(60) + "\n";
      report += this.formatVolumeData(osmosisVolume) + "\n\n";
    }

    if (bridgeVolume.length > 0) {
      report += "🌉 Bridge Volume:\n";
      report += "─".repeat(60) + "\n";
      report += this.formatVolumeData(bridgeVolume) + "\n\n";
    }

    // Profitability
    report += "💰 " + this.formatProfitabilityData(profitability);
    report +=
      "\n(Note: Excludes last create_position transaction if applicable)\n\n";

    // Time range
    if (accountStats.length > 0) {
      const firstTx = Math.min(...accountStats.map((s) => s.firstTransaction));
      const lastTx = Math.max(...accountStats.map((s) => s.lastTransaction));

      report += "📅 Transaction Time Range:\n";
      report += "─".repeat(60) + "\n";
      report += `First Transaction: ${new Date(
        firstTx * 1000
      ).toLocaleString()}\n`;
      report += `Last Transaction: ${new Date(
        lastTx * 1000
      ).toLocaleString()}\n`;
    }

    return report;
  }

  // Close the database connection
  close(): void {
    this.database.close();
  }

  // CSV Export Methods
  private async ensureReportsDirectory(): Promise<string> {
    const workingDir = await getWorkingDirectory();
    const reportsDir = path.join(workingDir, "reports");

    try {
      await access(reportsDir);
    } catch {
      await mkdir(reportsDir, { recursive: true });
    }

    return reportsDir;
  }

  private generateReportFilename(
    reportType: string,
    startTime?: Date,
    endTime?: Date,
    signerAddress?: SignerAddresses
  ): string {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, -5);
    const finalAddresses = signerAddress ?? this.addresses;

    let addressPart = "";
    if (finalAddresses) {
      if (Array.isArray(finalAddresses)) {
        addressPart = finalAddresses.join("_");
      } else {
        addressPart = finalAddresses;
      }
    }

    let filename = `${addressPart}_${reportType}`;

    if (startTime || endTime) {
      if (startTime) {
        filename += `_from_${startTime.toISOString().split("T")[0]}`;
      }
      if (endTime) {
        filename += `_to_${endTime.toISOString().split("T")[0]}`;
      }
    }

    filename += `_${timestamp}.csv`;
    return filename;
  }

  // Export volume data to CSV
  async exportVolumeToCSV(
    volumeType: "archway" | "osmosis" | "bridge" | "all",
    signerAddress?: SignerAddresses,
    startTime?: Date,
    endTime?: Date
  ): Promise<string[]> {
    const reportsDir = await this.ensureReportsDirectory();
    const exportedFiles: string[] = [];
    const finalAddresses = signerAddress ?? this.addresses;

    if (volumeType === "all" || volumeType === "archway") {
      const archwayVolume = await this.getArchwayBoltVolume(
        finalAddresses,
        startTime,
        endTime
      );
      const filename = this.generateReportFilename(
        "archway_volume",
        startTime,
        endTime,
        finalAddresses
      );
      const filepath = path.join(reportsDir, filename);

      let csv = "Token Name,Total Volume,Total Swaps\n";
      archwayVolume.forEach((item) => {
        csv += `"${item.tokenName}",${item.totalVolume},${
          item.totalSwaps || 0
        }\n`;
      });

      await writeFile(filepath, csv, "utf-8");
      exportedFiles.push(filepath);
    }

    if (volumeType === "all" || volumeType === "osmosis") {
      const osmosisVolume = await this.getOsmosisVolume(
        finalAddresses,
        startTime,
        endTime
      );
      const filename = this.generateReportFilename(
        "osmosis_volume",
        startTime,
        endTime,
        finalAddresses
      );
      const filepath = path.join(reportsDir, filename);

      let csv = "Token Name,Total Volume,Total Operations\n";
      osmosisVolume.forEach((item) => {
        csv += `"${item.tokenName}",${item.totalVolume},${
          item.totalOperations || 0
        }\n`;
      });

      await writeFile(filepath, csv, "utf-8");
      exportedFiles.push(filepath);
    }

    if (volumeType === "all" || volumeType === "bridge") {
      const bridgeVolume = await this.getBridgeVolume(
        finalAddresses,
        startTime,
        endTime
      );
      const filename = this.generateReportFilename(
        "bridge_volume",
        startTime,
        endTime,
        finalAddresses
      );
      const filepath = path.join(reportsDir, filename);

      let csv = "Token Name,Total Volume,Total Transfers\n";
      bridgeVolume.forEach((item) => {
        csv += `"${item.tokenName}",${item.totalVolume},${
          item.totalTransfers || 0
        }\n`;
      });

      await writeFile(filepath, csv, "utf-8");
      exportedFiles.push(filepath);
    }

    return exportedFiles;
  }

  // Export profitability to CSV
  async exportProfitabilityToCSV(
    signerAddress?: SignerAddresses,
    startTime?: Date,
    endTime?: Date
  ): Promise<string> {
    const reportsDir = await this.ensureReportsDirectory();
    const finalAddresses = signerAddress ?? this.addresses;
    const profitability = await this.getProfitability(
      finalAddresses,
      startTime,
      endTime
    );
    const filename = this.generateReportFilename(
      "profitability",
      startTime,
      endTime,
      finalAddresses
    );
    const filepath = path.join(reportsDir, filename);

    let csv = "Token Name,Total Sent,Total Received,Net Balance,ROI %\n";
    profitability.forEach((item) => {
      csv += `"${item.tokenName}",${item.totalSent},${item.totalReceived},${
        item.netBalance
      },${item.roiPercentage || ""}\n`;
    });

    await writeFile(filepath, csv, "utf-8");
    return filepath;
  }

  // Export transactions to CSV
  async exportTransactionsToCSV(
    signerAddress?: SignerAddresses,
    limit: number = 1000,
    transactionType?: TransactionType,
    startTime?: Date,
    endTime?: Date
  ): Promise<string> {
    const reportsDir = await this.ensureReportsDirectory();
    const finalAddresses = signerAddress ?? this.addresses;

    let transactions: AccountTransaction[];
    let reportType: string;

    if (transactionType) {
      transactions = await this.getTransactionsByType(
        transactionType,
        finalAddresses,
        limit,
        startTime,
        endTime
      );
      reportType = `transactions_${transactionType}`;
    } else {
      transactions = await this.getRecentTransactions(
        finalAddresses,
        limit,
        0,
        startTime,
        endTime
      );
      reportType = "transactions_all";
    }

    const filename = this.generateReportFilename(
      reportType,
      startTime,
      endTime,
      finalAddresses
    );
    const filepath = path.join(reportsDir, filename);

    let csv = "Timestamp,Transaction Type,Chain ID,Transaction Hash,Status,";
    csv +=
      "Signer Address,Input Amount,Input Token,Second Input Amount,Second Input Token,";
    csv +=
      "Output Amount,Output Token,Second Output Amount,Second Output Token,";
    csv +=
      "Gas Fee Amount,Gas Fee Token,Destination Address,Destination Chain,Error\n";

    transactions.forEach((tx) => {
      const timestamp = new Date((tx.timestamp || 0) * 1000).toISOString();
      const status = tx.successful ? "Success" : "Failed";

      csv += `"${timestamp}","${tx.transactionType}","${tx.chainId}","${tx.txHash}","${status}",`;
      csv += `"${tx.signerAddress}","${tx.inputAmount || ""}","${
        tx.inputTokenName || ""
      }","${tx.secondInputAmount || ""}","${tx.secondInputTokenName || ""}",`;
      csv += `"${tx.outputAmount || ""}","${tx.outputTokenName || ""}","${
        tx.secondOutputAmount || ""
      }","${tx.secondOutputTokenName || ""}",`;
      csv += `"${tx.gasFeeAmount || ""}","${tx.gasFeeTokenName || ""}","${
        tx.destinationAddress || ""
      }","${tx.destinationChainId || ""}","${tx.error || ""}"\n`;
    });

    await writeFile(filepath, csv, "utf-8");
    return filepath;
  }

  // Export transaction summary to CSV
  async exportTransactionSummaryToCSV(
    signerAddress?: SignerAddresses,
    startTime?: Date,
    endTime?: Date
  ): Promise<string> {
    const reportsDir = await this.ensureReportsDirectory();
    const finalAddresses = signerAddress ?? this.addresses;
    const summary = await this.getTransactionTypeSummary(
      finalAddresses,
      startTime,
      endTime
    );
    const filename = this.generateReportFilename(
      "transaction_summary",
      startTime,
      endTime,
      finalAddresses
    );
    const filepath = path.join(reportsDir, filename);

    let csv =
      "Transaction Type,Total Count,Success Count,Failed Count,Success Rate %\n";
    summary.forEach((item) => {
      if (!item.transactionType) return;
      csv += `"${item.transactionType}",${item.totalCount},${
        item.successCount
      },${item.failedCount},${(item.successRate * 100).toFixed(2)}\n`;
    });

    await writeFile(filepath, csv, "utf-8");
    return filepath;
  }

  // Export complete report to multiple CSV files
  async exportFullReportToCSV(
    signerAddress?: SignerAddresses,
    startTime?: Date,
    endTime?: Date
  ): Promise<string[]> {
    const exportedFiles: string[] = [];
    const finalAddresses = signerAddress ?? this.addresses;

    // Export all volume data
    const volumeFiles = await this.exportVolumeToCSV(
      "all",
      finalAddresses,
      startTime,
      endTime
    );
    exportedFiles.push(...volumeFiles);

    // Export profitability
    const profitFile = await this.exportProfitabilityToCSV(
      finalAddresses,
      startTime,
      endTime
    );
    exportedFiles.push(profitFile);

    // Export transaction summary
    const summaryFile = await this.exportTransactionSummaryToCSV(
      finalAddresses,
      startTime,
      endTime
    );
    exportedFiles.push(summaryFile);

    // Export recent transactions (last 1000)
    const txFile = await this.exportTransactionsToCSV(
      finalAddresses,
      1000,
      undefined,
      startTime,
      endTime
    );
    exportedFiles.push(txFile);

    // Export account stats
    const statsFile = await this.exportAccountStatsToCSV(
      finalAddresses,
      startTime,
      endTime
    );
    exportedFiles.push(statsFile);

    return exportedFiles;
  }

  // Export account stats to CSV
  async exportAccountStatsToCSV(
    signerAddress?: SignerAddresses,
    startTime?: Date,
    endTime?: Date
  ): Promise<string> {
    const reportsDir = await this.ensureReportsDirectory();
    const finalAddresses = signerAddress ?? this.addresses;
    const stats = await this.getAccountStats(
      finalAddresses,
      startTime,
      endTime
    );
    const filename = this.generateReportFilename(
      "account_stats",
      startTime,
      endTime,
      finalAddresses
    );
    const filepath = path.join(reportsDir, filename);

    let csv =
      "Transaction Type,Count,Successful Count,Success Rate,First Transaction,Last Transaction\n";
    stats.forEach((item) => {
      const firstTx = new Date(item.firstTransaction * 1000).toISOString();
      const lastTx = new Date(item.lastTransaction * 1000).toISOString();
      csv += `"${item.transactionType}",${item.count},${
        item.successfulCount
      },${item.successRate.toFixed(2)},"${firstTx}","${lastTx}"\n`;
    });

    await writeFile(filepath, csv, "utf-8");
    return filepath;
  }
}
