import { DatabaseQueryClient } from "../../database";
import { simpleGracefulShutdown } from "./graceful-shutdown";
import { DEFAULT_KEY_NAME, KeyManager, KeyStoreType } from "../../key-manager";
import { loadConfigWithEnvOverrides } from "../../liquidity-manager";
import { Logger } from "./logger";
import { findArchwayChainInfo, findOsmosisChainInfo } from "../../registry";

export const withErrorHandling = (fn: Function) => {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (error: any) {
      console.error("\n❌ Error:", error?.message);
      console.error(error);
      process.exit(1);
    }
  };
};

export const withLogger = async (
  options: any,
  callback: (logger: Logger) => Promise<void>
) => {
  const logger = new Logger(options.logFile);

  try {
    if (!!options.log) {
      await logger.initialize();
      console.log(`📝 Logging to: ${logger.getLogPath()}`);
    }

    await callback(logger);
  } finally {
    logger.close();
  }
};

export const withDatabase = (
  options: any,
  callback: (db: DatabaseQueryClient) => Promise<void>
) => {
  return simpleGracefulShutdown(async () => {
    let dbQueryClient: DatabaseQueryClient | undefined;

    const { config } = await loadConfigWithEnvOverrides(options.configFile);

    try {
      dbQueryClient = await DatabaseQueryClient.make({
        environment: options.environment,
        chain: config.chain,
      });

      await callback(dbQueryClient);
    } finally {
      dbQueryClient?.close();
    }
  });
};

export const formatDateRange = (startDate?: Date, endDate?: Date) => {
  if (startDate || endDate) {
    console.log(
      `📅 Date range: ${
        startDate ? startDate.toLocaleDateString() : "All"
      } to ${endDate ? endDate.toLocaleDateString() : "Now"}\n`
    );
  }
};

export const displayTransactionDetails = (tx: any, index: number) => {
  console.log(
    `${index + 1}. ${new Date((tx.timestamp || 0) * 1000).toLocaleString()}`
  );
  console.log(`   Type: ${tx.transactionType}`);
  console.log(`   Chain: ${tx.chainId}`);
  console.log(`   Hash: ${tx.txHash}`);
  console.log(`   Status: ${tx.successful ? "✅ Success" : "❌ Failed"}`);

  if (tx.inputTokenName && tx.inputAmount) {
    console.log(`   Input: ${tx.inputAmount} ${tx.inputTokenName}`);
  }
  if (tx.secondInputTokenName && tx.secondInputAmount) {
    console.log(
      `   Second Input: ${tx.secondInputAmount} ${tx.secondInputTokenName}`
    );
  }
  if (tx.outputTokenName && tx.outputAmount) {
    console.log(`   Output: ${tx.outputAmount} ${tx.outputTokenName}`);
  }
  if (tx.secondOutputTokenName && tx.secondOutputAmount) {
    console.log(
      `   Second Output: ${tx.secondOutputAmount} ${tx.secondOutputTokenName}`
    );
  }
  if (tx.gasFeeAmount && tx.gasFeeTokenName) {
    console.log(`   Gas: ${tx.gasFeeAmount} ${tx.gasFeeTokenName}`);
  }
  if (tx.destinationAddress) {
    console.log(`   Destination: ${tx.destinationAddress}`);
  }
  if (!tx.successful && tx.error) {
    console.log(`   Error: ${tx.error}`);
  }
  console.log();
};

export const getOsmosisAddress = async (
  keyStoreType = KeyStoreType.ENV_VARIABLE,
  environment: "mainnet" | "testnet" = "mainnet"
): Promise<string> => {
  const keyStore = await KeyManager.create({
    type: keyStoreType,
  });
  return await keyStore.getCosmWasmAddress(
    DEFAULT_KEY_NAME,
    findOsmosisChainInfo(environment).prefix
  );
};

export const getArchwayAddress = async (
  keyStoreType = KeyStoreType.ENV_VARIABLE,
  environment: "mainnet" | "testnet" = "mainnet"
): Promise<string> => {
  const keyStore = await KeyManager.create({
    type: keyStoreType,
  });
  return await keyStore.getCosmWasmAddress(
    DEFAULT_KEY_NAME,
    findArchwayChainInfo(environment).prefix
  );
};

export const getSuiAddress = async (
  keyStoreType = KeyStoreType.ENV_VARIABLE
): Promise<string> => {
  const keyStore = await KeyManager.create({
    type: keyStoreType,
  });
  return await keyStore.getSuiAddress(DEFAULT_KEY_NAME);
};
