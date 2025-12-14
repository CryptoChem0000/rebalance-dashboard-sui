import { BoltGrpcClient, Pool } from "./bolt-grpc-client";
import { BoltSuiClient } from "@bolt-liquidity-hq/sui-client";
import { SuiClient } from "@mysten/sui/client";
import BigNumber from "bignumber.js";
import axios from "axios";

export interface TokenPrice {
  denom: string;
  price: BigNumber;
}

export interface PoolMetrics {
  pool: Pool;
  tokenPrices: Map<string, BigNumber>;
  totalValueUSD: BigNumber;
  tokenBalances: Array<{
    denom: string;
    amount: BigNumber;
    valueUSD: BigNumber;
  }>;
}

export class PriceService {
  private grpcClient: BoltGrpcClient;
  private boltSuiClient: BoltSuiClient;
  private suiClient: SuiClient;
  private readonly PRICE_FEEDER_CAP_ID = "0x4c702ac2b2c9f756dd6b5cd444b800de8f47695ada779b77fc7b553d21fb511d";

  constructor() {
    this.grpcClient = new BoltGrpcClient();
    this.boltSuiClient = new BoltSuiClient();
    this.suiClient = new SuiClient({ url: "https://fullnode.mainnet.sui.io:443" });
  }

  /**
   * Get current price for a token from Bolt pool data
   * Price is calculated from the pool's base and quote assets
   */
  async getTokenPriceFromPool(
    poolIdentifier: string,
    tokenDenom: string
  ): Promise<BigNumber> {
    try {
      const response = await this.grpcClient.getPool(poolIdentifier);
      const pool = response.pool;

      // Parse base amount
      const baseAmount = BoltGrpcClient.parseFractionToBigNumber(pool.baseAmount);
      
      // Find the quote asset that matches the token we're looking for
      const quoteAsset = pool.quoteAssets.find(
        (qa) => qa.denom.toLowerCase() === tokenDenom.toLowerCase()
      );

      // If we're looking for the base asset
      if (pool.baseAsset.toLowerCase() === tokenDenom.toLowerCase()) {
        // We need to find a quote asset to calculate price
        if (pool.quoteAssets.length > 0) {
          const firstQuote = pool.quoteAssets[0];
          const quoteAmount = BoltGrpcClient.parseFractionToBigNumber(firstQuote.amount);
          
          // Price = quoteAmount / baseAmount (how much quote per base)
          if (baseAmount.isZero()) {
            return new BigNumber(0);
          }
          return quoteAmount.dividedBy(baseAmount);
        }
      } else if (quoteAsset) {
        // We're looking for a quote asset
        const quoteAmount = BoltGrpcClient.parseFractionToBigNumber(quoteAsset.amount);
        
        // Price = baseAmount / quoteAmount (how much base per quote)
        if (quoteAmount.isZero()) {
          return new BigNumber(0);
        }
        return baseAmount.dividedBy(quoteAmount);
      }

      return new BigNumber(0);
    } catch (error) {
      throw new Error(
        `Failed to get price for ${tokenDenom} from pool ${poolIdentifier}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get prices for both SUI and USDC
   * Primary: CoinGecko free API (most reliable for SUI price)
   * Fallback: Price feeder, Bolt's getPrice(), or pool reserves
   */
  async getTokenPrices(): Promise<Map<string, BigNumber>> {
    const prices = new Map<string, BigNumber>();

    // Primary: Use CoinGecko as the default source for SUI price
    try {
      await this.fetchPricesFromCoinGecko(prices);
      
      // If we got both prices from CoinGecko, return early
      if (prices.has("sui") && prices.has("usdc")) {
        return prices;
      }
    } catch (coingeckoError) {
      console.warn(
        `Warning: Could not fetch prices from CoinGecko: ${
          coingeckoError instanceof Error ? coingeckoError.message : "Unknown error"
        }`
      );
    }

    // Fallback 1: Try price feeder
    if (!prices.has("sui")) {
      try {
        await this.fetchPriceFromPriceFeeder(prices);
        if (prices.has("sui")) {
          return prices;
        }
      } catch (priceFeederError) {
        console.warn(
          `Warning: Could not fetch prices from price feeder: ${
            priceFeederError instanceof Error ? priceFeederError.message : "Unknown error"
          }`
        );
      }
    }

    // Fallback 2: Try Bolt's getPrice() method
    if (!prices.has("sui")) {
      try {
        // Get SUI/USDC price from Bolt's price feed
        // Using the standard SUI and USDC type tags
        const suiTypeTag = "0x2::sui::SUI";
        const usdcTypeTag = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
        
        const priceResult = await this.boltSuiClient.getPrice(suiTypeTag, usdcTypeTag);
      
        // The price result should contain a price field
        // For SUI/USDC pair, the price represents USDC per SUI (i.e., SUI price in USDC/USD)
        // The price might be in different formats or units, so we handle various cases
        let suiPriceInUsdc: BigNumber;
        
        if (typeof priceResult.price === 'string') {
          suiPriceInUsdc = new BigNumber(priceResult.price);
        } else if (typeof priceResult.price === 'number') {
          suiPriceInUsdc = new BigNumber(priceResult.price);
        } else {
          // If price is in a different format, try to extract it
          const priceValue = (priceResult as any).price || (priceResult as any).value || priceResult;
          suiPriceInUsdc = new BigNumber(priceValue);
        }
        
        // Handle different price formats from Bolt
        // If price is very small (< 0.01), it might be in base units or inverted
        // Try to normalize it
        if (suiPriceInUsdc.isPositive() && suiPriceInUsdc.isLessThan(0.01)) {
          // Price might be inverted (1/price) or in base units
          // Try inverting first (common in some AMM formats)
          const invertedPrice = new BigNumber(1).dividedBy(suiPriceInUsdc);
          if (invertedPrice.isGreaterThan(0.01) && invertedPrice.isLessThan(1000)) {
            suiPriceInUsdc = invertedPrice;
          } else {
            // If still too small, might be in base units - multiply by 10^9 for SUI
            const scaledPrice = suiPriceInUsdc.multipliedBy(new BigNumber(10).pow(9));
            if (scaledPrice.isGreaterThan(0.01) && scaledPrice.isLessThan(1000)) {
              suiPriceInUsdc = scaledPrice;
            } else {
              throw new Error(`Price value ${suiPriceInUsdc.toString()} appears to be in an unexpected format`);
            }
          }
        }
        
        // Ensure the price is positive and reasonable (between $0.01 and $1000)
        if (suiPriceInUsdc.isPositive() && suiPriceInUsdc.isLessThan(1000) && suiPriceInUsdc.isGreaterThan(0.01)) {
          prices.set("sui", suiPriceInUsdc);
        } else {
          throw new Error(`Invalid price value: ${suiPriceInUsdc.toString()} (expected between 0.01 and 1000)`);
        }
        
        // USDC is always $1
        if (!prices.has("usdc")) {
          prices.set("usdc", new BigNumber(1));
        }
        
        // If we got SUI price from Bolt, return
        if (prices.has("sui")) {
          return prices;
        }
      } catch (error) {
        console.warn(
          `Warning: Could not fetch prices from Bolt price feed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
        
        // Fallback 3: try to calculate from pool reserves (less accurate)
        if (!prices.has("sui")) {
          try {
            const suiPoolResponse = await this.grpcClient.getPool(
              "0x21167b2e981e2c0a693afcfe882a3a827d663118e19afcb92e45bfe43fe56278"
            );
            const suiPool = suiPoolResponse.pool;
            
            if (suiPool.quoteAssets.length > 0 && suiPool.quoteAssets[0].denom === "USDC") {
              const suiAmount = BoltGrpcClient.parseFractionToBigNumber(suiPool.baseAmount);
              const usdcAmount = BoltGrpcClient.parseFractionToBigNumber(suiPool.quoteAssets[0].amount);
              
              if (!suiAmount.isZero()) {
                const suiPriceInUsdc = usdcAmount.dividedBy(suiAmount);
                prices.set("sui", suiPriceInUsdc);
              }
            }
          } catch (poolError) {
            console.warn(`Pool-based price calculation failed: ${poolError instanceof Error ? poolError.message : "Unknown error"}`);
          }
        }
      }
    }

    // Ensure USDC is set (should always be $1)
    if (!prices.has("usdc")) {
      prices.set("usdc", new BigNumber(1));
    }

    // If we still don't have SUI price after all fallbacks, throw an error
    if (!prices.has("sui")) {
      throw new Error(
        `Failed to fetch SUI price from all sources: CoinGecko, price feeder, Bolt, and pool reserves`
      );
    }

    return prices;
  }

