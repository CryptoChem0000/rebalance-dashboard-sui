import { Command } from "commander";
import { BoltGrpcClient } from "../../monitoring/bolt-grpc-client";
import { PriceService } from "../../monitoring/price-service";
import BigNumber from "bignumber.js";
import { TransactionType } from "../../database/types";
import { SQLiteTransactionRepository, PostgresTransactionRepository } from "../../database";
import { getSignerAddress } from "../../utils";
import { KeyManager, KeyStoreType, DEFAULT_SUI_KEY_NAME } from "../../key-manager";
import { findSuiChainInfo } from "../../registry";
import { exec } from "child_process";
import { promisify } from "util";
import https from "https";

const execAsync = promisify(exec);

const SUI_POOL_ID = "0x21167b2e981e2c0a693afcfe882a3a827d663118e19afcb92e45bfe43fe56278";
const USDC_POOL_ID = "0x34fcaa553f1185e1c3a05de37b6a4d10c39535d19f9c8581eeae826434602b58";

// Monitoring dashboard constants (Archway/Bolt)
const COINGECKO_IDS: Record<string, string> = {
  TIA: 'celestia',
  INJ: 'injective-protocol',
  ATOM: 'cosmos',
  OSMO: 'osmosis',
  ARCH: 'archway',
  WBTC: 'wrapped-bitcoin',
  WETH: 'ethereum',
};

const POOL_ADDRESSES = {
  USDC: 'archway12sdfnwj0rhmmng885959wjclawexg7cpgeye4xuk9af7k9p6aw0qmc0cue',
  ARCH: 'archway16304knwamkhefu4y8j707htllu85ecla4re25xcyx9ctpq0puvxqpu8yf2',
  OSMO: 'archway18z8u7n2rnjsp4susy3mf74ma72s36qdj6zqzfa05wr78qdqzgteqh08req',
  ATOM: 'archway1nhk6dl6cmvk88q3nc6egnytaxm7gsywpqxkvtsg2hkt4ea8rpn0qxnlprp',
  TIA: 'archway1qcp0vd02ndxex4v5fv34cd0dh57ddex6vhqa0u2tgztan5ntgccqlmm8ar',
  INJ: 'archway1z7evv6xsydrl28glx606rgrt8zwkxkpqa0yxlhkg94xl39zplzysslemye',
  WBTC: 'archway1xy85mv4zg9lduw9tjk4fktj0e9h5k7wcgc5da5my0jny229rcd4qpprehx',
  WETH: 'archway1azu877l8d9ydmqpcssl8cpagjekzw45697uu4w8nent2u3rrdnks4jmjsu',
};

const TOKEN_DENOMS = {
  USDC: 'ibc/43897B9739BD63E3A08A88191999C632E052724AB96BD4C74AE31375C991F48D',
  ATOM: 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2',
  OSMO: 'ibc/0471F1C4E7AFD3F07702BEF6DC365268D64570F7C1FDC98EA6098DD6DE59817B',
  TIA: 'ibc/B68560022FB3CAD599224B16AAEB62FB85848A7674E40B68A0F1982F270B356E',
  INJ: 'ibc/9428981CEA5DA704D99DD51AAB2EC62359178392B667138CD4480B3F6585E71C',
  ARCH: 'aarch',
  WBTC: 'ibc/CF57A83CED6CEC7D706631B5DC53ABC21B7EDA7DF7490732B4361E6D5DD19C73',
  WETH: 'ibc/13C5990F84FA5D472E1F8BB1BAAEA8774DA5F24128EC02B119107AD21FB52A61',
};

const TOKEN_DECIMALS = {
  USDC: 6,
  ATOM: 6,
  OSMO: 6,
  TIA: 6,
  INJ: 18,
  ARCH: 18,
  WBTC: 8,
  WETH: 18,
};

const BOLT_ROUTER_ADDRESS = 'archway1vu2ctevyav3wlka9yn7hmcm0xnlltklnnceqaanpuh0eete80xgsymc3ln';

interface MonitoringData {
  prices: Record<string, number>;
  baseBalances: Array<{ name: string; amount: number; usdValue: number }>;
  quoteBalances: Array<{ name: string; amount: number; usdValue: number }>;
  usdcPoolQuoteBalances: Array<{ name: string; amount: number; usdValue: number }>;
  totalUsdValue: number;
}

interface PoolBalances {
  suiPoolBase: BigNumber;
  suiPoolQuote: BigNumber;
  usdcPoolBase: BigNumber;
  usdcPoolQuote: BigNumber;
  timestamp: number;
}

interface SwapBuyBreakdown {
  inputToken: string;
  inputAmount: BigNumber;
  inputUSD: BigNumber;
  outputToken: string;
  outputAmount: BigNumber;
  outputUSD: BigNumber;
  txHash: string;
  timestamp: number;
}

interface DailyVolume {
  date: Date;
  dateString: string;
  volumeUSD: BigNumber;
  transactionCount: number;
}

