import dotenv from "dotenv";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { getWorkingDirectory } from "../utils";

import type { Config } from "./types";

export const loadConfigWithEnvOverrides = async (
  configFilePath?: string,
  envFilePath?: string
): Promise<{ config: Config; configFilePath: string }> => {
  // Get config path
  const workingDir = await getWorkingDirectory();
  const finalConfigFilePath =
    configFilePath ?? path.join(workingDir, "config.json");

  // Try to load default config, but don't fail if it doesn't exist
  let defaultConfig: Config | null = null;
  let configFileExists = false;

  try {
    if (existsSync(finalConfigFilePath)) {
      configFileExists = true;
      const configContent = await fs.readFile(finalConfigFilePath, "utf-8");

      defaultConfig = JSON.parse(configContent) as Config;
      console.log("Loaded config from file:", finalConfigFilePath);
    } else {
      console.log(
        "Config file not found at:",
        finalConfigFilePath,
        "- will use environment variables"
      );
    }
  } catch (error) {
    console.warn(
      "Error reading config file:",
      error,
      "- will use environment variables"
    );
  }

  // Load environment variables using dotenv.parse
  let envVars: Record<string, string> = {};

  // First, try to load from .env file if it exists
  const envPath = envFilePath || path.join(workingDir, ".env");
  console.log("Checking for .env file at:", envPath);

  if (existsSync(envPath)) {
    console.log(".env file exists, loading...");
    try {
      const envContent = await fs.readFile(envPath, "utf-8");
      envVars = dotenv.parse(envContent);
    } catch (error) {
      console.warn("Error reading .env file:", error);
    }
  }

  // Process.env takes precedence over .env file
  const finalEnvVars = { ...envVars, ...process.env };

  // Build config from environment variables and defaults
  const config: Config = {
    rebalanceThresholdPercent: finalEnvVars.REBALANCE_THRESHOLD_PERCENT
      ? parseFloat(finalEnvVars.REBALANCE_THRESHOLD_PERCENT)
      : defaultConfig?.rebalanceThresholdPercent ?? 0,
    poolId: finalEnvVars.POOL_ID || defaultConfig?.poolId || "",
    positionId: defaultConfig?.positionId || "",
    positionBandPercentage: finalEnvVars.POSITION_BAND_PERCENTAGE
      ? parseFloat(finalEnvVars.POSITION_BAND_PERCENTAGE)
      : defaultConfig?.positionBandPercentage ?? 0,
    chain:
      finalEnvVars.CHAIN === "osmosis" || finalEnvVars.CHAIN === "sui"
        ? finalEnvVars.CHAIN
        : defaultConfig?.chain ?? "osmosis",
  };

  // Validate required configuration
  const missingFields: string[] = [];

  if (!config.poolId) {
    missingFields.push("Config: poolId | Env Variable: POOL_ID");
  }

  if (
    config.rebalanceThresholdPercent === 0 &&
    !finalEnvVars.REBALANCE_THRESHOLD_PERCENT
  ) {
    missingFields.push(
      "Config: rebalanceThresholdPercent | Env Variable: REBALANCE_THRESHOLD_PERCENT"
    );
  }

  if (
    config.positionBandPercentage === 0 &&
    !finalEnvVars.POSITION_BAND_PERCENTAGE
  ) {
    missingFields.push(
      "Config: positionBandPercentage | Env Variable: POSITION_BAND_PERCENTAGE"
    );
  }

  if (missingFields.length > 0) {
    throw new Error(
      `Missing required configuration. ` +
        `Config file ${configFileExists ? "was found but" : "not found and"} ` +
        `the following required fields are missing from both the config file environment variables:\n` +
        missingFields.map((field) => `  - ${field}`).join("\n")
    );
  }

  // Save config to file if it doesn't exist or if it changed
  try {
    if (
      !configFileExists ||
      (defaultConfig &&
        JSON.stringify(config) !== JSON.stringify(defaultConfig))
    ) {
      await fs.writeFile(
        finalConfigFilePath,
        JSON.stringify(config, undefined, 2),
        "utf-8"
      );
      console.log(
        configFileExists
          ? "Config file updated with environment variable overrides"
          : "Created new config file from environment variables"
      );
    }
  } catch (error) {
    console.warn("Warning: Could not write config file:", error);
    console.log("Continuing with in-memory configuration");
  }

  return { config, configFilePath: finalConfigFilePath };
};
