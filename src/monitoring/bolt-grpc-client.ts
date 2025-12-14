import { exec } from "child_process";
import { promisify } from "util";
import BigNumber from "bignumber.js";

const execAsync = promisify(exec);

export interface QuoteAsset {
  denom: string;
  amount: string; // Fraction string like "36546457/50000"
  minOut?: string;
  limitRatio?: string;
  limitFixed?: string;
}

export interface UnclaimedFees {
  asset: string;
  amount: string;
}

export interface Pool {
  baseAsset: string;
  baseAmount: string; // Fraction string like "1935609066231/1000000000"
  quoteAssets: QuoteAsset[];
  lpFeeRatio?: string;
  protocolFeeRatio?: string;
  minBaseOut?: string;
  withdrawalFeeRatio?: string;
  maxDynamicFeeRatio?: string;
  unclaimedProtocolFees?: UnclaimedFees;
  unclaimedLpFees?: UnclaimedFees;
}

export interface GetPoolResponse {
  pool: Pool;
}

export class BoltGrpcClient {
  private readonly endpoint: string;

  constructor(endpoint: string = "144.76.3.52:50063") {
    this.endpoint = endpoint;
  }

  /**
   * Parse a fraction string like "1935609066231/1000000000" to a number
   */
  private parseFraction(fractionStr: string): number {
    const parts = fractionStr.split("/");
    if (parts.length !== 2) {
      throw new Error(`Invalid fraction format: ${fractionStr}`);
    }
    const numerator = parseFloat(parts[0]);
    const denominator = parseFloat(parts[1]);
    if (denominator === 0) {
      throw new Error(`Division by zero in fraction: ${fractionStr}`);
    }
    return numerator / denominator;
  }

  async getPool(poolIdentifier: string): Promise<GetPoolResponse> {
    try {
      const command = `grpcurl -plaintext -d '{"pool_identifier": "${poolIdentifier}"}' ${this.endpoint} bolt.outpost.settlement.v2.PublicSettlementService.GetPool`;
      const { stdout, stderr } = await execAsync(command, {
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      // Check for errors in stderr first
      if (stderr && stderr.trim() && !stderr.includes("Failed to dial")) {
        const stderrLower = stderr.toLowerCase();
        if (stderrLower.includes("error") || stderrLower.includes("failed")) {
          throw new Error(`grpcurl error: ${stderr}`);
        }
      }

      // grpcurl outputs JSON to stdout
      const output = stdout.trim();
      if (!output) {
        if (stderr && stderr.trim()) {
          throw new Error(`grpcurl returned no output. stderr: ${stderr}`);
        }
        throw new Error("Empty response from grpcurl");
      }

      let parsed: any;
      try {
        parsed = JSON.parse(output);
      } catch (parseError) {
        throw new Error(`Failed to parse JSON response. Raw output: ${output.substring(0, 500)}`);
      }
      
      // Handle different response structures
      let pool: Pool;
      
      if (parsed.pool) {
        pool = parsed.pool;
      } else if (parsed.baseAsset || parsed.baseAmount) {
        pool = parsed;
      } else {
        throw new Error(`Unexpected response structure from grpcurl. Response keys: ${Object.keys(parsed).join(", ")}. Full response: ${JSON.stringify(parsed, null, 2)}`);
      }

      // Ensure quoteAssets is an array
      if (!pool.quoteAssets || !Array.isArray(pool.quoteAssets)) {
        pool.quoteAssets = [];
      }

      return { pool };
    } catch (error: any) {
      // Try to parse error output as it might contain the response
      if (error.stdout) {
        try {
          const parsed = JSON.parse(error.stdout.trim());
          if (parsed.pool) {
            return parsed as GetPoolResponse;
          } else if (parsed.baseAsset || parsed.baseAmount) {
            return { pool: parsed } as GetPoolResponse;
          }
        } catch {
          // If parsing fails, throw original error
        }
      }
      
      const errorMessage = error.stderr 
        ? `${error.message}. stderr: ${error.stderr}`
        : error.message || "Unknown error";
      
      throw new Error(
        `Failed to get pool ${poolIdentifier}: ${errorMessage}`
      );
    }
  }

  /**
   * Parse a fraction string to a BigNumber
   */
  static parseFractionToBigNumber(fractionStr: string): BigNumber {
    const parts = fractionStr.split("/");
    if (parts.length !== 2) {
      throw new Error(`Invalid fraction format: ${fractionStr}`);
    }
    const numerator = new BigNumber(parts[0]);
    const denominator = new BigNumber(parts[1]);
    if (denominator.isZero()) {
      throw new Error(`Division by zero in fraction: ${fractionStr}`);
    }
    return numerator.dividedBy(denominator);
  }
}