export function rebalanceDashboardCommand(program: Command) {
  program
    .command("rebalance-dashboard")
    .description("Rebalance dashboard with pool balances, swap_buy breakdown, and balance changes")
    .option(
      "--refresh <seconds>",
      "Auto-refresh interval in seconds (default: no auto-refresh)",
      "0"
    )
    .option("--endpoint <endpoint>", "Bolt gRPC endpoint", "144.76.3.52:50063")
    .option("--debug", "Show debug information including raw responses")
    .action(async (options) => {
      const refreshInterval = parseInt(options.refresh, 10);
      
      // Initialize database
      const keyStore = await KeyManager.create({
        type: KeyStoreType.ENV_VARIABLE,
      });
      const suiSigner = await keyStore.getSuiSigner(DEFAULT_SUI_KEY_NAME);
      const address = await getSignerAddress(suiSigner);
      const chainInfo = findSuiChainInfo("mainnet");
      
      const database = await (process.env.DATABASE_URL
        ? PostgresTransactionRepository.make()
        : SQLiteTransactionRepository.make(address));

      // Track previous balances for change calculation
      let previousBalances: PoolBalances | null = null;
      let lastRefreshTime: number | null = null;

      const displayDashboard = async () => {
        try {
          const grpcClient = new BoltGrpcClient(options.endpoint);
          const priceService = new PriceService();

          // Add separator between refreshes (but not on first run)
          if (refreshInterval > 0 && previousBalances !== null) {
            console.log("\n" + "═".repeat(80));
            console.log(`🔄 REFRESH - ${new Date().toLocaleString()}`);
            console.log("═".repeat(80) + "\n");
          }

          // Fetch pool data and prices
          if (!options.debug && previousBalances === null) {
            console.log("📡 Fetching pool data...\n");
          }

          const [suiPoolResponse, usdcPoolResponse] = await Promise.all([
            grpcClient.getPool(SUI_POOL_ID),
            grpcClient.getPool(USDC_POOL_ID),
          ]);

          const suiPool = suiPoolResponse.pool;
          const usdcPool = usdcPoolResponse.pool;

          // Debug: show raw responses
          if (options.debug) {
            console.log("\n🔍 DEBUG - SUI Pool Response:");
            console.log(JSON.stringify(suiPoolResponse, null, 2));
            console.log("\n🔍 DEBUG - USDC Pool Response:");
            console.log(JSON.stringify(usdcPoolResponse, null, 2));
            console.log();
          }

          // Validate pool structure
          if (!suiPool) {
            throw new Error(`Invalid SUI pool response: ${JSON.stringify(suiPoolResponse)}`);
          }
          if (!usdcPool) {
            throw new Error(`Invalid USDC pool response: ${JSON.stringify(usdcPoolResponse)}`);
          }

          // Validate pool has required fields
          if (!suiPool.baseAsset || !suiPool.baseAmount) {
            throw new Error("SUI pool missing baseAsset or baseAmount");
          }
          if (!usdcPool.baseAsset || !usdcPool.baseAmount) {
            throw new Error("USDC pool missing baseAsset or baseAmount");
          }

          // Get prices from price service
          const tokenPrices = await priceService.getTokenPrices();

          // Parse current pool balances
          const suiPoolBaseAmount = BoltGrpcClient.parseFractionToBigNumber(suiPool.baseAmount);
          const suiPoolQuoteAmount = suiPool.quoteAssets && suiPool.quoteAssets.length > 0
            ? BoltGrpcClient.parseFractionToBigNumber(suiPool.quoteAssets[0].amount)
            : new BigNumber(0);
          const usdcPoolBaseAmount = BoltGrpcClient.parseFractionToBigNumber(usdcPool.baseAmount);
          const usdcPoolQuoteAmount = usdcPool.quoteAssets && usdcPool.quoteAssets.length > 0
            ? BoltGrpcClient.parseFractionToBigNumber(usdcPool.quoteAssets[0].amount)
            : new BigNumber(0);

          const currentBalances: PoolBalances = {
            suiPoolBase: suiPoolBaseAmount,
            suiPoolQuote: suiPoolQuoteAmount,
            usdcPoolBase: usdcPoolBaseAmount,
            usdcPoolQuote: usdcPoolQuoteAmount,
            timestamp: Date.now(),
          };

          // Get swap_buy transactions (BOLT_SUI_SWAP) since last refresh
          // On first run, show transactions from the last hour
          const startTime = lastRefreshTime 
            ? new Date(lastRefreshTime)
            : new Date(Date.now() - 60 * 60 * 1000); // Last hour for first run
          
          const swapBuyTransactions = await database.getTransactionsByType(
            TransactionType.BOLT_SUI_SWAP,
            address,
            1000, // limit
            startTime,
            new Date()
          );

          // Calculate swap_buy breakdown
          const swapBuyBreakdown: SwapBuyBreakdown[] = [];
          for (const tx of swapBuyTransactions) {
            if (tx.successful && tx.inputAmount && tx.outputAmount) {
              const inputAmount = new BigNumber(tx.inputAmount);
              const outputAmount = new BigNumber(tx.outputAmount);
              
              // Get token prices
              const inputTokenLower = (tx.inputTokenDenom || "").toLowerCase();
              const outputTokenLower = (tx.outputTokenDenom || "").toLowerCase();
              
              let inputPrice = new BigNumber(0);
              let outputPrice = new BigNumber(0);
              
              if (inputTokenLower.includes("sui")) {
                inputPrice = tokenPrices.get("sui") || new BigNumber(0);
              } else if (inputTokenLower.includes("usdc")) {
                inputPrice = tokenPrices.get("usdc") || new BigNumber(1);
              }
              
              if (outputTokenLower.includes("sui")) {
                outputPrice = tokenPrices.get("sui") || new BigNumber(0);
              } else if (outputTokenLower.includes("usdc")) {
                outputPrice = tokenPrices.get("usdc") || new BigNumber(1);
              }
              
              const inputUSD = inputAmount.multipliedBy(inputPrice);
              const outputUSD = outputAmount.multipliedBy(outputPrice);
              
              swapBuyBreakdown.push({
                inputToken: tx.inputTokenName || tx.inputTokenDenom || "Unknown",
                inputAmount,
                inputUSD,
                outputToken: tx.outputTokenName || tx.outputTokenDenom || "Unknown",
                outputAmount,
                outputUSD,
                txHash: tx.txHash,
                timestamp: tx.timestamp || Date.now() / 1000,
              });
            }
          }

          // Calculate daily volumes for Sui
          const suiDailyVolumes = await calculateDailyVolumes(
            database,
            address,
            TransactionType.BOLT_SUI_SWAP,
            tokenPrices
          );
          
          // Calculate daily volumes for Archway (aggregate across all Archway bots)
          const archwayDailyVolumes = await calculateArchwayDailyVolumes(
            tokenPrices
          );

          // Fetch monitoring dashboard data (Archway/Bolt pools)
          const monitoringData = await fetchMonitoringDashboardData();

          // Display formatted dashboard
          displayFormattedDashboard(
            suiPool,
            usdcPool,
            tokenPrices,
            swapBuyBreakdown,
            previousBalances,
            currentBalances,
            monitoringData,
            suiDailyVolumes,
            archwayDailyVolumes
          );

          // Update previous balances for next refresh
          previousBalances = currentBalances;
          lastRefreshTime = Date.now();

          // Display timestamp
          const timestamp = new Date().toLocaleString();
          if (refreshInterval > 0) {
            console.log(`\n⏰ Last updated: ${timestamp} | Auto-refresh: ${refreshInterval}s`);
          } else {
            console.log(`\n⏰ Last updated: ${timestamp}`);
          }

        } catch (error) {
          console.error(
            "\n❌ Error fetching pool data:",
            error instanceof Error ? error.message : "Unknown error"
          );
          
          // Show stack trace in debug mode
          if (options.debug && error instanceof Error && error.stack) {
            console.error("\nStack trace:", error.stack);
          }
          
          if (refreshInterval > 0) {
            console.log(`\nRetrying in ${refreshInterval} seconds...\n`);
          }
        }
      };

      // Initial display
      await displayDashboard();

      // Set up auto-refresh if enabled
      if (refreshInterval > 0) {
        setInterval(async () => {
          await displayDashboard();
        }, refreshInterval * 1000);
      }
    });
}

/**
 * Calculate daily volumes for current day and previous 4 days (UTC)
 */
