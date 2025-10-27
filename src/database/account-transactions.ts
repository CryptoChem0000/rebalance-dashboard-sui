import Database from "better-sqlite3";
import fs from "node:fs/promises";
import path from "path";

import { getWorkingDirectory } from "../utils";

import {
  AccountTransaction,
  TransactionRepository,
  TransactionType,
} from "./types";

export class SQLiteTransactionRepository implements TransactionRepository {
  private db: Database.Database;

  // Prepared statements for better performance
  private insertStmt!: Database.Statement<AccountTransaction>;
  private getByTxHashStmt!: Database.Statement<[string, string]>;
  private getByAccountStmt!: Database.Statement<[string, number, number]>;
  private getByTypeStmt!: Database.Statement<[string, string, number]>;

  constructor(filename: string, options?: Database.Options) {
    this.db = new Database(filename, options);
    this.initialize();
    this.prepareStatements();
  }

  static async make(
    filename?: string,
    options?: Database.Options
  ): Promise<SQLiteTransactionRepository> {
    const workingDir = await getWorkingDirectory();
    const databaseDir = path.join(workingDir, "database");

    // Create logs directory if it doesn't exist
    try {
      await fs.access(databaseDir);
    } catch {
      await fs.mkdir(databaseDir, { recursive: true });
    }

    const finalPath = path.join(
      databaseDir,
      `${filename}.db` || "account_transactions.db"
    );

    return new SQLiteTransactionRepository(finalPath, options);
  }

