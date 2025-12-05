import Database from "better-sqlite3";
import fs from "node:fs/promises";
import path from "path";

import { getWorkingDirectory } from "../utils";

import {
  AccountTransaction,
  TransactionRepository,
  TransactionType,
  AccountStats,
  VolumeByToken,
  ProfitabilityByToken,
  TransactionTypeSummary,
  SignerAddresses,
} from "./types";

export class SQLiteTransactionRepository implements TransactionRepository {
  private db: Database.Database;

  // Prepared statements for better performance
  private insertStmt!: Database.Statement<AccountTransaction>;
  private getByTxHashStmt!: Database.Statement<[string, string]>;

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

    // Create database directory if it doesn't exist
    try {
      await fs.access(databaseDir);
    } catch {
      await fs.mkdir(databaseDir, { recursive: true });
    }

    const finalPath = path.join(
      databaseDir,
      filename ? `${filename}.db` : "account_transactions.db"
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
        position_id VARCHAR(255),
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
        platform_name VARCHAR(100),
        platform_fee_amount VARCHAR(78),
        platform_fee_token_denom VARCHAR(100),
        platform_fee_token_name VARCHAR(42),
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
      CREATE INDEX IF NOT EXISTS idx_transaction_type_timestamp 
      ON account_transactions(transaction_type, timestamp DESC);
      
      CREATE INDEX IF NOT EXISTS idx_timestamp 
      ON account_transactions(timestamp DESC);
      
      CREATE INDEX IF NOT EXISTS idx_chain_id 
      ON account_transactions(chain_id, timestamp DESC);
      
      CREATE INDEX IF NOT EXISTS idx_chain_tx_hash 
      ON account_transactions(chain_id, tx_hash);
      
      CREATE INDEX IF NOT EXISTS idx_token_names 
      ON account_transactions(input_token_name, output_token_name);
      
      CREATE INDEX IF NOT EXISTS idx_signer_address_timestamp
      ON account_transactions(signer_address, timestamp DESC);
      
      CREATE INDEX IF NOT EXISTS idx_platform_name_timestamp
      ON account_transactions(platform_name, timestamp DESC);
    `);
  }

  private prepareStatements() {
    // Insert statement using named parameters for clarity
    this.insertStmt = this.db.prepare(`
      INSERT INTO account_transactions (
        signer_address, chain_id, transaction_type, position_id,
        input_amount, input_token_denom, input_token_name,
        second_input_amount, second_input_token_denom, second_input_token_name,
        output_amount, output_token_denom, output_token_name,
        second_output_amount, second_output_token_denom, second_output_token_name,
        gas_fee_amount, gas_fee_token_denom, gas_fee_token_name,
        platform_name, platform_fee_amount, platform_fee_token_denom, platform_fee_token_name,
        destination_address, destination_chain_id,
        tx_hash, tx_action_index,
        successful, error, timestamp
      ) VALUES (
        @signerAddress, @chainId, @transactionType, @positionId,
        @inputAmount, @inputTokenDenom, @inputTokenName,
        @secondInputAmount, @secondInputTokenDenom, @secondInputTokenName,
        @outputAmount, @outputTokenDenom, @outputTokenName,
        @secondOutputAmount, @secondOutputTokenDenom, @secondOutputTokenName,
        @gasFeeAmount, @gasFeeTokenDenom, @gasFeeTokenName,
        @platformName, @platformFeeAmount, @platformFeeTokenDenom, @platformFeeTokenName,
        @destinationAddress, @destinationChainId,
        @txHash, COALESCE(@txActionIndex, 0),
        @successful, @error, COALESCE(@timestamp, strftime('%s', 'now'))
      )
      ON CONFLICT(chain_id, tx_hash, tx_action_index) DO UPDATE SET
        signer_address = excluded.signer_address,
        transaction_type = excluded.transaction_type,
        position_id = excluded.position_id,
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
        platform_name = excluded.platform_name,
        platform_fee_amount = excluded.platform_fee_amount,
        platform_fee_token_denom = excluded.platform_fee_token_denom,
        platform_fee_token_name = excluded.platform_fee_token_name,
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
  }