async function calculateDailyVolumes(
  database: SQLiteTransactionRepository | PostgresTransactionRepository,
  address: string,
  transactionType: TransactionType,
  tokenPrices: Map<string, BigNumber>
): Promise<DailyVolume[]> {
  const dailyVolumes: DailyVolume[] = [];
  const now = new Date();
  const suiPrice = tokenPrices.get("sui") || new BigNumber(0);
  const usdcPrice = tokenPrices.get("usdc") || new BigNumber(1);

  // Calculate UTC day boundaries for current day and previous 4 days (5 days total)
  for (let dayOffset = 0; dayOffset <= 4; dayOffset++) {
    const targetDate = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - dayOffset,
      0, 0, 0, 0
    ));
    
    const nextDay = new Date(targetDate);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);

    // Get all transactions for this UTC day
    const dayTransactions = await database.getTransactionsByType(
      transactionType,
      address,
      10000, // Large limit to get all transactions
      targetDate,
      nextDay
    );

    // Calculate total volume in USD for this day
    let totalVolumeUSD = new BigNumber(0);
    let transactionCount = 0;

    for (const tx of dayTransactions) {
      if (tx.successful && (tx.inputAmount || tx.outputAmount)) {
        transactionCount++;
        
        // Calculate volume from input and output
        const inputTokenLower = (tx.inputTokenDenom || "").toLowerCase();
        const outputTokenLower = (tx.outputTokenDenom || "").toLowerCase();
        
        let inputPrice = new BigNumber(0);
        let outputPrice = new BigNumber(0);
        
        if (inputTokenLower.includes("sui")) {
          inputPrice = suiPrice;
        } else if (inputTokenLower.includes("usdc")) {
          inputPrice = usdcPrice;
        }
        
        if (outputTokenLower.includes("sui")) {
          outputPrice = suiPrice;
        } else if (outputTokenLower.includes("usdc")) {
          outputPrice = usdcPrice;
        }

        // Volume is calculated from input amount (standard for swap volume)
        if (tx.inputAmount) {
          const inputUSD = new BigNumber(tx.inputAmount).multipliedBy(inputPrice);
          totalVolumeUSD = totalVolumeUSD.plus(inputUSD);
        } else if (tx.outputAmount) {
          // Fallback to output if input not available
          const outputUSD = new BigNumber(tx.outputAmount).multipliedBy(outputPrice);
          totalVolumeUSD = totalVolumeUSD.plus(outputUSD);
        }
      }
    }

    const dateString = targetDate.toISOString().split('T')[0]; // YYYY-MM-DD format
    dailyVolumes.push({
      date: targetDate,
      dateString,
      volumeUSD: totalVolumeUSD,
      transactionCount,
    });
  }

  return dailyVolumes;
}

/**
 * Calculate daily volumes for Archway bots (aggregate across all 4 bots)
 */
async function calculateArchwayDailyVolumes(
  tokenPrices: Map<string, BigNumber>
): Promise<DailyVolume[]> {
  const archwayBotPaths = [
    "/Users/maxmckendry/Desktop/philabs-lp-rebalance-atom",
    "/Users/maxmckendry/Desktop/philabs-lp-rebalance-osmo",
    "/Users/maxmckendry/Desktop/philabs-lp-rebalance-tia",
    "/Users/maxmckendry/Desktop/philabs-lp-rebalance-inj",
  ];

  const now = new Date();
  const suiPrice = tokenPrices.get("sui") || new BigNumber(0);
  const usdcPrice = tokenPrices.get("usdc") || new BigNumber(1);

  // Initialize daily volumes structure for 5 days
  const dailyVolumesMap = new Map<string, { volumeUSD: BigNumber; transactionCount: number }>();
  
  for (let dayOffset = 0; dayOffset <= 4; dayOffset++) {
    const targetDate = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - dayOffset,
      0, 0, 0, 0
    ));
    const dateString = targetDate.toISOString().split('T')[0];
    dailyVolumesMap.set(dateString, {
      volumeUSD: new BigNumber(0),
      transactionCount: 0,
    });
  }

  // Query each Archway bot database
  for (const botPath of archwayBotPaths) {
    try {
      // Find database file in the bot's database directory
      const databaseDir = `${botPath}/database`;
      const fs = await import("node:fs/promises");
      const path = await import("path");
      
      try {
        const files = await fs.readdir(databaseDir);
        const dbFiles = files.filter(f => f.endsWith('.db'));
        
        if (dbFiles.length === 0) {
          continue; // Skip if no database found
        }

        // Use the first database file found (each bot should have one)
        const dbPath = path.join(databaseDir, dbFiles[0]);
        
        // Create repository instance directly with the database path
        // Import the class directly
        const sqliteRepoModule = await import("../../database/sqlite-transaction-repository");
        const SQLiteTransactionRepository = sqliteRepoModule.SQLiteTransactionRepository;
        const botDatabase = new SQLiteTransactionRepository(dbPath);

          // Query transactions for each day
          for (let dayOffset = 0; dayOffset <= 4; dayOffset++) {
            const targetDate = new Date(Date.UTC(
              now.getUTCFullYear(),
              now.getUTCMonth(),
              now.getUTCDate() - dayOffset,
              0, 0, 0, 0
            ));
            
            const nextDay = new Date(targetDate);
            nextDay.setUTCDate(nextDay.getUTCDate() + 1);
            const dateString = targetDate.toISOString().split('T')[0];

            // Get transactions for this day (no address filter - get all transactions)
            const dayTransactions = await botDatabase.getTransactionsByType(
              TransactionType.BOLT_ARCHWAY_SWAP,
              undefined, // No address filter - get all
              10000,
              targetDate,
              nextDay
            );

            const dayData = dailyVolumesMap.get(dateString)!;

            // Calculate volume for this bot's transactions
            for (const tx of dayTransactions) {
              if (tx.successful && (tx.inputAmount || tx.outputAmount)) {
                dayData.transactionCount++;
                
                const inputTokenLower = (tx.inputTokenDenom || "").toLowerCase();
                const outputTokenLower = (tx.outputTokenDenom || "").toLowerCase();
                
                let inputPrice = new BigNumber(0);
                let outputPrice = new BigNumber(0);
                
                if (inputTokenLower.includes("sui")) {
                  inputPrice = suiPrice;
                } else if (inputTokenLower.includes("usdc")) {
                  inputPrice = usdcPrice;
                }
                
                if (outputTokenLower.includes("sui")) {
                  outputPrice = suiPrice;
                } else if (outputTokenLower.includes("usdc")) {
                  outputPrice = usdcPrice;
                }

                if (tx.inputAmount) {
                  const inputUSD = new BigNumber(tx.inputAmount).multipliedBy(inputPrice);
                  dayData.volumeUSD = dayData.volumeUSD.plus(inputUSD);
                } else if (tx.outputAmount) {
                  const outputUSD = new BigNumber(tx.outputAmount).multipliedBy(outputPrice);
                  dayData.volumeUSD = dayData.volumeUSD.plus(outputUSD);
                }
              }
            }
          }

          // Close database after processing all days
          botDatabase.close();
      } catch (error) {
        // Skip this bot if database directory doesn't exist or can't be read
        continue;
      }
    } catch (error) {
      // Skip this bot if path doesn't exist
      continue;
    }
  }

  // Convert map to array
  const dailyVolumes: DailyVolume[] = [];
  for (let dayOffset = 0; dayOffset <= 4; dayOffset++) {
    const targetDate = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - dayOffset,
      0, 0, 0, 0
    ));
    const dateString = targetDate.toISOString().split('T')[0];
    const dayData = dailyVolumesMap.get(dateString)!;
    
    dailyVolumes.push({
      date: targetDate,
      dateString,
      volumeUSD: dayData.volumeUSD,
      transactionCount: dayData.transactionCount,
    });
  }

  return dailyVolumes;
}

