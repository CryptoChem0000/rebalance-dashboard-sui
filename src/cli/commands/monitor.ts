import { Command } from "commander";
import { BoltGrpcClient } from "../../monitoring/bolt-grpc-client";
import { PriceService } from "../../monitoring/price-service";
import BigNumber from "bignumber.js";

const SUI_POOL_ID = "0x21167b2e981e2c0a693afcfe882a3a827d663118e19afcb92e45bfe43fe56278";
const USDC_POOL_ID = "0x34fcaa553f1185e1c3a05de37b6a4d10c39535d19f9c8581eeae826434602b58";

export function monitorCommand(program: Command) {
  program
    .command("monitor")
    .description("Monitor pool balances for SUI and USDC pools")
    .option(
      "--refresh <seconds>",
      "Auto-refresh interval in seconds (default: no auto-refresh)",
      "0"
    )
    .option("--endpoint <endpoint>", "Bolt gRPC endpoint", "144.76.3.52:50063")
    .option("--debug", "Show debug information including raw responses")
    .action(async (options) => {
      const refreshInterval = parseInt(options.refresh, 10);

      const displayDashboard = async () => {
        try {
          // Clear screen for clean display
          if (refreshInterval > 0) {
            console.clear();
          }

          const grpcClient = new BoltGrpcClient(options.endpoint);
          const priceService = new PriceService();

          // Fetch pool data and prices
          if (!options.debug) {
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

          // Display formatted dashboard
          displayFormattedDashboard(suiPool, usdcPool, tokenPrices);

          // Display timestamp
          if (refreshInterval > 0) {
            console.log(`\nLast updated: ${new Date().toLocaleString()} | Auto-refresh: ${refreshInterval}s`);
          } else {
            console.log(`\nLast updated: ${new Date().toLocaleString()}`);
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
  tokenPrices: Map<string, BigNumber>
) {
  const width = 78;
  const border = "╠" + "═".repeat(width) + "╣";
  const bottom = "╚" + "═".repeat(width) + "╝";

  // Get prices
  const suiPrice = tokenPrices.get("sui") || new BigNumber(0);
  const usdcPrice = tokenPrices.get("usdc") || new BigNumber(1);

  // Parse pool data
  // SUI Pool: Base = SUI, Quote = USDC
  const suiPoolBaseAmount = BoltGrpcClient.parseFractionToBigNumber(suiPool.baseAmount);
  const suiPoolQuoteAmount = suiPool.quoteAssets && suiPool.quoteAssets.length > 0
    ? BoltGrpcClient.parseFractionToBigNumber(suiPool.quoteAssets[0].amount)
    : new BigNumber(0);
  const suiPoolBaseUSD = suiPoolBaseAmount.multipliedBy(suiPrice);
  const suiPoolQuoteUSD = suiPoolQuoteAmount.multipliedBy(usdcPrice);

  // USDC Pool: Base = USDC, Quote = SUI
  const usdcPoolBaseAmount = BoltGrpcClient.parseFractionToBigNumber(usdcPool.baseAmount);
  const usdcPoolQuoteAmount = usdcPool.quoteAssets && usdcPool.quoteAssets.length > 0
    ? BoltGrpcClient.parseFractionToBigNumber(usdcPool.quoteAssets[0].amount)
    : new BigNumber(0);
  const usdcPoolBaseUSD = usdcPoolBaseAmount.multipliedBy(usdcPrice);
  const usdcPoolQuoteUSD = usdcPoolQuoteAmount.multipliedBy(suiPrice);

  // Calculate total liquidity
  const totalLiquidity = suiPoolBaseUSD
    .plus(suiPoolQuoteUSD)
    .plus(usdcPoolBaseUSD)
    .plus(usdcPoolQuoteUSD);

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
  
  const usdcBaseLine = `  USDC   | ${formatTokenAmount(usdcPoolBaseAmount)} tokens = ${formatUSD(usdcPoolBaseUSD)} USD`;
  const suiBaseLine = `  SUI    | ${formatTokenAmount(suiPoolBaseAmount)} tokens = ${formatUSD(suiPoolBaseUSD)} USD`;
  
  console.log("║" + usdcBaseLine.padEnd(width) + "║");
  console.log("║" + suiBaseLine.padEnd(width) + "║");
  console.log(border);

  // Display POOL BALANCES (Quote) section
  const quoteTitle = "  POOL BALANCES (Quote)";
  console.log("║" + quoteTitle.padEnd(width) + "║");
  console.log(border);
  
  const suiQuoteLine = `  SUI    | USDC: ${formatTokenAmount(suiPoolQuoteAmount)} tokens = ${formatUSD(suiPoolQuoteUSD)} USD`;
  const usdcQuoteLine = `  USDC   | SUI: ${formatTokenAmount(usdcPoolQuoteAmount)} tokens = ${formatUSD(usdcPoolQuoteUSD)} USD`;
  
  console.log("║" + suiQuoteLine.padEnd(width) + "║");
  console.log("║" + usdcQuoteLine.padEnd(width) + "║");
  console.log(border);

  // Display Total Pool Liquidity
  const totalLine = `  💵 Total Pool Liquidity: ${formatUSD(totalLiquidity)} USD`;
  console.log("║" + totalLine.padEnd(width) + "║");
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