  // Helper to convert row to transaction
  private rowToTransaction(row: any): AccountTransaction | null {
    if (!row) return null;

    return {
      signerAddress: row.signer_address,
      chainId: row.chain_id,
      transactionType: row.transaction_type as TransactionType,
      positionId: row.position_id,
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
      platformName: row.platform_name,
      platformFeeAmount: row.platform_fee_amount,
      platformFeeTokenDenom: row.platform_fee_token_denom,
      platformFeeTokenName: row.platform_fee_token_name,
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
      positionId: tx.positionId || null,
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
      platformName: tx.platformName || null,
      platformFeeAmount: tx.platformFeeAmount || null,
      platformFeeTokenDenom: tx.platformFeeTokenDenom || null,
      platformFeeTokenName: tx.platformFeeTokenName || null,
      destinationAddress: tx.destinationAddress || null,
      destinationChainId: tx.destinationChainId || null,
      txHash: tx.txHash,
      txActionIndex: tx.txActionIndex ?? 0,
      successful: tx.successful ? 1 : 0,
      error: tx.error || null,
      timestamp: tx.timestamp || null,
    };
  }

  // Helper method to normalize signer addresses
  private normalizeAddresses(signerAddress: SignerAddresses): string[] {
    if (Array.isArray(signerAddress)) {
      return signerAddress;
    }
    return [signerAddress];
  }

  // Helper method to build filters with multi-address support
  private buildFilters(
    signerAddress?: SignerAddresses,
    startTime?: Date,
    endTime?: Date
  ): string {
    let filter = "";

    if (signerAddress !== undefined) {
      const addresses = this.normalizeAddresses(signerAddress);
      const addressList = addresses.map((addr) => `'${addr}'`).join(",");
      filter += ` AND signer_address IN (${addressList})`;
    }

    if (startTime !== undefined) {
      filter += ` AND timestamp >= ${Math.floor(startTime.getTime() / 1000)}`;
    }

    if (endTime !== undefined) {
      filter += ` AND timestamp <= ${Math.floor(endTime.getTime() / 1000)}`;
    }

    return filter;
  }

  // Helper to get the last transaction for profitability exclusion
  private getLastTransaction(
    signerAddress?: SignerAddresses,
    startTime?: Date,
    endTime?: Date
  ): AccountTransaction | null {
    const filters = this.buildFilters(signerAddress, startTime, endTime);

    const query = this.db.prepare(`
      SELECT tx_hash, tx_action_index, transaction_type
      FROM account_transactions
      WHERE 1=1 ${filters}
      ORDER BY timestamp DESC, tx_action_index DESC
      LIMIT 1
    `);

    const row = query.get();
    return this.rowToTransaction(row);
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
    signerAddress: SignerAddresses,
    limit: number = 100,
    offset: number = 0,
    startTime?: Date,
    endTime?: Date
  ): AccountTransaction[] {
    const filters = this.buildFilters(signerAddress, startTime, endTime);

    const query = this.db.prepare(`
      SELECT * FROM account_transactions 
      WHERE 1=1 ${filters}
      ORDER BY timestamp DESC, tx_action_index
      LIMIT ? OFFSET ?
    `);

    const rows = query.all(limit, offset);
    return rows.map((row) => this.rowToTransaction(row)!);
  }

  getTransactionsByType(
    transactionType: TransactionType,
    signerAddress?: SignerAddresses,
    limit: number = 100,
    startTime?: Date,
    endTime?: Date
  ): AccountTransaction[] {
    const filters = this.buildFilters(signerAddress, startTime, endTime);
    let typeFilter = "";

    if (transactionType) {
      typeFilter = ` AND transaction_type = '${transactionType}'`;
    }

    const query = this.db.prepare(`
      SELECT * FROM account_transactions 
      WHERE 1=1 ${typeFilter} ${filters}
      ORDER BY timestamp DESC, tx_action_index
      LIMIT ?
    `);

    const rows = query.all(limit);
    return rows.map((row) => this.rowToTransaction(row)!);
  }

