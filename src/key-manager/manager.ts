import { EnvVariableKeyStore } from "./key-stores";

import {
  AbstractKeyStore,
  KeyStoreConfig,
  KeyStoreType,
  KeyStoreTypeValue,
} from "./types";

/**
 * Factory class for creating different types of key stores
 */
export class KeyManager {
  /**
   * Creates a key store instance based on the provided configuration
   *
   * @param config - Configuration specifying the storage type and options
   * @returns Promise resolving to a key store instance
   * @throws Error if the storage type is not supported
   *
   * @example
   * ```typescript
   * const keyStore = await KeyManager.create({
   *   type: KeyStoreType.ENV_VARIABLE,
   *   filePath: '.env.local'
   * });
   * ```
   */
  static async create(
    config: KeyStoreConfig
  ): Promise<AbstractKeyStore<string>> {
    const { type, filePath } = config;

    switch (type) {
      case KeyStoreType.ENV_VARIABLE:
      case "envVariable":
        return EnvVariableKeyStore.make(filePath);
      default:
        throw new Error(`Unsupported key store type: ${type}`);
    }
  }

  /**
   * Gets a list of all supported storage types
   *
   * @returns Array of supported storage type values
   *
   * @example
   * ```typescript
   * const types = KeyManager.getSupportedTypes();
   * console.log(types); // ["envVariable"]
   * ```
   */
  static getSupportedTypes(): KeyStoreTypeValue[] {
    return Object.values(KeyStoreType);
  }
}