/**
 * Fetch monitoring dashboard data from Archway/Bolt pools
 */
async function fetchMonitoringDashboardData(): Promise<MonitoringData | null> {
  try {
    // Get prices using fallback method (Bolt first, then CoinGecko)
    const [tiaPrice, injPrice, atomPrice, osmoPrice, archPrice, wbtcPrice, wethPrice] = await Promise.all([
      getTokenPrice('TIA'),
      getTokenPrice('INJ'),
      getTokenPrice('ATOM'),
      getTokenPrice('OSMO'),
      getTokenPrice('ARCH'),
      getTokenPrice('WBTC'),
      getTokenPrice('WETH'),
    ]);

    const prices = {
      USDC: 1.0,
      TIA: tiaPrice,
      INJ: injPrice,
      ATOM: atomPrice,
      OSMO: osmoPrice,
      ARCH: archPrice,
      WBTC: wbtcPrice,
      WETH: wethPrice,
    };

    // Get pool balances
    const pools = [
      { name: 'USDC', address: POOL_ADDRESSES.USDC, denom: TOKEN_DENOMS.USDC, decimals: TOKEN_DECIMALS.USDC, price: 1.0 },
      { name: 'TIA', address: POOL_ADDRESSES.TIA, denom: TOKEN_DENOMS.TIA, decimals: TOKEN_DECIMALS.TIA, price: prices.TIA },
      { name: 'INJ', address: POOL_ADDRESSES.INJ, denom: TOKEN_DENOMS.INJ, decimals: TOKEN_DECIMALS.INJ, price: prices.INJ },
      { name: 'ATOM', address: POOL_ADDRESSES.ATOM, denom: TOKEN_DENOMS.ATOM, decimals: TOKEN_DECIMALS.ATOM, price: prices.ATOM },
      { name: 'OSMO', address: POOL_ADDRESSES.OSMO, denom: TOKEN_DENOMS.OSMO, decimals: TOKEN_DECIMALS.OSMO, price: prices.OSMO },
      { name: 'ARCH', address: POOL_ADDRESSES.ARCH, denom: TOKEN_DENOMS.ARCH, decimals: TOKEN_DECIMALS.ARCH, price: prices.ARCH },
      { name: 'WBTC', address: POOL_ADDRESSES.WBTC, denom: TOKEN_DENOMS.WBTC, decimals: TOKEN_DECIMALS.WBTC, price: prices.WBTC },
      { name: 'WETH', address: POOL_ADDRESSES.WETH, denom: TOKEN_DENOMS.WETH, decimals: TOKEN_DECIMALS.WETH, price: prices.WETH },
    ];

    const baseBalances: Array<{ name: string; amount: number; usdValue: number }> = [];
    const quoteBalances: Array<{ name: string; amount: number; usdValue: number }> = [];
    const usdcPoolQuoteBalances: Array<{ name: string; amount: number; usdValue: number }> = [];
    let totalUsdValue = 0;

    // Fetch all balances in parallel
    const balancePromises = pools.map(async (pool) => {
      const [baseBalance, usdcBalance] = await Promise.all([
        getPoolBalance(pool.address, pool.denom),
        pool.name !== 'USDC' ? getPoolBalance(pool.address, TOKEN_DENOMS.USDC) : null,
      ]);

      return { pool, baseBalance, usdcBalance };
    });

    const balanceResults = await Promise.all(balancePromises);

    for (const { pool, baseBalance, usdcBalance } of balanceResults) {
      if (baseBalance && baseBalance !== '0') {
        const amount = parseFloat(baseBalance) / Math.pow(10, pool.decimals);
        
        if (pool.price > 0) {
          const usdValue = amount * pool.price;
          totalUsdValue += usdValue;
          baseBalances.push({ name: pool.name, amount, usdValue });
        } else {
          baseBalances.push({ name: pool.name, amount, usdValue: 0 });
        }
      }
      
      if (usdcBalance && usdcBalance !== '0') {
        const usdcAmount = parseFloat(usdcBalance) / Math.pow(10, TOKEN_DECIMALS.USDC);
        const usdcUsdValue = usdcAmount * 1.0;
        totalUsdValue += usdcUsdValue;
        quoteBalances.push({ name: pool.name, amount: usdcAmount, usdValue: usdcUsdValue });
      }
    }

    // Fetch balances of all tokens in the USDC pool (as quote assets)
    const usdcPoolAddress = POOL_ADDRESSES.USDC;
    const tokensToCheck = ['TIA', 'INJ', 'ATOM', 'OSMO', 'ARCH', 'WBTC'];
    
    const usdcPoolBalancePromises = tokensToCheck.map(async (tokenName) => {
      const tokenDenom = TOKEN_DENOMS[tokenName as keyof typeof TOKEN_DENOMS];
      const tokenDecimals = TOKEN_DECIMALS[tokenName as keyof typeof TOKEN_DECIMALS];
      const tokenPrice = prices[tokenName as keyof typeof prices];
      
      const balance = await getPoolBalance(usdcPoolAddress, tokenDenom);
      
      if (balance && balance !== '0') {
        const amount = parseFloat(balance) / Math.pow(10, tokenDecimals);
        const usdValue = tokenPrice > 0 ? amount * tokenPrice : 0;
        return { name: tokenName, amount, usdValue };
      }
      
      return null;
    });

    const usdcPoolBalances = await Promise.all(usdcPoolBalancePromises);
    for (const balance of usdcPoolBalances) {
      if (balance) {
        usdcPoolQuoteBalances.push(balance);
        if (balance.usdValue > 0) {
          totalUsdValue += balance.usdValue;
        }
      }
    }

    // Sort by USD value descending
    usdcPoolQuoteBalances.sort((a, b) => b.usdValue - a.usdValue);

    return { prices, baseBalances, quoteBalances, usdcPoolQuoteBalances, totalUsdValue };
  } catch (error: any) {
    // Silently fail - monitoring data is optional
    return null;
  }
}