  getAccountStats(
    signerAddress: SignerAddresses,
    startTime?: Date,
    endTime?: Date
  ): AccountStats[] {
    const filters = this.buildFilters(signerAddress, startTime, endTime);

    const query = this.db.prepare(`
      WITH account_summary AS (
        SELECT
          transaction_type,
          COUNT(*) as count,
          SUM(CASE WHEN successful = 1 THEN 1 ELSE 0 END) as successful_count,
          MIN(timestamp) as first_transaction,
          MAX(timestamp) as last_transaction
        FROM account_transactions
        WHERE 1=1 ${filters}
        GROUP BY transaction_type
      )
      SELECT 
        transaction_type as transactionType,
        count,
        successful_count as successfulCount,
        CAST(successful_count AS REAL) / count as successRate,
        first_transaction as firstTransaction,
        last_transaction as lastTransaction
      FROM account_summary
      ORDER BY count DESC
    `);

    return query.all() as AccountStats[];
  }

  getArchwayBoltVolume(
    signerAddress?: SignerAddresses,
    startTime?: Date,
    endTime?: Date
  ): VolumeByToken[] {
    const filters = this.buildFilters(signerAddress, startTime, endTime);

    const query = this.db.prepare(`
      WITH bolt_volumes AS (
        SELECT 
          token_name,
          SUM(amount) as total_volume
        FROM (
          -- Input amounts
          SELECT input_token_name as token_name, CAST(input_amount AS REAL) as amount
          FROM account_transactions
          WHERE transaction_type = 'bolt_archway_swap' 
            AND successful = 1
            AND input_amount IS NOT NULL 
            AND input_token_name IS NOT NULL
            ${filters}
          
          UNION ALL
          
          -- Second input amounts
          SELECT second_input_token_name as token_name, CAST(second_input_amount AS REAL) as amount
          FROM account_transactions
          WHERE transaction_type = 'bolt_archway_swap' 
            AND successful = 1
            AND second_input_amount IS NOT NULL 
            AND second_input_token_name IS NOT NULL
            ${filters}
          
          UNION ALL
          
          -- Output amounts
          SELECT output_token_name as token_name, CAST(output_amount AS REAL) as amount
          FROM account_transactions
          WHERE transaction_type = 'bolt_archway_swap' 
            AND successful = 1
            AND output_amount IS NOT NULL 
            AND output_token_name IS NOT NULL
            ${filters}
          
          UNION ALL
          
          -- Second output amounts
          SELECT second_output_token_name as token_name, CAST(second_output_amount AS REAL) as amount
          FROM account_transactions
          WHERE transaction_type = 'bolt_archway_swap' 
            AND successful = 1
            AND second_output_amount IS NOT NULL 
            AND second_output_token_name IS NOT NULL
            ${filters}
        ) AS all_amounts
        GROUP BY token_name
      )
      SELECT 
        token_name as tokenName,
        total_volume as totalVolume,
        (SELECT COUNT(DISTINCT tx_hash) FROM account_transactions WHERE transaction_type = 'bolt_archway_swap' AND successful = 1 ${filters}) as totalSwaps
      FROM bolt_volumes
      ORDER BY total_volume DESC
    `);

    return query.all() as VolumeByToken[];
  }

