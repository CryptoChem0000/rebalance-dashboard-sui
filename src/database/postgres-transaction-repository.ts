import { PrismaClient, Prisma } from "@prisma/client";

import {
  AccountTransaction,
  TransactionRepository,
  TransactionType,
  AccountStats,
  VolumeByToken,
  ProfitabilityByToken,
  TransactionTypeSummary,
} from "./types";

export class PostgresTransactionRepository implements TransactionRepository {
  private prisma: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma || new PrismaClient();
  }

  static async make(): Promise<PostgresTransactionRepository> {
    const prisma = new PrismaClient();
    // Test connection
    await prisma.$connect();
    return new PostgresTransactionRepository(prisma);
  }

  private toDate(timestamp?: number): Date | undefined {
    return timestamp ? new Date(timestamp * 1000) : undefined;
  }

  private toTimestamp(date: Date): number {
    return Math.floor(date.getTime() / 1000);
  }

  async addTransaction(tx: AccountTransaction): Promise<void> {
    await this.prisma.accountTransaction.upsert({
      where: {
        chainId_txHash_txActionIndex: {
          chainId: tx.chainId,
          txHash: tx.txHash,
          txActionIndex: tx.txActionIndex ?? 0,
        },
      },
      update: {
        signerAddress: tx.signerAddress,
        transactionType: tx.transactionType,
        positionId: tx.positionId,
        inputAmount: tx.inputAmount,
        inputTokenDenom: tx.inputTokenDenom,
        inputTokenName: tx.inputTokenName,
        secondInputAmount: tx.secondInputAmount,
        secondInputTokenDenom: tx.secondInputTokenDenom,
        secondInputTokenName: tx.secondInputTokenName,
        outputAmount: tx.outputAmount,
        outputTokenDenom: tx.outputTokenDenom,
        outputTokenName: tx.outputTokenName,
        secondOutputAmount: tx.secondOutputAmount,
        secondOutputTokenDenom: tx.secondOutputTokenDenom,
        secondOutputTokenName: tx.secondOutputTokenName,
        gasFeeAmount: tx.gasFeeAmount,
        gasFeeTokenDenom: tx.gasFeeTokenDenom,
        gasFeeTokenName: tx.gasFeeTokenName,
        destinationAddress: tx.destinationAddress,
        destinationChainId: tx.destinationChainId,
        successful: tx.successful,
        error: tx.error,
        timestamp: this.toDate(tx.timestamp) || new Date(),
      },
      create: {
        signerAddress: tx.signerAddress,
        chainId: tx.chainId,
        transactionType: tx.transactionType,
        positionId: tx.positionId,
        inputAmount: tx.inputAmount,
        inputTokenDenom: tx.inputTokenDenom,
        inputTokenName: tx.inputTokenName,
        secondInputAmount: tx.secondInputAmount,
        secondInputTokenDenom: tx.secondInputTokenDenom,
        secondInputTokenName: tx.secondInputTokenName,
        outputAmount: tx.outputAmount,
        outputTokenDenom: tx.outputTokenDenom,
        outputTokenName: tx.outputTokenName,
        secondOutputAmount: tx.secondOutputAmount,
        secondOutputTokenDenom: tx.secondOutputTokenDenom,
        secondOutputTokenName: tx.secondOutputTokenName,
        gasFeeAmount: tx.gasFeeAmount,
        gasFeeTokenDenom: tx.gasFeeTokenDenom,
        gasFeeTokenName: tx.gasFeeTokenName,
        destinationAddress: tx.destinationAddress,
        destinationChainId: tx.destinationChainId,
        txHash: tx.txHash,
        txActionIndex: tx.txActionIndex ?? 0,
        successful: tx.successful,
        error: tx.error,
        timestamp: this.toDate(tx.timestamp) || new Date(),
      },
    });
  }

  async addTransactionBatch(txs: AccountTransaction[]): Promise<void> {
    await this.prisma.$transaction(
      txs.map((tx) =>
        this.prisma.accountTransaction.upsert({
          where: {
            chainId_txHash_txActionIndex: {
              chainId: tx.chainId,
              txHash: tx.txHash,
              txActionIndex: tx.txActionIndex ?? 0,
            },
          },
          update: {
            signerAddress: tx.signerAddress,
            transactionType: tx.transactionType,
            positionId: tx.positionId,
            inputAmount: tx.inputAmount,
            inputTokenDenom: tx.inputTokenDenom,
            inputTokenName: tx.inputTokenName,
            secondInputAmount: tx.secondInputAmount,
            secondInputTokenDenom: tx.secondInputTokenDenom,
            secondInputTokenName: tx.secondInputTokenName,
            outputAmount: tx.outputAmount,
            outputTokenDenom: tx.outputTokenDenom,
            outputTokenName: tx.outputTokenName,
            secondOutputAmount: tx.secondOutputAmount,
            secondOutputTokenDenom: tx.secondOutputTokenDenom,
            secondOutputTokenName: tx.secondOutputTokenName,
            gasFeeAmount: tx.gasFeeAmount,
            gasFeeTokenDenom: tx.gasFeeTokenDenom,
            gasFeeTokenName: tx.gasFeeTokenName,
            destinationAddress: tx.destinationAddress,
            destinationChainId: tx.destinationChainId,
            successful: tx.successful,
            error: tx.error,
            timestamp: this.toDate(tx.timestamp) || new Date(),
          },
          create: {
            signerAddress: tx.signerAddress,
            chainId: tx.chainId,
            transactionType: tx.transactionType,
            positionId: tx.positionId,
            inputAmount: tx.inputAmount,
            inputTokenDenom: tx.inputTokenDenom,
            inputTokenName: tx.inputTokenName,
            secondInputAmount: tx.secondInputAmount,
            secondInputTokenDenom: tx.secondInputTokenDenom,
            secondInputTokenName: tx.secondInputTokenName,
            outputAmount: tx.outputAmount,
            outputTokenDenom: tx.outputTokenDenom,
            outputTokenName: tx.outputTokenName,
            secondOutputAmount: tx.secondOutputAmount,
            secondOutputTokenDenom: tx.secondOutputTokenDenom,
            secondOutputTokenName: tx.secondOutputTokenName,
            gasFeeAmount: tx.gasFeeAmount,
            gasFeeTokenDenom: tx.gasFeeTokenDenom,
            gasFeeTokenName: tx.gasFeeTokenName,
            destinationAddress: tx.destinationAddress,
            destinationChainId: tx.destinationChainId,
            txHash: tx.txHash,
            txActionIndex: tx.txActionIndex ?? 0,
            successful: tx.successful,
            error: tx.error,
            timestamp: this.toDate(tx.timestamp) || new Date(),
          },
        })
      )
    );
  }

  private dbToTransaction(dbTx: any): AccountTransaction {
    return {
      signerAddress: dbTx.signerAddress,
      chainId: dbTx.chainId,
      transactionType: dbTx.transactionType as TransactionType,
      positionId: dbTx.positionId,
      inputAmount: dbTx.inputAmount,
      inputTokenDenom: dbTx.inputTokenDenom,
      inputTokenName: dbTx.inputTokenName,
      secondInputAmount: dbTx.secondInputAmount,
      secondInputTokenDenom: dbTx.secondInputTokenDenom,
      secondInputTokenName: dbTx.secondInputTokenName,
      outputAmount: dbTx.outputAmount,
      outputTokenDenom: dbTx.outputTokenDenom,
      outputTokenName: dbTx.outputTokenName,
      secondOutputAmount: dbTx.secondOutputAmount,
      secondOutputTokenDenom: dbTx.secondOutputTokenDenom,
      secondOutputTokenName: dbTx.secondOutputTokenName,
      gasFeeAmount: dbTx.gasFeeAmount,
      gasFeeTokenDenom: dbTx.gasFeeTokenDenom,
      gasFeeTokenName: dbTx.gasFeeTokenName,
      destinationAddress: dbTx.destinationAddress,
      destinationChainId: dbTx.destinationChainId,
      txHash: dbTx.txHash,
      txActionIndex: dbTx.txActionIndex,
      successful: dbTx.successful,
      error: dbTx.error,
      timestamp: this.toTimestamp(dbTx.timestamp),
    };
  }

  async getTransaction(
    txHash: string,
    chainId: string
  ): Promise<AccountTransaction | null> {
    const dbTx = await this.prisma.accountTransaction.findFirst({
      where: { txHash, chainId },
      orderBy: { txActionIndex: "asc" },
    });

    return dbTx ? this.dbToTransaction(dbTx) : null;
  }

  async getTransactionEntries(
    txHash: string,
    chainId: string
  ): Promise<AccountTransaction[]> {
    const dbTxs = await this.prisma.accountTransaction.findMany({
      where: { txHash, chainId },
      orderBy: { txActionIndex: "asc" },
    });

    return dbTxs.map((dbTx) => this.dbToTransaction(dbTx));
  }

  async getAccountTransactions(
    signerAddress: string,
    limit: number = 100,
    offset: number = 0,
    startTime?: Date,
    endTime?: Date
  ): Promise<AccountTransaction[]> {
    const dbTxs = await this.prisma.accountTransaction.findMany({
      where: {
        signerAddress,
        ...(startTime || endTime
          ? {
              timestamp: {
                ...(startTime ? { gte: startTime } : {}),
                ...(endTime ? { lte: endTime } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ timestamp: "desc" }, { txActionIndex: "asc" }],
      take: limit,
      skip: offset,
    });

    return dbTxs.map((dbTx) => this.dbToTransaction(dbTx));
  }

  async getTransactionsByType(
    transactionType: TransactionType,
    signerAddress?: string,
    limit: number = 100,
    startTime?: Date,
    endTime?: Date
  ): Promise<AccountTransaction[]> {
    const dbTxs = await this.prisma.accountTransaction.findMany({
      where: {
        ...(signerAddress ? { signerAddress } : {}),
        ...(transactionType ? { transactionType } : {}),
        ...(startTime || endTime
          ? {
              timestamp: {
                ...(startTime ? { gte: startTime } : {}),
                ...(endTime ? { lte: endTime } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ timestamp: "desc" }, { txActionIndex: "asc" }],
      take: limit,
    });

    return dbTxs.map((dbTx) => this.dbToTransaction(dbTx));
  }

  // Updated with mandatory signerAddress
  async getAccountStats(
    signerAddress: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<AccountStats[]> {
    const stats = await this.prisma.accountTransaction.groupBy({
      by: ["transactionType"],
      where: {
        signerAddress,
        ...(startTime || endTime
          ? {
              timestamp: {
                ...(startTime ? { gte: startTime } : {}),
                ...(endTime ? { lte: endTime } : {}),
              },
            }
          : {}),
      },
      _count: {
        _all: true,
      },
      _min: {
        timestamp: true,
      },
      _max: {
        timestamp: true,
      },
    });

    const successCounts = await this.prisma.accountTransaction.groupBy({
      by: ["transactionType"],
      where: {
        signerAddress,
        successful: true,
        ...(startTime || endTime
          ? {
              timestamp: {
                ...(startTime ? { gte: startTime } : {}),
                ...(endTime ? { lte: endTime } : {}),
              },
            }
          : {}),
      },
      _count: {
        _all: true,
      },
    });

    const successMap = new Map(
      successCounts.map((s) => [s.transactionType, s._count._all])
    );

    return stats.map((stat) => ({
      transactionType: stat.transactionType,
      count: stat._count._all,
      successfulCount: successMap.get(stat.transactionType) || 0,
      successRate:
        (successMap.get(stat.transactionType) || 0) / stat._count._all,
      firstTransaction: stat._min.timestamp
        ? this.toTimestamp(stat._min.timestamp)
        : 0,
      lastTransaction: stat._max.timestamp
        ? this.toTimestamp(stat._max.timestamp)
        : 0,
    }));
  }

  // Updated with optional signerAddress - with full SQL
  async getArchwayBoltVolume(
    signerAddress?: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<VolumeByToken[]> {
    const signerFilter = signerAddress
      ? Prisma.sql`AND signer_address = ${signerAddress}`
      : Prisma.sql``;
    const startFilter = startTime
      ? Prisma.sql`AND timestamp >= ${startTime}`
      : Prisma.sql``;
    const endFilter = endTime
      ? Prisma.sql`AND timestamp <= ${endTime}`
      : Prisma.sql``;

    const result = await this.prisma.$queryRaw<
      Array<{ tokenname: string; totalvolume: number; totalswaps: bigint }>
    >`
      WITH bolt_volumes AS (
        SELECT 
          token_name,
          SUM(amount::NUMERIC) as total_volume
        FROM (
          -- Input amounts
          SELECT input_token_name as token_name, input_amount::NUMERIC as amount
          FROM account_transactions
          WHERE transaction_type = 'bolt_archway_swap' 
            AND successful = true
            AND input_amount IS NOT NULL 
            AND input_token_name IS NOT NULL
            ${signerFilter}
            ${startFilter}
            ${endFilter}
          
          UNION ALL
          
          -- Second input amounts
          SELECT second_input_token_name as token_name, second_input_amount::NUMERIC as amount
          FROM account_transactions
          WHERE transaction_type = 'bolt_archway_swap' 
            AND successful = true
            AND second_input_amount IS NOT NULL 
            AND second_input_token_name IS NOT NULL
            ${signerFilter}
            ${startFilter}
            ${endFilter}
          
          UNION ALL
          
          -- Output amounts
          SELECT output_token_name as token_name, output_amount::NUMERIC as amount
          FROM account_transactions
          WHERE transaction_type = 'bolt_archway_swap' 
            AND successful = true
            AND output_amount IS NOT NULL 
            AND output_token_name IS NOT NULL
            ${signerFilter}
            ${startFilter}
            ${endFilter}
          
          UNION ALL
          
          -- Second output amounts
          SELECT second_output_token_name as token_name, second_output_amount::NUMERIC as amount
          FROM account_transactions
          WHERE transaction_type = 'bolt_archway_swap' 
            AND successful = true
            AND second_output_amount IS NOT NULL 
            AND second_output_token_name IS NOT NULL
            ${signerFilter}
            ${startFilter}
            ${endFilter}
        ) AS all_amounts
        GROUP BY token_name
      )
      SELECT 
        token_name as tokenName,
        total_volume as totalVolume,
        (SELECT COUNT(DISTINCT tx_hash) 
         FROM account_transactions 
         WHERE transaction_type = 'bolt_archway_swap' 
           AND successful = true 
           ${signerFilter}
           ${startFilter}
           ${endFilter}
        ) as totalSwaps
      FROM bolt_volumes
      ORDER BY total_volume DESC
    `;

    return result.map((row) => ({
      tokenName: row.tokenname,
      totalVolume: Number(row.totalvolume),
      totalSwaps: Number(row.totalswaps),
    }));
  }

  // Updated with optional signerAddress - with full SQL
  async getOsmosisVolume(
    signerAddress?: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<VolumeByToken[]> {
    const signerFilter = signerAddress
      ? Prisma.sql`AND signer_address = ${signerAddress}`
      : Prisma.sql``;
    const startFilter = startTime
      ? Prisma.sql`AND timestamp >= ${startTime}`
      : Prisma.sql``;
    const endFilter = endTime
      ? Prisma.sql`AND timestamp <= ${endTime}`
      : Prisma.sql``;

    const result = await this.prisma.$queryRaw<
      Array<{ tokenname: string; totalvolume: number; totaloperations: bigint }>
    >`
      WITH osmosis_volumes AS (
        SELECT 
          token_name,
          SUM(amount::NUMERIC) as total_volume
        FROM (
          -- Input amounts
          SELECT input_token_name as token_name, input_amount::NUMERIC as amount
          FROM account_transactions
          WHERE transaction_type IN ('create_position', 'withdraw_position')
            AND successful = true
            AND input_amount IS NOT NULL 
            AND input_token_name IS NOT NULL
            ${signerFilter}
            ${startFilter}
            ${endFilter}
          
          UNION ALL
          
          -- Second input amounts
          SELECT second_input_token_name as token_name, second_input_amount::NUMERIC as amount
          FROM account_transactions
          WHERE transaction_type IN ('create_position', 'withdraw_position')
            AND successful = true
            AND second_input_amount IS NOT NULL 
            AND second_input_token_name IS NOT NULL
            ${signerFilter}
            ${startFilter}
            ${endFilter}
          
          UNION ALL
          
          -- Output amounts
          SELECT output_token_name as token_name, output_amount::NUMERIC as amount
          FROM account_transactions
          WHERE transaction_type IN ('create_position', 'withdraw_position')
            AND successful = true
            AND output_amount IS NOT NULL 
            AND output_token_name IS NOT NULL
            ${signerFilter}
            ${startFilter}
            ${endFilter}
          
          UNION ALL
          
          -- Second output amounts
          SELECT second_output_token_name as token_name, second_output_amount::NUMERIC as amount
          FROM account_transactions
          WHERE transaction_type IN ('create_position', 'withdraw_position')
            AND successful = true
            AND second_output_amount IS NOT NULL 
            AND second_output_token_name IS NOT NULL
            ${signerFilter}
            ${startFilter}
            ${endFilter}
        ) AS all_amounts
        GROUP BY token_name
      )
      SELECT 
        token_name as tokenName,
        total_volume as totalVolume,
        (SELECT COUNT(DISTINCT tx_hash) 
         FROM account_transactions 
         WHERE transaction_type IN ('create_position', 'withdraw_position')
           AND successful = true 
           ${signerFilter}
           ${startFilter}
           ${endFilter}
        ) as totalOperations
      FROM osmosis_volumes
      ORDER BY total_volume DESC
    `;

    return result.map((row) => ({
      tokenName: row.tokenname,
      totalVolume: Number(row.totalvolume),
      totalOperations: Number(row.totaloperations),
    }));
  }

  // Updated with optional signerAddress - with full SQL
  async getBridgeVolume(
    signerAddress?: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<VolumeByToken[]> {
    const signerFilter = signerAddress
      ? Prisma.sql`AND signer_address = ${signerAddress}`
      : Prisma.sql``;
    const startFilter = startTime
      ? Prisma.sql`AND timestamp >= ${startTime}`
      : Prisma.sql``;
    const endFilter = endTime
      ? Prisma.sql`AND timestamp <= ${endTime}`
      : Prisma.sql``;

    const result = await this.prisma.$queryRaw<
      Array<{ tokenname: string; totalvolume: number; totaltransfers: bigint }>
    >`
      WITH bridge_volumes AS (
        SELECT 
          token_name,
          SUM(amount::NUMERIC) as total_volume
        FROM (
          -- Input amounts (sending)
          SELECT input_token_name as token_name, input_amount::NUMERIC as amount
          FROM account_transactions
          WHERE transaction_type = 'ibc_transfer'
            AND successful = true
            AND input_amount IS NOT NULL 
            AND input_token_name IS NOT NULL
            ${signerFilter}
            ${startFilter}
            ${endFilter}
          
          UNION ALL
          
          -- Output amounts (receiving)
          SELECT output_token_name as token_name, output_amount::NUMERIC as amount
          FROM account_transactions
          WHERE transaction_type = 'ibc_transfer'
            AND successful = true
            AND output_amount IS NOT NULL 
            AND output_token_name IS NOT NULL
            ${signerFilter}
            ${startFilter}
            ${endFilter}
        ) AS all_amounts
        GROUP BY token_name
      )
      SELECT 
        token_name as tokenName,
        total_volume as totalVolume,
        (SELECT COUNT(DISTINCT tx_hash) 
         FROM account_transactions 
         WHERE transaction_type = 'ibc_transfer'
           AND successful = true 
           ${signerFilter}
           ${startFilter}
           ${endFilter}
        ) as totalTransfers
      FROM bridge_volumes
      ORDER BY total_volume DESC
    `;

    return result.map((row) => ({
      tokenName: row.tokenname,
      totalVolume: Number(row.totalvolume),
      totalTransfers: Number(row.totaltransfers),
    }));
  }

  // Updated with optional signerAddress - with full SQL
  async getProfitability(
    signerAddress?: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<ProfitabilityByToken[]> {
    const signerFilter = signerAddress
      ? Prisma.sql`AND signer_address = ${signerAddress}`
      : Prisma.sql``;
    const startFilter = startTime
      ? Prisma.sql`AND timestamp >= ${startTime}`
      : Prisma.sql``;
    const endFilter = endTime
      ? Prisma.sql`AND timestamp <= ${endTime}`
      : Prisma.sql``;

    const result = await this.prisma.$queryRaw<
      Array<{
        tokenname: string;
        totalsent: number;
        totalreceived: number;
        netbalance: number;
        roipercentage: number | null;
      }>
    >`
      WITH token_flows AS (
        -- All payments (negative values)
        SELECT 
          token_name,
          -SUM(amount) as net_amount,
          'payment' as flow_type
        FROM (
          -- Input amounts
          SELECT input_token_name as token_name, input_amount::NUMERIC as amount
          FROM account_transactions
          WHERE successful = true
            AND input_amount IS NOT NULL 
            AND input_token_name IS NOT NULL
            ${signerFilter}
            ${startFilter}
            ${endFilter}
          
          UNION ALL
          
          -- Second input amounts
          SELECT second_input_token_name as token_name, second_input_amount::NUMERIC as amount
          FROM account_transactions
          WHERE successful = true
            AND second_input_amount IS NOT NULL 
            AND second_input_token_name IS NOT NULL
            ${signerFilter}
            ${startFilter}
            ${endFilter}
          
          UNION ALL
          
          -- Gas fees
          SELECT gas_fee_token_name as token_name, gas_fee_amount::NUMERIC as amount
          FROM account_transactions
          WHERE successful = true
            AND gas_fee_amount IS NOT NULL 
            AND gas_fee_token_name IS NOT NULL
            ${signerFilter}
            ${startFilter}
            ${endFilter}
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
          SELECT output_token_name as token_name, output_amount::NUMERIC as amount
          FROM account_transactions
          WHERE successful = true
            AND output_amount IS NOT NULL 
            AND output_token_name IS NOT NULL
            ${signerFilter}
            ${startFilter}
            ${endFilter}
          
          UNION ALL
          
          -- Second output amounts
          SELECT second_output_token_name as token_name, second_output_amount::NUMERIC as amount
          FROM account_transactions
          WHERE successful = true
            AND second_output_amount IS NOT NULL 
            AND second_output_token_name IS NOT NULL
            ${signerFilter}
            ${startFilter}
            ${endFilter}
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
    `;

    return result.map((row) => ({
      tokenName: row.tokenname,
      totalSent: Number(row.totalsent),
      totalReceived: Number(row.totalreceived),
      netBalance: Number(row.netbalance),
      roiPercentage: row.roipercentage ? Number(row.roipercentage) : null,
    }));
  }

  // Updated with optional signerAddress
  async getTransactionTypeSummary(
    signerAddress?: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<TransactionTypeSummary[]> {
    const summary = await this.prisma.accountTransaction.groupBy({
      by: ["transactionType"],
      where: {
        ...(signerAddress ? { signerAddress } : {}),
        ...(startTime || endTime
          ? {
              timestamp: {
                ...(startTime ? { gte: startTime } : {}),
                ...(endTime ? { lte: endTime } : {}),
              },
            }
          : {}),
      },
      _count: {
        _all: true,
      },
    });

    const successSummary = await this.prisma.accountTransaction.groupBy({
      by: ["transactionType", "successful"],
      where: {
        ...(signerAddress ? { signerAddress } : {}),
        ...(startTime || endTime
          ? {
              timestamp: {
                ...(startTime ? { gte: startTime } : {}),
                ...(endTime ? { lte: endTime } : {}),
              },
            }
          : {}),
      },
      _count: {
        _all: true,
      },
    });

    const successMap = new Map<string, { success: number; failed: number }>();
    successSummary.forEach((item) => {
      const current = successMap.get(item.transactionType) || {
        success: 0,
        failed: 0,
      };
      if (item.successful) {
        current.success = item._count._all;
      } else {
        current.failed = item._count._all;
      }
      successMap.set(item.transactionType, current);
    });

    return summary.map((item) => {
      const counts = successMap.get(item.transactionType) || {
        success: 0,
        failed: 0,
      };
      return {
        transactionType: item.transactionType,
        totalCount: item._count._all,
        successCount: counts.success,
        failedCount: counts.failed,
        successRate: counts.success / item._count._all,
      };
    });
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