async function queryBoltPrice(tokenIn: string, tokenOut: string, amountIn: string): Promise<string | null> {
  try {
    const query = {
      simulate_swap_exact_in: {
        amount_in: {
          denom: TOKEN_DENOMS[tokenIn as keyof typeof TOKEN_DENOMS],
          amount: amountIn,
        },
        want_out: TOKEN_DENOMS[tokenOut as keyof typeof TOKEN_DENOMS],
      },
    };

    const queryJson = JSON.stringify(query);
    const escapedJson = queryJson.replace(/'/g, "'\"'\"'");
    const cmd = `archwayd query wasm contract-state smart ${BOLT_ROUTER_ADDRESS} '${escapedJson}' --output json --node https://rpc.mainnet.archway.io`;
    
    const { stdout } = await execAsync(cmd);
    const data = JSON.parse(stdout);
    
    if (data?.data?.base_out?.amount) {
      return data.data.base_out.amount;
    }
    
    if (data?.base_out?.amount) {
      return data.base_out.amount;
    }
    
    return null;
  } catch (error: any) {
    return null;
  }
}

// Cache for CoinGecko prices (5 minute TTL)
let priceCache: { prices: Record<string, number>; timestamp: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchPriceFromCoinGecko(token: string): Promise<number | null> {
  try {
    const coinId = COINGECKO_IDS[token];
    if (!coinId) {
      return null;
    }

    // Check cache first
    if (priceCache && Date.now() - priceCache.timestamp < CACHE_TTL) {
      const cachedPrice = priceCache.prices[token];
      if (cachedPrice && cachedPrice > 0) {
        return cachedPrice;
      }
    }

    // Fetch prices for all tokens at once
    const ids = Object.values(COINGECKO_IDS).join(',');
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`;

    return new Promise((resolve, reject) => {
      const req = https.get(url, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              reject(new Error(`CoinGecko API returned status ${res.statusCode}`));
              return;
            }

            const json = JSON.parse(data);
            const prices: Record<string, number> = {};
            
            // Map CoinGecko IDs back to our tokens
            for (const [tokenName, coinIdValue] of Object.entries(COINGECKO_IDS)) {
              if (json[coinIdValue]?.usd) {
                prices[tokenName] = json[coinIdValue].usd;
              }
            }

            // Update cache
            priceCache = {
              prices,
              timestamp: Date.now(),
            };

            resolve(prices[token] || null);
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('CoinGecko API request timeout'));
      });
    });
  } catch (error) {
    return null;
  }
}

async function getTokenPrice(token: string): Promise<number> {
  // First try Bolt (if it's a USDC pair)
  if (token !== 'USDC') {
    const amount = (1 * 10 ** TOKEN_DECIMALS[token as keyof typeof TOKEN_DECIMALS]).toString();
    const boltResult = await queryBoltPrice(token, 'USDC', amount);
    if (boltResult && boltResult !== '0') {
      const price = parseFloat(boltResult) / (10 ** TOKEN_DECIMALS.USDC);
      if (price > 0) {
        return price;
      }
    }
  }

  // Fallback to CoinGecko
  if (token === 'USDC') {
    return 1.0;
  }
  
  const coinGeckoPrice = await fetchPriceFromCoinGecko(token);
  return coinGeckoPrice || 0;
}

async function getPoolBalance(poolAddress: string, tokenDenom: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `archwayd query bank balances ${poolAddress} --output json --node https://rpc.mainnet.archway.io`
    );
    const data = JSON.parse(stdout);
    
    const balance = data.balances?.find((b: any) => b.denom === tokenDenom);
    return balance?.amount || null;
  } catch (error: any) {
    return null;
  }
}