  private initialize() {
    // Set up SQLite for optimal performance
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");

    // Create table with standard SQL syntax
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS account_transactions (
        signer_address VARCHAR(42) NOT NULL,
        chain_id VARCHAR(42) NOT NULL,
        transaction_type VARCHAR(50) NOT NULL,
        input_amount VARCHAR(78),
        input_token_denom VARCHAR(100),
        input_token_name VARCHAR(42),
        second_input_amount VARCHAR(78),
        second_input_token_denom VARCHAR(100),
        second_input_token_name VARCHAR(42),
        output_amount VARCHAR(78),
        output_token_denom VARCHAR(100),
        output_token_name VARCHAR(42),
        second_output_amount VARCHAR(78),
        second_output_token_denom VARCHAR(100),
        second_output_token_name VARCHAR(42),
        gas_fee_amount VARCHAR(78),
        gas_fee_token_denom VARCHAR(100),
        gas_fee_token_name VARCHAR(42),
        destination_address VARCHAR(42),
        destination_chain_id VARCHAR(42),
        tx_hash VARCHAR(66) NOT NULL,
        tx_action_index INTEGER NOT NULL DEFAULT 0,
        successful BOOLEAN NOT NULL,
        error TEXT,
        timestamp BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
        
        PRIMARY KEY (chain_id, tx_hash, tx_action_index)
      )
    `);

    // Create indexes for common queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_signer_address_timestamp 
      ON account_transactions(signer_address, timestamp DESC);
      
      CREATE INDEX IF NOT EXISTS idx_transaction_type 
      ON account_transactions(signer_address, transaction_type, timestamp DESC);
      
      CREATE INDEX IF NOT EXISTS idx_destination_address 
      ON account_transactions(destination_address, timestamp DESC);
      
      CREATE INDEX IF NOT EXISTS idx_timestamp 
      ON account_transactions(timestamp DESC);
      
      CREATE INDEX IF NOT EXISTS idx_chain_id 
      ON account_transactions(chain_id, timestamp DESC);
      
      CREATE INDEX IF NOT EXISTS idx_chain_tx_hash 
      ON account_transactions(chain_id, tx_hash);
    `);
  }

  private prepareStatements() {
    // Insert statement using named parameters for clarity
    this.insertStmt = this.db.prepare(`
      INSERT INTO account_transactions (
        signer_address, chain_id, transaction_type,
        input_amount, input_token_denom, input_token_name,
        second_input_amount, second_input_token_denom, second_input_token_name,
        output_amount, output_token_denom, output_token_name,
        second_output_amount, second_output_token_denom, second_output_token_name,
        gas_fee_amount, gas_fee_token_denom, gas_fee_token_name,
        destination_address, destination_chain_id,
        tx_hash, tx_action_index,
        successful, error, timestamp
      ) VALUES (
        @signerAddress, @chainId, @transactionType,
        @inputAmount, @inputTokenDenom, @inputTokenName,
        @secondInputAmount, @secondInputTokenDenom, @secondInputTokenName,
        @outputAmount, @outputTokenDenom, @outputTokenName,
        @secondOutputAmount, @secondOutputTokenDenom, @secondOutputTokenName,
        @gasFeeAmount, @gasFeeTokenDenom, @gasFeeTokenName,
        @destinationAddress, @destinationChainId,
        @txHash, COALESCE(@txActionIndex, 0),
        @successful, @error, COALESCE(@timestamp, strftime('%s', 'now'))
      )
      ON CONFLICT(chain_id, tx_hash, tx_action_index) DO UPDATE SET
        signer_address = excluded.signer_address,
        transaction_type = excluded.transaction_type,
        input_amount = excluded.input_amount,
        input_token_denom = excluded.input_token_denom,
        input_token_name = excluded.input_token_name,
        second_input_amount = excluded.second_input_amount,
        second_input_token_denom = excluded.second_input_token_denom,
        second_input_token_name = excluded.second_input_token_name,
        output_amount = excluded.output_amount,
        output_token_denom = excluded.output_token_denom,
        output_token_name = excluded.output_token_name,
        second_output_amount = excluded.second_output_amount,
        second_output_token_denom = excluded.second_output_token_denom,
        second_output_token_name = excluded.second_output_token_name,
        gas_fee_amount = excluded.gas_fee_amount,
        gas_fee_token_denom = excluded.gas_fee_token_denom,
        gas_fee_token_name = excluded.gas_fee_token_name,
        destination_address = excluded.destination_address,
        destination_chain_id = excluded.destination_chain_id,
        successful = excluded.successful,
        error = excluded.error,
        timestamp = excluded.timestamp
    `);

    this.getByTxHashStmt = this.db.prepare(`
      SELECT * FROM account_transactions 
      WHERE tx_hash = ? AND chain_id = ?
      ORDER BY tx_action_index
    `);

    this.getByAccountStmt = this.db.prepare(`
      SELECT * FROM account_transactions 
      WHERE signer_address = ? 
      ORDER BY timestamp DESC, tx_action_index
      LIMIT ? OFFSET ?
    `);

    this.getByTypeStmt = this.db.prepare(`
      SELECT * FROM account_transactions 
      WHERE signer_address = ? AND transaction_type = ?
      ORDER BY timestamp DESC, tx_action_index
      LIMIT ?
    `);
  }

  // Helper to convert row to transaction
  private rowToTransaction(row: any): AccountTransaction | null {
    if (!row) return null;

    return {
      signerAddress: row.signer_address,
      chainId: row.chain_id,
      transactionType: row.transaction_type as TransactionType,
      inputAmount: row.input_amount,
      inputTokenDenom: row.input_token_denom,
      inputTokenName: row.input_token_name,
      secondInputAmount: row.second_input_amount,
      secondInputTokenDenom: row.second_input_token_denom,
      secondInputTokenName: row.second_input_token_name,
      outputAmount: row.output_amount,
      outputTokenDenom: row.output_token_denom,
      outputTokenName: row.output_token_name,
      secondOutputAmount: row.second_output_amount,
      secondOutputTokenDenom: row.second_output_token_denom,
      secondOutputTokenName: row.second_output_token_name,
      gasFeeAmount: row.gas_fee_amount,
      gasFeeTokenDenom: row.gas_fee_token_denom,
      gasFeeTokenName: row.gas_fee_token_name,
      destinationAddress: row.destination_address,
      destinationChainId: row.destination_chain_id,
      txHash: row.tx_hash,
      txActionIndex: row.tx_action_index,
      successful: Boolean(row.successful),
      error: row.error,
      timestamp: row.timestamp,
    };
  }

  // Helper to convert transaction to row parameters
  private transactionToParams(tx: AccountTransaction): any {
    return {
      signerAddress: tx.signerAddress,
      chainId: tx.chainId,
      transactionType: tx.transactionType,
      inputAmount: tx.inputAmount || null,
      inputTokenDenom: tx.inputTokenDenom || null,
      inputTokenName: tx.inputTokenName || null,
      secondInputAmount: tx.secondInputAmount || null,
      secondInputTokenDenom: tx.secondInputTokenDenom || null,
      secondInputTokenName: tx.secondInputTokenName || null,
      outputAmount: tx.outputAmount || null,
      outputTokenDenom: tx.outputTokenDenom || null,
      outputTokenName: tx.outputTokenName || null,
      secondOutputAmount: tx.secondOutputAmount || null,
      secondOutputTokenDenom: tx.secondOutputTokenDenom || null,
      secondOutputTokenName: tx.secondOutputTokenName || null,
      gasFeeAmount: tx.gasFeeAmount || null,
      gasFeeTokenDenom: tx.gasFeeTokenDenom || null,
      gasFeeTokenName: tx.gasFeeTokenName || null,
      destinationAddress: tx.destinationAddress || null,
      destinationChainId: tx.destinationChainId || null,
      txHash: tx.txHash,
      txActionIndex: tx.txActionIndex ?? 0,
      successful: tx.successful ? 1 : 0,
      error: tx.error || null,
      timestamp: tx.timestamp || null,
    };
  }

  addTransaction(tx: AccountTransaction): void {
    this.insertStmt.run(this.transactionToParams(tx));
  }

  addTransactionBatch(txs: AccountTransaction[]): void {
    const insert = this.db.transaction((transactions: AccountTransaction[]) => {
      for (const tx of transactions) {
        this.insertStmt.run(this.transactionToParams(tx));
      }
    });

    insert(txs);
  }

  getTransaction(txHash: string, chainId: string): AccountTransaction | null {
    const row = this.getByTxHashStmt.get(txHash, chainId);
    return this.rowToTransaction(row);
  }

  getTransactionEntries(txHash: string, chainId: string): AccountTransaction[] {
    const rows = this.getByTxHashStmt.all(txHash, chainId);
    return rows.map((row) => this.rowToTransaction(row)!);
  }

  getAccountTransactions(
    signerAddress: string,
    limit: number = 100,
    offset: number = 0
  ): AccountTransaction[] {
    const rows = this.getByAccountStmt.all(signerAddress, limit, offset);
    return rows.map((row) => this.rowToTransaction(row)!);
  }

  getTransactionsByType(
    signerAddress: string,
    transactionType: TransactionType,
    limit: number = 100
  ): AccountTransaction[] {
    const rows = this.getByTypeStmt.all(signerAddress, transactionType, limit);
    return rows.map((row) => this.rowToTransaction(row)!);
  }

  // Get transactions by multiple types
  getTransactionsByTypes(
    signerAddress: string,
    transactionTypes: TransactionType[],
    limit: number = 100
  ): AccountTransaction[] {
    const placeholders = transactionTypes.map(() => "?").join(",");
    const query = this.db.prepare(`
      SELECT * FROM account_transactions 
      WHERE signer_address = ? 
      AND transaction_type IN (${placeholders})
      ORDER BY timestamp DESC, tx_action_index
      LIMIT ?
    `);

    const rows = query.all(signerAddress, ...transactionTypes, limit);
    return rows.map((row) => this.rowToTransaction(row)!);
  }

  // Complex analytical query example
  getAccountStats(signerAddress: string): any {
    const query = this.db.prepare(`
      WITH account_summary AS (
        SELECT
          transaction_type,
          COUNT(*) as count,
          SUM(CASE WHEN successful = 1 THEN 1 ELSE 0 END) as successful_count,
          COUNT(DISTINCT destination_address) as unique_destinations,
          COUNT(DISTINCT chain_id) as chains_used,
          MIN(timestamp) as first_transaction,
          MAX(timestamp) as last_transaction
        FROM account_transactions
        WHERE signer_address = ?
        GROUP BY transaction_type
      )
      SELECT 
        transaction_type,
        count,
        successful_count,
        CAST(successful_count AS REAL) / count as success_rate,
        unique_destinations,
        chains_used,
        first_transaction,
        last_transaction
      FROM account_summary
      ORDER BY count DESC
    `);

    return query.all(signerAddress);
  }

  // Additional useful queries
  getTransactionVolume(
    signerAddress: string,
    startTime?: number,
    endTime?: number
  ): any {
    const query = this.db.prepare(`
      SELECT 
        DATE(timestamp, 'unixepoch') as date,
        COUNT(*) as transaction_count,
        SUM(CASE WHEN successful = 1 THEN 1 ELSE 0 END) as successful_count,
        COUNT(DISTINCT transaction_type) as unique_types,
        COUNT(DISTINCT chain_id) as chains_used
      FROM account_transactions
      WHERE signer_address = ?
        AND timestamp >= COALESCE(?, 0)
        AND timestamp <= COALESCE(?, strftime('%s', 'now'))
      GROUP BY DATE(timestamp, 'unixepoch')
      ORDER BY date DESC
    `);

    return query.all(signerAddress, startTime, endTime);
  }

  getFailedTransactions(
    signerAddress: string,
    limit: number = 50
  ): AccountTransaction[] {
    const query = this.db.prepare(`
      SELECT * FROM account_transactions
      WHERE signer_address = ? AND successful = 0
      ORDER BY timestamp DESC, tx_action_index
      LIMIT ?
    `);

    const rows = query.all(signerAddress, limit);
    return rows.map((row) => this.rowToTransaction(row)!);
  }

  // Cross-chain activity
  getCrossChainActivity(signerAddress: string): any {
    const query = this.db.prepare(`
      SELECT 
        chain_id as source_chain,
        destination_chain_id as dest_chain,
        COUNT(*) as transfer_count,
        COUNT(DISTINCT DATE(timestamp, 'unixepoch')) as active_days
      FROM account_transactions
      WHERE signer_address = ?
        AND destination_chain_id IS NOT NULL
        AND chain_id != destination_chain_id
      GROUP BY chain_id, destination_chain_id
      ORDER BY transfer_count DESC
    `);

    return query.all(signerAddress);
  }

  // Get summary by transaction type
  getTransactionTypeSummary(signerAddress: string): any {
    const query = this.db.prepare(`
      SELECT 
        transaction_type,
        COUNT(*) as total_count,
        SUM(CASE WHEN successful = 1 THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN successful = 0 THEN 1 ELSE 0 END) as failed_count,
        CAST(SUM(CASE WHEN successful = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as success_rate
      FROM account_transactions
      WHERE signer_address = ?
      GROUP BY transaction_type
      ORDER BY total_count DESC
    `);

    return query.all(signerAddress);
  }

  close(): void {
    this.db.close();
  }
}
