import dotenv from "dotenv";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { getWorkingDirectory } from "../utils";

import type { Config } from "./types";

export const loadConfigWithEnvOverrides = async (
  envFilePath?: string
): Promise<{ config: Config; configPath: string }> => {
  // Get config path
  const workingDir = await getWorkingDirectory();
  const configPath = path.join(workingDir, "config.json");

  // Load default config
  const configContent = await fs.readFile(configPath, "utf-8");
  const defaultConfig = JSON.parse(configContent) as Config;

  // Load environment variables using dotenv.parse
  let envVars: Record<string, string> = {};

  // First, try to load from .env file if it exists
  const envPath = envFilePath || path.join(workingDir, ".env");
  if (existsSync(envPath)) {
    const envContent = await fs.readFile(envPath, "utf-8");
    envVars = dotenv.parse(envContent);
  }

  // Process.env takes precedence over .env file
  const finalEnvVars = { ...envVars, ...process.env };

  // Apply environment variable overrides
  const config: Config = {
    rebalanceThresholdPercent: finalEnvVars.REBALANCE_THRESHOLD_PERCENT
      ? parseFloat(finalEnvVars.REBALANCE_THRESHOLD_PERCENT)
      : defaultConfig.rebalanceThresholdPercent,

    osmosisPool: {
      id: finalEnvVars.OSMOSIS_POOL_ID || defaultConfig.osmosisPool.id,
      // If pool ID changed via env, clear the auto-filled fields
      token0:
        finalEnvVars.OSMOSIS_POOL_ID &&
        finalEnvVars.OSMOSIS_POOL_ID !== defaultConfig.osmosisPool.id
          ? ""
          : defaultConfig.osmosisPool.token0,
      token1:
        finalEnvVars.OSMOSIS_POOL_ID &&
        finalEnvVars.OSMOSIS_POOL_ID !== defaultConfig.osmosisPool.id
          ? ""
          : defaultConfig.osmosisPool.token1,
      tickSpacing:
        finalEnvVars.OSMOSIS_POOL_ID &&
        finalEnvVars.OSMOSIS_POOL_ID !== defaultConfig.osmosisPool.id
          ? 0
          : defaultConfig.osmosisPool.tickSpacing,
      spreadFactor:
        finalEnvVars.OSMOSIS_POOL_ID &&
        finalEnvVars.OSMOSIS_POOL_ID !== defaultConfig.osmosisPool.id
          ? 0
          : defaultConfig.osmosisPool.spreadFactor,
    },

    osmosisPosition: {
      id: defaultConfig.osmosisPosition.id,
      bandPercentage: finalEnvVars.OSMOSIS_POSITION_BAND_PERCENTAGE
        ? parseFloat(finalEnvVars.OSMOSIS_POSITION_BAND_PERCENTAGE)
        : defaultConfig.osmosisPosition.bandPercentage,
    },
  };

  // Check if config changed and update file if needed
  if (JSON.stringify(config) !== JSON.stringify(defaultConfig)) {
    await fs.writeFile(
      configPath,
      JSON.stringify(config, undefined, 2),
      "utf-8"
    );
    console.log("Config file updated with environment variable overrides");
  }

  return { config, configPath };
};