  getOsmosisVolume(
    signerAddress?: SignerAddresses,
    startTime?: Date,
    endTime?: Date
  ): VolumeByToken[] {
    const filters = this.buildFilters(signerAddress, startTime, endTime);

    const query = this.db.prepare(`
      WITH osmosis_volumes AS (
        SELECT 
          token_name,
          SUM(amount) as total_volume
        FROM (
          -- Input amounts
          SELECT input_token_name as token_name, CAST(input_amount AS REAL) as amount
          FROM account_transactions
          WHERE transaction_type IN ('create_position', 'withdraw_position')
            AND successful = 1
            AND input_amount IS NOT NULL 
            AND input_token_name IS NOT NULL
            ${filters}
          
          UNION ALL
          
          -- Second input amounts
          SELECT second_input_token_name as token_name, CAST(second_input_amount AS REAL) as amount
          FROM account_transactions
          WHERE transaction_type IN ('create_position', 'withdraw_position')
            AND successful = 1
            AND second_input_amount IS NOT NULL 
            AND second_input_token_name IS NOT NULL
            ${filters}
          
          UNION ALL
          
          -- Output amounts
          SELECT output_token_name as token_name, CAST(output_amount AS REAL) as amount
          FROM account_transactions
          WHERE transaction_type IN ('create_position', 'withdraw_position')
            AND successful = 1
            AND output_amount IS NOT NULL 
            AND output_token_name IS NOT NULL
            ${filters}
          
          UNION ALL
          
          -- Second output amounts
          SELECT second_output_token_name as token_name, CAST(second_output_amount AS REAL) as amount
          FROM account_transactions
          WHERE transaction_type IN ('create_position', 'withdraw_position')
            AND successful = 1
            AND second_output_amount IS NOT NULL 
            AND second_output_token_name IS NOT NULL
            ${filters}
        ) AS all_amounts
        GROUP BY token_name
      )
      SELECT 
        token_name as tokenName,
        total_volume as totalVolume,
        (SELECT COUNT(DISTINCT tx_hash) FROM account_transactions WHERE transaction_type IN ('create_position', 'withdraw_position') AND successful = 1 ${filters}) as totalOperations
      FROM osmosis_volumes
      ORDER BY total_volume DESC
    `);

    return query.all() as VolumeByToken[];
  }

  getBridgeVolume(
    signerAddress?: SignerAddresses,
    startTime?: Date,
    endTime?: Date
  ): VolumeByToken[] {
    const filters = this.buildFilters(signerAddress, startTime, endTime);

    const query = this.db.prepare(`
      WITH bridge_volumes AS (
        SELECT 
          token_name,
          SUM(amount) as total_volume
        FROM (
          -- Input amounts (sending)
          SELECT input_token_name as token_name, CAST(input_amount AS REAL) as amount
          FROM account_transactions
          WHERE transaction_type = 'ibc_transfer'
            AND successful = 1
            AND input_amount IS NOT NULL 
            AND input_token_name IS NOT NULL
            ${filters}
          
          UNION ALL
          
          -- Output amounts (receiving)
          SELECT output_token_name as token_name, CAST(output_amount AS REAL) as amount
          FROM account_transactions
          WHERE transaction_type = 'ibc_transfer'
            AND successful = 1
            AND output_amount IS NOT NULL 
            AND output_token_name IS NOT NULL
            ${filters}
        ) AS all_amounts
        GROUP BY token_name
      )
      SELECT 
        token_name as tokenName,
        total_volume as totalVolume,
        (SELECT COUNT(DISTINCT tx_hash) FROM account_transactions WHERE transaction_type = 'ibc_transfer' AND successful = 1 ${filters}) as totalTransfers
      FROM bridge_volumes
      ORDER BY total_volume DESC
    `);

    return query.all() as VolumeByToken[];
  }

