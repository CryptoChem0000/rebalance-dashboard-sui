/**
 * Supported key storage types
 */
export enum KeyStoreType {
  ENV_VARIABLE = "envVariable",
  // Future storage types can be added here
  // FILE = "file",
  // LEDGER = "ledger",
}

/**
 * Union type of all KeyStoreType values as string literals
 */
export type KeyStoreTypeValue = `${KeyStoreType}`;

/**
 * Configuration for creating a key store instance
 */
export interface KeyStoreConfig {
  type: KeyStoreType | KeyStoreTypeValue;
  filePath?: string;
}
