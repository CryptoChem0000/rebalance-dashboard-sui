import { Command } from "commander";
import { BoltGrpcClient } from "../../monitoring/bolt-grpc-client";
import { PriceService } from "../../monitoring/price-service";
import BigNumber from "bignumber.js";
import { TransactionType } from "../../database/types";
import { SQLiteTransactionRepository, PostgresTransactionRepository } from "../../database";
import { getSignerAddress } from "../../utils";
import { KeyManager, KeyStoreType, DEFAULT_SUI_KEY_NAME } from "../../key-manager";
import { findSuiChainInfo } from "../../registry";

const SUI_POOL_ID = "0x21167b2e981e2c0a693afcfe882a3a827d663118e19afcb92e45bfe43fe56278";
const USDC_POOL_ID = "0x34fcaa553f1185e1c3a05de37b6a4d10c39535d19f9c8581eeae826434602b58";

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

          // Display formatted dashboard
          displayFormattedDashboard(
            suiPool,
            usdcPool,
            tokenPrices,
            swapBuyBreakdown,
            previousBalances,
            currentBalances
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

function displayFormattedDashboard(
  suiPool: any,
  usdcPool: any,
  tokenPrices: Map<string, BigNumber>,
  swapBuyBreakdown: SwapBuyBreakdown[],
  previousBalances: PoolBalances | null,
  currentBalances: PoolBalances
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

  // Display PRICES section
  console.log(border);
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

    // SUI Pool Base Change
    if (suiPoolBaseChange) {
      const changeUSD = suiPoolBaseChange.multipliedBy(suiPrice);
      const sign = suiPoolBaseChange.isPositive() ? "+" : "";
      const suiBaseChangeLine = `  SUI Pool Base:   ${sign}${formatTokenAmount(suiPoolBaseChange)} tokens (${sign}${formatUSD(changeUSD)})`;
      console.log("║" + suiBaseChangeLine.padEnd(width) + "║");
    }

    // SUI Pool Quote Change
    if (suiPoolQuoteChange) {
      const changeUSD = suiPoolQuoteChange.multipliedBy(usdcPrice);
      const sign = suiPoolQuoteChange.isPositive() ? "+" : "";
      const suiQuoteChangeLine = `  SUI Pool Quote:  ${sign}${formatTokenAmount(suiPoolQuoteChange)} tokens (${sign}${formatUSD(changeUSD)})`;
      console.log("║" + suiQuoteChangeLine.padEnd(width) + "║");
    }

    // USDC Pool Base Change
    if (usdcPoolBaseChange) {
      const changeUSD = usdcPoolBaseChange.multipliedBy(usdcPrice);
      const sign = usdcPoolBaseChange.isPositive() ? "+" : "";
      const usdcBaseChangeLine = `  USDC Pool Base:  ${sign}${formatTokenAmount(usdcPoolBaseChange)} tokens (${sign}${formatUSD(changeUSD)})`;
      console.log("║" + usdcBaseChangeLine.padEnd(width) + "║");
    }

    // USDC Pool Quote Change
    if (usdcPoolQuoteChange) {
      const changeUSD = usdcPoolQuoteChange.multipliedBy(suiPrice);
      const sign = usdcPoolQuoteChange.isPositive() ? "+" : "";
      const usdcQuoteChangeLine = `  USDC Pool Quote: ${sign}${formatTokenAmount(usdcPoolQuoteChange)} tokens (${sign}${formatUSD(changeUSD)})`;
      console.log("║" + usdcQuoteChangeLine.padEnd(width) + "║");
    }

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