  /**
   * Fetch price from the price feeder cap object on Sui
   * The price feeder cap contains the current SUI/USDC price
   */
  private async fetchPriceFromPriceFeeder(prices: Map<string, BigNumber>): Promise<void> {
    try {
      // Query the price feeder cap object
      const object = await this.suiClient.getObject({
        id: this.PRICE_FEEDER_CAP_ID,
        options: {
          showContent: true,
          showType: true,
        },
      });

      if (!object.data || !object.data.content) {
        throw new Error("Price feeder object not found or has no content");
      }

      // The object content structure depends on the price feeder implementation
      // Common fields: price, value, latest_price, etc.
      const content = object.data.content as any;
      const fields = content.fields || {};

      // Try to extract price from various possible field names
      let priceValue: BigNumber | null = null;

      // Common field names for price
      const possiblePriceFields = [
        "price",
        "value",
        "latest_price",
        "current_price",
        "price_value",
        "sui_price",
        "price_usdc",
      ];

      for (const fieldName of possiblePriceFields) {
        if (fields[fieldName]) {
          const value = fields[fieldName];
          // Handle different value types
          if (typeof value === "string") {
            priceValue = new BigNumber(value);
            break;
          } else if (typeof value === "number") {
            priceValue = new BigNumber(value);
            break;
          } else if (value && typeof value === "object") {
            // Might be nested, try to extract
            const nestedValue = value.value || value.price || value;
            if (typeof nestedValue === "string" || typeof nestedValue === "number") {
              priceValue = new BigNumber(nestedValue);
              break;
            }
          }
        }
      }

      // If we found a price value, validate and set it
      if (priceValue && priceValue.isPositive()) {
        // Price might be in different units, normalize it
        // If price is very small, it might need scaling
        if (priceValue.isLessThan(0.01)) {
          // Try scaling by 10^9 (common for Sui base units)
          const scaled = priceValue.multipliedBy(new BigNumber(10).pow(9));
          if (scaled.isGreaterThan(0.01) && scaled.isLessThan(1000)) {
            priceValue = scaled;
          } else {
            // Try inverting
            const inverted = new BigNumber(1).dividedBy(priceValue);
            if (inverted.isGreaterThan(0.01) && inverted.isLessThan(1000)) {
              priceValue = inverted;
            }
          }
        }

        // Validate price is in reasonable range
        if (
          priceValue.isPositive() &&
          priceValue.isGreaterThan(0.01) &&
          priceValue.isLessThan(1000)
        ) {
          prices.set("sui", priceValue);
        } else {
          throw new Error(
            `Price value ${priceValue.toString()} is outside expected range (0.01-1000)`
          );
        }
      } else {
        // Try to parse from the entire object structure
        const objectStr = JSON.stringify(fields);
        // Look for numeric values that might be the price
        const numbers = objectStr.match(/\d+\.?\d*/g);
        if (numbers && numbers.length > 0) {
          for (const numStr of numbers) {
            const num = new BigNumber(numStr);
            if (num.isGreaterThan(0.5) && num.isLessThan(10)) {
              // Likely the price
              prices.set("sui", num);
              break;
            }
          }
        }

        if (!prices.has("sui")) {
          throw new Error(
            `Could not extract price from price feeder object. Object structure: ${JSON.stringify(fields, null, 2)}`
          );
        }
      }

      // USDC is always $1
      prices.set("usdc", new BigNumber(1));
    } catch (error) {
      throw new Error(
        `Failed to fetch price from price feeder: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Fetch prices from CoinGecko free API
   * Coin IDs: sui (for SUI), usd-coin (for USDC)
   */
  private async fetchPricesFromCoinGecko(prices: Map<string, BigNumber>): Promise<void> {
    try {
      // CoinGecko free API endpoint for simple price lookup
      // Using the /simple/price endpoint which doesn't require an API key
      const response = await axios.get(
        "https://api.coingecko.com/api/v3/simple/price",
        {
          params: {
            ids: "sui,usd-coin",
            vs_currencies: "usd",
          },
          timeout: 5000, // 5 second timeout
        }
      );

      const data = response.data;

      // Extract SUI price
      if (data.sui && data.sui.usd) {
        const suiPrice = new BigNumber(data.sui.usd);
        if (suiPrice.isPositive() && suiPrice.isLessThan(1000) && suiPrice.isGreaterThan(0.01)) {
          prices.set("sui", suiPrice);
        }
      }

      // Extract USDC price (should be close to $1)
      if (data["usd-coin"] && data["usd-coin"].usd) {
        const usdcPrice = new BigNumber(data["usd-coin"].usd);
        if (usdcPrice.isPositive() && usdcPrice.isLessThan(2)) {
          prices.set("usdc", usdcPrice);
        } else {
          // USDC should be ~$1, if it's way off, default to 1
          prices.set("usdc", new BigNumber(1));
        }
      } else {
        // USDC is typically $1
        prices.set("usdc", new BigNumber(1));
      }
    } catch (error) {
      throw new Error(
        `CoinGecko API error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Calculate pool metrics with prices
   */
  async getPoolMetrics(poolIdentifier: string): Promise<PoolMetrics> {
    const response = await this.grpcClient.getPool(poolIdentifier);
    const pool = response.pool;

    // Get token prices
    const tokenPrices = await this.getTokenPrices();

    // Calculate metrics for each token
    const tokenBalances: Array<{
      denom: string;
      amount: BigNumber;
      valueUSD: BigNumber;
    }> = [];

    // Add base asset
    const baseAmount = BoltGrpcClient.parseFractionToBigNumber(pool.baseAmount);
    const basePrice = tokenPrices.get(pool.baseAsset.toLowerCase()) || new BigNumber(0);
    tokenBalances.push({
      denom: pool.baseAsset,
      amount: baseAmount,
      valueUSD: baseAmount.multipliedBy(basePrice),
    });

    // Add quote assets
    pool.quoteAssets.forEach((qa) => {
      const quoteAmount = BoltGrpcClient.parseFractionToBigNumber(qa.amount);
      const quotePrice = tokenPrices.get(qa.denom.toLowerCase()) || new BigNumber(0);
      tokenBalances.push({
        denom: qa.denom,
        amount: quoteAmount,
        valueUSD: quoteAmount.multipliedBy(quotePrice),
      });
    });

    // Calculate total value
    const totalValueUSD = tokenBalances.reduce(
      (sum, tb) => sum.plus(tb.valueUSD),
      new BigNumber(0)
    );

    return {
      pool,
      tokenPrices,
      totalValueUSD,
      tokenBalances,
    };
  }
}
