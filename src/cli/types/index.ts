// Common option types used across CLI commands
export interface BaseOptions {
  environment: "mainnet" | "testnet";
}

export interface LoggableOptions extends BaseOptions {
  logFile?: string;
  log?: boolean;
}

export interface ConfigurableOptions extends LoggableOptions {
  configFile?: string;
}

export interface DateRangeOptions {
  start?: string;
  end?: string;
}

export interface CSVExportOptions {
  csv?: boolean;
}

export interface RunCommandOptions extends ConfigurableOptions {
  watch?: number;
}

export interface WithdrawCommandOptions extends ConfigurableOptions {}

export interface StatusCommandOptions extends ConfigurableOptions {}

export interface ReportCommandOptions
  extends BaseOptions,
    DateRangeOptions,
    CSVExportOptions {}

export interface VolumeCommandOptions
  extends BaseOptions,
    DateRangeOptions,
    CSVExportOptions {
  type: "archway" | "osmosis" | "bridge" | "all";
}

export interface ProfitCommandOptions
  extends BaseOptions,
    DateRangeOptions,
    CSVExportOptions {}

export interface TransactionsCommandOptions
  extends BaseOptions,
    DateRangeOptions,
    CSVExportOptions {
  limit: string;
  type?: string;
}

export interface StatsCommandOptions
  extends BaseOptions,
    DateRangeOptions,
    CSVExportOptions {}