function displayFormattedDashboard(
  suiPool: any,
  usdcPool: any,
  tokenPrices: Map<string, BigNumber>,
  swapBuyBreakdown: SwapBuyBreakdown[],
  previousBalances: PoolBalances | null,
  currentBalances: PoolBalances,
  monitoringData: MonitoringData | null,
  suiDailyVolumes: DailyVolume[],
  archwayDailyVolumes: DailyVolume[]
) {
  const width = 78;
  const border = "╠" + "═".repeat(width) + "╣";
  const bottom = "╚" + "═".repeat(width) + "╝";

  // Get prices
  const suiPrice = tokenPrices.get("sui") || new BigNumber(0);
  const usdcPrice = tokenPrices.get("usdc") || new BigNumber(1);

  // Parse pool data
  // SUI Pool: Base = SUI, Quote = USDC
  const suiPoolBaseAmount = currentBalances.suiPoolBase;
  const suiPoolQuoteAmount = currentBalances.suiPoolQuote;
  const suiPoolBaseUSD = suiPoolBaseAmount.multipliedBy(suiPrice);
  const suiPoolQuoteUSD = suiPoolQuoteAmount.multipliedBy(usdcPrice);

  // USDC Pool: Base = USDC, Quote = SUI
  const usdcPoolBaseAmount = currentBalances.usdcPoolBase;
  const usdcPoolQuoteAmount = currentBalances.usdcPoolQuote;
  const usdcPoolBaseUSD = usdcPoolBaseAmount.multipliedBy(usdcPrice);
  const usdcPoolQuoteUSD = usdcPoolQuoteAmount.multipliedBy(suiPrice);

  // Calculate total liquidity
  const totalLiquidity = suiPoolBaseUSD
    .plus(suiPoolQuoteUSD)
    .plus(usdcPoolBaseUSD)
    .plus(usdcPoolQuoteUSD);

  // Calculate balance changes if we have previous balances
  let suiPoolBaseChange: BigNumber | null = null;
  let suiPoolQuoteChange: BigNumber | null = null;
  let usdcPoolBaseChange: BigNumber | null = null;
  let usdcPoolQuoteChange: BigNumber | null = null;
  
  if (previousBalances) {
    suiPoolBaseChange = currentBalances.suiPoolBase.minus(previousBalances.suiPoolBase);
    suiPoolQuoteChange = currentBalances.suiPoolQuote.minus(previousBalances.suiPoolQuote);
    usdcPoolBaseChange = currentBalances.usdcPoolBase.minus(previousBalances.usdcPoolBase);
    usdcPoolQuoteChange = currentBalances.usdcPoolQuote.minus(previousBalances.usdcPoolQuote);
  }

  // Display BOLT PROTOCOL MONITORING (Sui) heading
  const suiMonitoringTitle = "  🔍 BOLT PROTOCOL MONITORING (Sui)";
  console.log(border);
  console.log("║" + suiMonitoringTitle.padEnd(width) + "║");
  console.log(border);

  // Display PRICES section
  const pricesTitle = "  📊 PRICES";
  const pricesContent = `  SUI Price:  ${formatUSD(suiPrice)}`;
  console.log("║" + pricesTitle.padEnd(width) + "║");
  console.log(border);
  console.log("║" + pricesContent.padEnd(width) + "║");
  console.log(border);

  // Display POOL BALANCES (Base) section
  const baseTitle = "POOL BALANCES (Base)";
  console.log("║" + baseTitle.padEnd(width) + "║");
  console.log(border);
  
  // USDC Base - show current and previous if available
  let usdcBaseLine = `  USDC   | ${formatTokenAmount(usdcPoolBaseAmount)} tokens = ${formatUSD(usdcPoolBaseUSD)} USD`;
  console.log("║" + usdcBaseLine.padEnd(width) + "║");
  if (previousBalances) {
    const prevUsdcBaseUSD = previousBalances.usdcPoolBase.multipliedBy(usdcPrice);
    const prevUsdcLine = `         (prev: ${formatTokenAmount(previousBalances.usdcPoolBase)} tokens = ${formatUSD(prevUsdcBaseUSD)} USD)`;
    console.log("║" + prevUsdcLine.padEnd(width) + "║");
  }
  
  // SUI Base - show current and previous if available
  let suiBaseLine = `  SUI    | ${formatTokenAmount(suiPoolBaseAmount)} tokens = ${formatUSD(suiPoolBaseUSD)} USD`;
  console.log("║" + suiBaseLine.padEnd(width) + "║");
  if (previousBalances) {
    const prevSuiBaseUSD = previousBalances.suiPoolBase.multipliedBy(suiPrice);
    const prevSuiLine = `         (prev: ${formatTokenAmount(previousBalances.suiPoolBase)} tokens = ${formatUSD(prevSuiBaseUSD)} USD)`;
    console.log("║" + prevSuiLine.padEnd(width) + "║");
  }
  console.log(border);

  // Display POOL BALANCES (Quote) section
  const quoteTitle = "  POOL BALANCES (Quote)";
  console.log("║" + quoteTitle.padEnd(width) + "║");
  console.log(border);
  
  // SUI Quote - show current and previous if available
  let suiQuoteLine = `  SUI    | USDC: ${formatTokenAmount(suiPoolQuoteAmount)} tokens = ${formatUSD(suiPoolQuoteUSD)} USD`;
  console.log("║" + suiQuoteLine.padEnd(width) + "║");
  if (previousBalances) {
    const prevSuiQuoteUSD = previousBalances.suiPoolQuote.multipliedBy(usdcPrice);
    const prevSuiQuoteLine = `         (prev: ${formatTokenAmount(previousBalances.suiPoolQuote)} tokens = ${formatUSD(prevSuiQuoteUSD)} USD)`;
    console.log("║" + prevSuiQuoteLine.padEnd(width) + "║");
  }
  
  // USDC Quote - show current and previous if available
  let usdcQuoteLine = `  USDC   | SUI: ${formatTokenAmount(usdcPoolQuoteAmount)} tokens = ${formatUSD(usdcPoolQuoteUSD)} USD`;
  console.log("║" + usdcQuoteLine.padEnd(width) + "║");
  if (previousBalances) {
    const prevUsdcQuoteUSD = previousBalances.usdcPoolQuote.multipliedBy(suiPrice);
    const prevUsdcQuoteLine = `         (prev: ${formatTokenAmount(previousBalances.usdcPoolQuote)} tokens = ${formatUSD(prevUsdcQuoteUSD)} USD)`;
    console.log("║" + prevUsdcQuoteLine.padEnd(width) + "║");
  }
  console.log(border);

  // Display Total Pool Liquidity - show current and previous if available
  let totalLine = `  💵 Total Pool Liquidity: ${formatUSD(totalLiquidity)} USD`;
  console.log("║" + totalLine.padEnd(width) + "║");
  if (previousBalances) {
    const prevTotalLiquidity = previousBalances.suiPoolBase.multipliedBy(suiPrice)
      .plus(previousBalances.suiPoolQuote.multipliedBy(usdcPrice))
      .plus(previousBalances.usdcPoolBase.multipliedBy(usdcPrice))
      .plus(previousBalances.usdcPoolQuote.multipliedBy(suiPrice));
    const prevTotalLine = `         (prev: ${formatUSD(prevTotalLiquidity)} USD)`;
    console.log("║" + prevTotalLine.padEnd(width) + "║");
  }
  console.log(border);

  // Display SWAP_BUY BREAKDOWN section
  const swapBuyTitle = "  🔄 SWAP_BUY BREAKDOWN";
  console.log("║" + swapBuyTitle.padEnd(width) + "║");
  console.log(border);

  if (swapBuyBreakdown.length === 0) {
    const noSwapsLine = "  No swap_buy transactions since last refresh";
    console.log("║" + noSwapsLine.padEnd(width) + "║");
  } else {
    // Calculate totals
    let totalInputUSD = new BigNumber(0);
    let totalOutputUSD = new BigNumber(0);
    const tokenBreakdown: Map<string, { inputAmount: BigNumber; inputUSD: BigNumber; outputAmount: BigNumber; outputUSD: BigNumber }> = new Map();

    for (const swap of swapBuyBreakdown) {
      totalInputUSD = totalInputUSD.plus(swap.inputUSD);
      totalOutputUSD = totalOutputUSD.plus(swap.outputUSD);

      // Aggregate by input token
      const key = swap.inputToken;
      if (!tokenBreakdown.has(key)) {
        tokenBreakdown.set(key, {
          inputAmount: new BigNumber(0),
          inputUSD: new BigNumber(0),
          outputAmount: new BigNumber(0),
          outputUSD: new BigNumber(0),
        });
      }
      const breakdown = tokenBreakdown.get(key)!;
      breakdown.inputAmount = breakdown.inputAmount.plus(swap.inputAmount);
      breakdown.inputUSD = breakdown.inputUSD.plus(swap.inputUSD);
      breakdown.outputAmount = breakdown.outputAmount.plus(swap.outputAmount);
      breakdown.outputUSD = breakdown.outputUSD.plus(swap.outputUSD);
    }

    // Display breakdown by token
    for (const [token, breakdown] of tokenBreakdown.entries()) {
      const tokenLine = `  ${token}:`;
      console.log("║" + tokenLine.padEnd(width) + "║");
      
      const inputLine = `    Input:  ${formatTokenAmount(breakdown.inputAmount)} tokens = ${formatUSD(breakdown.inputUSD)} USD`;
      const outputLine = `    Output: ${formatTokenAmount(breakdown.outputAmount)} tokens = ${formatUSD(breakdown.outputUSD)} USD`;
      
      console.log("║" + inputLine.padEnd(width) + "║");
      console.log("║" + outputLine.padEnd(width) + "║");
    }

    // Display totals
    const totalLine = `  Total: ${formatUSD(totalInputUSD)} USD in → ${formatUSD(totalOutputUSD)} USD out`;
    console.log("║" + totalLine.padEnd(width) + "║");
    const countLine = `  Transactions: ${swapBuyBreakdown.length}`;
    console.log("║" + countLine.padEnd(width) + "║");
  }
  console.log(border);

  // Display POOL BALANCE CHANGES section
  if (previousBalances) {
    const changesTitle = "  📈 POOL BALANCE CHANGES (Since Last Refresh)";
    console.log("║" + changesTitle.padEnd(width) + "║");
    console.log(border);

    // SUI Pool Changes
    // SUI Pool Base Change
    const suiBaseChangeUSD = suiPoolBaseChange ? suiPoolBaseChange.multipliedBy(suiPrice) : new BigNumber(0);
    const suiBaseSign = suiPoolBaseChange && suiPoolBaseChange.isPositive() ? "+" : "";
    const suiBaseChangeLine = `  SUI Pool Base:   ${suiPoolBaseChange ? suiBaseSign + formatTokenAmount(suiPoolBaseChange) : "0"} tokens (${suiBaseSign}${formatUSD(suiBaseChangeUSD)})`;
    console.log("║" + suiBaseChangeLine.padEnd(width) + "║");

    // SUI Pool Quote Change
    const suiQuoteChangeUSD = suiPoolQuoteChange ? suiPoolQuoteChange.multipliedBy(usdcPrice) : new BigNumber(0);
    const suiQuoteSign = suiPoolQuoteChange && suiPoolQuoteChange.isPositive() ? "+" : "";
    const suiQuoteChangeLine = `  SUI Pool Quote:  ${suiPoolQuoteChange ? suiQuoteSign + formatTokenAmount(suiPoolQuoteChange) : "0"} tokens (${suiQuoteSign}${formatUSD(suiQuoteChangeUSD)})`;
    console.log("║" + suiQuoteChangeLine.padEnd(width) + "║");

    // USDC Pool Changes
    // USDC Pool Base Change
    const usdcBaseChangeUSD = usdcPoolBaseChange ? usdcPoolBaseChange.multipliedBy(usdcPrice) : new BigNumber(0);
    const usdcBaseSign = usdcPoolBaseChange && usdcPoolBaseChange.isPositive() ? "+" : "";
    const usdcBaseChangeLine = `  USDC Pool Base:  ${usdcPoolBaseChange ? usdcBaseSign + formatTokenAmount(usdcPoolBaseChange) : "0"} tokens (${usdcBaseSign}${formatUSD(usdcBaseChangeUSD)})`;
    console.log("║" + usdcBaseChangeLine.padEnd(width) + "║");

    // USDC Pool Quote Change
    const usdcQuoteChangeUSD = usdcPoolQuoteChange ? usdcPoolQuoteChange.multipliedBy(suiPrice) : new BigNumber(0);
    const usdcQuoteSign = usdcPoolQuoteChange && usdcPoolQuoteChange.isPositive() ? "+" : "";
    const usdcQuoteChangeLine = `  USDC Pool Quote: ${usdcPoolQuoteChange ? usdcQuoteSign + formatTokenAmount(usdcPoolQuoteChange) : "0"} tokens (${usdcQuoteSign}${formatUSD(usdcQuoteChangeUSD)})`;
    console.log("║" + usdcQuoteChangeLine.padEnd(width) + "║");

    // Calculate total change in USD
    const totalChangeUSD = (suiPoolBaseChange?.multipliedBy(suiPrice) || new BigNumber(0))
      .plus(suiPoolQuoteChange?.multipliedBy(usdcPrice) || new BigNumber(0))
      .plus(usdcPoolBaseChange?.multipliedBy(usdcPrice) || new BigNumber(0))
      .plus(usdcPoolQuoteChange?.multipliedBy(suiPrice) || new BigNumber(0));
    
    const totalChangeSign = totalChangeUSD.isPositive() ? "+" : "";
    const totalChangeLine = `  Total Change: ${totalChangeSign}${formatUSD(totalChangeUSD)} USD`;
    console.log("║" + totalChangeLine.padEnd(width) + "║");
    console.log(border);
  } else {
    const noChangesLine = "  📈 POOL BALANCE CHANGES (Since Last Refresh)";
    console.log("║" + noChangesLine.padEnd(width) + "║");
    console.log(border);
    const firstRunLine = "  No previous data - changes will be shown on next refresh";
    console.log("║" + firstRunLine.padEnd(width) + "║");
    console.log(border);
  }

  // Display DAILY BOT VOLUME section (Sui)
  const suiVolumeTitle = "  📅 DAILY BOT VOLUME (UTC)";
  console.log("║" + suiVolumeTitle.padEnd(width) + "║");
  console.log(border);

  if (suiDailyVolumes.length === 0) {
    const noVolumeLine = "  No volume data available";
    console.log("║" + noVolumeLine.padEnd(width) + "║");
  } else {
    // Header
    const headerLine = `  Date         | Volume (USD)    | Transactions`;
    console.log("║" + headerLine.padEnd(width) + "║");
    console.log(border);
    
    // Display current day (index 0) first
    const today = suiDailyVolumes[0];
    const todayLabel = today.dateString === new Date().toISOString().split('T')[0] ? "Today" : today.dateString;
    const todayVolumeStr = formatUSD(today.volumeUSD);
    const todayLine = `  ${todayLabel.padEnd(12)} | ${todayVolumeStr.padStart(15)} | ${today.transactionCount.toString().padStart(4)} txns`;
    console.log("║" + todayLine.padEnd(width) + "║");
    
    // Display previous 4 days
    if (suiDailyVolumes.length > 1) {
      for (let i = 1; i < suiDailyVolumes.length; i++) {
        const day = suiDailyVolumes[i];
        const dayLabel = day.dateString;
        const dayVolumeStr = formatUSD(day.volumeUSD);
        const dayLine = `  ${dayLabel.padEnd(12)} | ${dayVolumeStr.padStart(15)} | ${day.transactionCount.toString().padStart(4)} txns`;
        console.log("║" + dayLine.padEnd(width) + "║");
      }
    }

    // Calculate total for all 5 days
    const totalVolume = suiDailyVolumes.reduce(
      (sum, day) => sum.plus(day.volumeUSD),
      new BigNumber(0)
    );
    const totalTxns = suiDailyVolumes.reduce(
      (sum, day) => sum + day.transactionCount,
      0
    );
    const totalVolumeStr = formatUSD(totalVolume);
    const totalLine = `  ${"Total (5 days)".padEnd(12)} | ${totalVolumeStr.padStart(15)} | ${totalTxns.toString().padStart(4)} txns`;
    console.log("║" + totalLine.padEnd(width) + "║");
  }
  console.log(border);

  // Add spacing between Sui and Archway sections
  console.log();
  console.log();

  // Display MONITORING DASHBOARD section (Archway/Bolt pools)
  if (monitoringData) {
    console.log(border);
    const monitoringTitle = "  🔍 BOLT PROTOCOL MONITORING (Archway)";
    console.log("║" + monitoringTitle.padEnd(width) + "║");
    console.log(border);

    // Prices section
    const pricesTitle = "  📊 PRICES";
    console.log("║" + pricesTitle.padEnd(width) + "║");
    console.log(border);

    if (monitoringData.prices.TIA > 0) {
      console.log(`║  TIA/USDC:  ${monitoringData.prices.TIA.toFixed(6).padEnd(width - 12)}║`);
    } else {
      console.log(`║  TIA/USDC:  (fetching price...)`.padEnd(width) + "║");
    }
    if (monitoringData.prices.INJ > 0) {
      console.log(`║  INJ/USDC:  ${monitoringData.prices.INJ.toFixed(6).padEnd(width - 12)}║`);
    } else {
      console.log(`║  INJ/USDC:  (fetching price...)`.padEnd(width) + "║");
    }
    if (monitoringData.prices.ATOM > 0) {
      console.log(`║  ATOM/USDC: ${monitoringData.prices.ATOM.toFixed(6).padEnd(width - 12)}║`);
    } else {
      console.log(`║  ATOM/USDC: (fetching price...)`.padEnd(width) + "║");
    }
    if (monitoringData.prices.OSMO > 0) {
      console.log(`║  OSMO/USDC: ${monitoringData.prices.OSMO.toFixed(6).padEnd(width - 12)}║`);
    } else {
      console.log(`║  OSMO/USDC: (fetching price...)`.padEnd(width) + "║");
    }
    if (monitoringData.prices.ARCH > 0) {
      console.log(`║  ARCH/USDC: ${monitoringData.prices.ARCH.toFixed(6).padEnd(width - 12)}║`);
    } else {
      console.log(`║  ARCH/USDC: (fetching price...)`.padEnd(width) + "║");
    }
    if (monitoringData.prices.WBTC > 0) {
      console.log(`║  WBTC/USDC: ${monitoringData.prices.WBTC.toFixed(2).padEnd(width - 12)}║`);
    } else {
      console.log(`║  WBTC/USDC: (fetching price...)`.padEnd(width) + "║");
    }
    if (monitoringData.prices.WETH > 0) {
      console.log(`║  WETH/USDC: ${monitoringData.prices.WETH.toFixed(2).padEnd(width - 12)}║`);
    } else {
      console.log(`║  WETH/USDC: (fetching price...)`.padEnd(width) + "║");
    }

    console.log(border);

    // Pool Balances (Base) section
    const baseTitle = "  💰 POOL BALANCES (Base)";
    console.log("║" + baseTitle.padEnd(width) + "║");
    console.log(border);

    for (const balance of monitoringData.baseBalances) {
      const padding = ' '.repeat(Math.max(0, 6 - balance.name.length));
      if (balance.usdValue > 0) {
        const line = `${balance.name}${padding} | ${balance.amount.toFixed(6)} tokens = $${balance.usdValue.toFixed(2)} USD`;
        console.log(`║  ${line.padEnd(width - 2)}║`);
      } else {
        const line = `${balance.name}${padding} | ${balance.amount.toFixed(6)} tokens (price unavailable)`;
        console.log(`║  ${line.padEnd(width - 2)}║`);
      }
    }

    console.log(border);

    // Pool Balances (Quote) section
    const quoteTitle = "  💰 POOL BALANCES (Quote)";
    console.log("║" + quoteTitle.padEnd(width) + "║");
    console.log(border);

    for (const balance of monitoringData.quoteBalances) {
      const padding = ' '.repeat(Math.max(0, 6 - balance.name.length));
      const line = `${balance.name}${padding} | USDC: ${balance.amount.toFixed(6)} tokens = $${balance.usdValue.toFixed(2)} USD`;
      console.log(`║  ${line.padEnd(width - 2)}║`);
    }

    console.log(border);

    // USDC Balances (quote) section
    const usdcQuoteTitle = "  💵 USDC BALANCES (quote)";
    console.log("║" + usdcQuoteTitle.padEnd(width) + "║");
    console.log(border);

    if (monitoringData.usdcPoolQuoteBalances.length > 0) {
      for (const balance of monitoringData.usdcPoolQuoteBalances) {
        const padding = ' '.repeat(Math.max(0, 6 - balance.name.length));
        if (balance.usdValue > 0) {
          const line = `${balance.name}${padding} | ${balance.amount.toFixed(6)} tokens = $${balance.usdValue.toFixed(2)} USD`;
          console.log(`║  ${line.padEnd(width - 2)}║`);
        } else {
          const line = `${balance.name}${padding} | ${balance.amount.toFixed(6)} tokens (price unavailable)`;
          console.log(`║  ${line.padEnd(width - 2)}║`);
        }
      }
    } else {
      console.log(`║  (No assets found in USDC pool)`.padEnd(width) + "║");
    }

    console.log(border);

    // Total Pool Liquidity
    const totalLiquidityLine = `  💵 Total Pool Liquidity: $${monitoringData.totalUsdValue.toFixed(2)} USD`;
    console.log("║" + totalLiquidityLine.padEnd(width) + "║");
    console.log(border);
  } else {
    const monitoringTitle = "  🔍 BOLT PROTOCOL MONITORING (Archway)";
    console.log("║" + monitoringTitle.padEnd(width) + "║");
    console.log(border);
    const noDataLine = "  Monitoring data unavailable";
    console.log("║" + noDataLine.padEnd(width) + "║");
    console.log(border);
  }

  console.log(bottom);
}

function formatTokenAmount(amount: BigNumber): string {
  // Amount is already in token units (from fraction parsing), just format it
  if (amount.isLessThan(0.01)) {
    return amount.toFixed(6);
  } else if (amount.isLessThan(1)) {
    return amount.toFixed(4);
  } else {
    return amount.toFixed(2);
  }
}

function formatUSD(amount: BigNumber): string {
  return `$${amount.toFixed(2)}`;
}