  getProfitability(
    signerAddress?: SignerAddresses,
    startTime?: Date,
    endTime?: Date
  ): ProfitabilityByToken[] {
    const filters = this.buildFilters(signerAddress, startTime, endTime);

    // Get last transaction if needed
    const lastTx = this.getLastTransaction(signerAddress, startTime, endTime);

    // Build exclusion filter
    let excludeFilter = "";
    if (lastTx && lastTx.transactionType === "create_position") {
      excludeFilter = ` AND NOT (tx_hash = '${lastTx.txHash}' AND tx_action_index = ${lastTx.txActionIndex})`;
    }

    const query = this.db.prepare(`
      WITH token_flows AS (
        -- All payments (negative values)
        SELECT 
          token_name,
          -SUM(amount) as net_amount,
          'payment' as flow_type
        FROM (
          -- Input amounts
          SELECT input_token_name as token_name, CAST(input_amount AS REAL) as amount
          FROM account_transactions
          WHERE successful = 1
            AND input_amount IS NOT NULL 
            AND input_token_name IS NOT NULL
            ${filters}
            ${excludeFilter}
          
          UNION ALL
          
          -- Second input amounts
          SELECT second_input_token_name as token_name, CAST(second_input_amount AS REAL) as amount
          FROM account_transactions
          WHERE successful = 1
            AND second_input_amount IS NOT NULL 
            AND second_input_token_name IS NOT NULL
            ${filters}
            ${excludeFilter}
          
          UNION ALL
          
          -- Gas fees
          SELECT gas_fee_token_name as token_name, CAST(gas_fee_amount AS REAL) as amount
          FROM account_transactions
          WHERE successful = 1
            AND gas_fee_amount IS NOT NULL 
            AND gas_fee_token_name IS NOT NULL
            ${filters}
            ${excludeFilter}
        ) AS payments
        GROUP BY token_name
        
        UNION ALL
        
        -- All receipts (positive values)
        SELECT 
          token_name,
          SUM(amount) as net_amount,
          'receipt' as flow_type
        FROM (
          -- Output amounts
          SELECT output_token_name as token_name, CAST(output_amount AS REAL) as amount
          FROM account_transactions
          WHERE successful = 1
            AND output_amount IS NOT NULL 
            AND output_token_name IS NOT NULL
            ${filters}
            ${excludeFilter}
          
          UNION ALL
          
          -- Second output amounts
          SELECT second_output_token_name as token_name, CAST(second_output_amount AS REAL) as amount
          FROM account_transactions
          WHERE successful = 1
            AND second_output_amount IS NOT NULL 
            AND second_output_token_name IS NOT NULL
            ${filters}
            ${excludeFilter}
        ) AS receipts
        GROUP BY token_name
      ),
      token_summary AS (
        SELECT 
          token_name,
          SUM(net_amount) as net_balance,
          SUM(CASE WHEN flow_type = 'payment' THEN -net_amount ELSE 0 END) as total_sent,
          SUM(CASE WHEN flow_type = 'receipt' THEN net_amount ELSE 0 END) as total_received
        FROM token_flows
        GROUP BY token_name
      )
      SELECT 
        token_name as tokenName,
        total_sent as totalSent,
        total_received as totalReceived,
        net_balance as netBalance,
        CASE 
          WHEN total_sent > 0 THEN (net_balance / total_sent) * 100
          ELSE NULL
        END as roiPercentage
      FROM token_summary
      ORDER BY net_balance DESC
    `);

    return query.all() as ProfitabilityByToken[];
  }

  getTransactionTypeSummary(
    signerAddress?: SignerAddresses,
    startTime?: Date,
    endTime?: Date
  ): TransactionTypeSummary[] {
    const filters = this.buildFilters(signerAddress, startTime, endTime);

    const query = this.db.prepare(`
      SELECT 
        transaction_type as transactionType,
        COUNT(*) as totalCount,
        SUM(CASE WHEN successful = 1 THEN 1 ELSE 0 END) as successCount,
        SUM(CASE WHEN successful = 0 THEN 1 ELSE 0 END) as failedCount,
        CAST(SUM(CASE WHEN successful = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as successRate
      FROM account_transactions
      WHERE 1=1 ${filters}
      GROUP BY transaction_type
      ORDER BY totalCount DESC
    `);

    return query.all() as TransactionTypeSummary[];
  }

  close(): void {
    this.db.close();
  }
}
