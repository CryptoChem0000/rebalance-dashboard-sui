import { Bip39, Random } from "@cosmjs/crypto";
import { DirectSecp256k1HdWallet, OfflineSigner } from "@cosmjs/proto-signing";
import { PrivateKey } from "@injectivelabs/sdk-ts";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import dotenv from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { getSignerAddress, getWorkingDirectory } from "../../utils";

import { AbstractKeyStore } from "../types";

/**
 * Environment variable-based key storage implementation.
 *
 * This class allows to store and manage cryptographic mnemonics
 * using environment variables stored in a .env file. It implements the AbstractKeyStore interface
 *
 * @remarks
 * - Mnemonics are stored as environment variables in a specified .env file
 * - The implementation uses dotenv.parse() to avoid polluting process.env
 * - All operations are asynchronous to support file I/O
 * - Suitable for development environments; production should use more secure storage
 * - This implementation is NOT thread-safe. Avoid concurrent operations
 *   on the same .env file to prevent data loss
 *
 * @example
 * ```typescript
 * const keyStore = await EnvVariableKeyStore.make('.env.local');
 * const mnemonic = await keyStore.createKey('WALLET_MAIN');
 * const signer = await keyStore.getCosmWasmSigner('WALLET_MAIN', 'cosmos');
 * ```
 */
export class EnvVariableKeyStore extends AbstractKeyStore<string> {
  /**
   * Path to the .env file used for storage
   */
  private envFilePath: string;

  /**
   * Creates a new instance of EnvVariableKeyStore
   * @param envFilePath - Full path to the .env file
   */
  constructor(envFilePath: string) {
    super();
    this.envFilePath = envFilePath;
  }

  /**
   * Factory method to create an EnvVariableKeyStore instance
   *
   * @param envFilePath - Optional path to the .env file. If not provided,
   *                     uses the working directory resolution logic
   * @returns Promise resolving to a new EnvVariableKeyStore instance
   *
   * @example
   * ```typescript
   * // Use default working directory (git root directory or process working directory)
   * const keyStore = await EnvVariableKeyStore.make();
   *
   * // Use custom path
   * const keyStore = await EnvVariableKeyStore.make('/path/to/.env');
   * ```
   */
  static async make(envFilePath?: string): Promise<EnvVariableKeyStore> {
    const path = envFilePath
      ? envFilePath
      : join(await getWorkingDirectory(envFilePath), ".env");

    return new EnvVariableKeyStore(path);
  }

  /**
   * Retrieves a stored mnemonic by its name
   *
   * @param name - The environment variable name containing the mnemonic
   * @returns Promise resolving to the mnemonic string
   * @throws Error if the key is not found in the .env file
   *
   * @example
   * ```typescript
   * try {
   *   const mnemonic = await keyStore.getKey('WALLET_MAIN');
   *   console.log('Mnemonic:', mnemonic);
   * } catch (error) {
   *   console.error('Key not found:', error.message);
   * }
   * ```
   */
  async getKey(name: string): Promise<string> {
    if (process.env[name]) {
      return process.env[name];
    }

    const envVariables = await this.readEnvVariables();
    const mnemonic = envVariables[name];
    if (!mnemonic) {
      throw new Error(`Key '${name}' not found in environment variables`);
    }
    return mnemonic;
  }

  /**
   * Creates an OfflineSigner instance for CosmWasm transaction signing
   *
   * @param name - The environment variable name containing the mnemonic
   * @param chainPrefix - The blockchain address prefix (defaults to "archway")
   *                     Common prefixes: "cosmos", "osmo", "juno", "archway"
   * @returns Promise resolving to an OfflineSigner instance
   * @throws Error if the key is not found or the mnemonic is invalid
   *
   * @example
   * ```typescript
   * // Get signer for Cosmos Hub
   * const signer = await keyStore.getCosmWasmSigner('WALLET_MAIN', 'cosmos');
   *
   * // Get signer for Osmosis
   * const osmoSigner = await keyStore.getCosmWasmSigner('WALLET_TRADE', 'osmo');
   *
   * // Get accounts from signer
   * const accounts = await signer.getAccounts();
   * console.log('Address:', accounts[0].address);
   * ```
   */
  async getCosmWasmSigner(
    name: string,
    chainPrefix: string = "archway"
  ): Promise<OfflineSigner> {
    const mnemonic = await this.getKey(name);

    return await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
      prefix: chainPrefix,
    });
  }

  /**
   * Creates an Ed25519Keypair instance for Sui transaction signing
   *
   * @param name - The environment variable name containing the mnemonic
   * @returns Promise resolving to an OfflineSigner instance
   * @throws Error if the key is not found or the mnemonic is invalid
   *
   * @example
   * ```typescript
   * // Get signer for Sui
   * const signer = await keyStore.getCosmWasmSigner('WALLET_MAIN');
   * ```
   */
  async getSuiSigner(name: string): Promise<Ed25519Keypair> {
    const mnemonic = await this.getKey(name);

    return Ed25519Keypair.deriveKeypair(mnemonic);
  }

  /**
   * Get the address for the specified key and CosmWasm chain
   *
   * @param name - The environment variable name containing the mnemonic
   * @param chainPrefix - The blockchain address prefix (defaults to "archway")
   *                     Common prefixes: "cosmos", "osmo", "juno", "archway", "inj"
   * @returns Promise resolving to the address string for the given key and chain
   * @throws Error if the key is not found or the mnemonic is invalid
   *
   * @remarks
   * Special handling for Injective (inj) chain which uses a different derivation path.
   * For other chains, derives the address from the first account of the signer.
   *
   * @example
   * ```typescript
   * // Get Cosmos address
   * const cosmosAddr = await keyStore.getCosmWasmAddress('WALLET_MAIN', 'cosmos');
   * console.log('Cosmos address:', cosmosAddr);
   *
   * // Get Injective address (uses special derivation)
   * const injAddr = await keyStore.getCosmWasmAddress('WALLET_MAIN', 'inj');
   * console.log('Injective address:', injAddr);
   * ```
   */
  async getCosmWasmAddress(
    name: string,
    chainPrefix: string = "archway"
  ): Promise<string> {
    if (chainPrefix === "inj") {
      const mnemonic = await this.getKey(name);
      const privateKey = PrivateKey.fromMnemonic(mnemonic);
      const publicKey = privateKey.toPublicKey();
      return publicKey.toAddress().address;
    } else {
      const signer = await this.getCosmWasmSigner(name, chainPrefix);
      return getSignerAddress(signer);
    }
  }

  /**
   * Get the Sui address for the specified key
   *
   * @param name - The environment variable name containing the mnemonic
   * @returns Promise resolving to the address string for the given key
   * @throws Error if the key is not found or the mnemonic is invalid
   *
   * @example
   */
  async getSuiAddress(name: string): Promise<string> {
    const signer = await this.getSuiSigner(name);
    return getSignerAddress(signer);
  }

  /**
   * Creates a new key with a generated 24-word mnemonic
   *
   * @param name - The environment variable name for the new key
   * @returns Promise resolving to the generated mnemonic string
   * @throws Error if a key with the same name already exists
   *
   * @remarks
   * - Generates a cryptographically secure 24-word mnemonic
   * - Uses 256 bits of entropy for maximum security
   * - Automatically saves the mnemonic to the .env file
   *
   * @example
   * ```typescript
   * try {
   *   const mnemonic = await keyStore.createKey('WALLET_BACKUP');
   *   console.log('New mnemonic created:', mnemonic);
   *   // Securely backup this mnemonic!
   * } catch (error) {
   *   console.error('Failed to create key:', error.message);
   * }
   * ```
   */
  async createKey(name: string): Promise<string> {
    let existingKey = "";
    try {
      existingKey = await this.getKey(name);
    } catch {
      /* do nothing */
    }

    if (existingKey) {
      throw new Error(`Key '${name}' already exists in environment variables`);
    }

    // Generate a new mnemonic (24 words)
    const entropy = Random.getBytes(32);
    const mnemonic = Bip39.encode(entropy).toString();

    await this.saveToEnvFile(name, mnemonic);

    return mnemonic;
  }

  /**
   * Deletes a key from storage
   *
   * @param name - The environment variable name to delete
   * @returns Promise that resolves when the key is deleted
   *
   * @remarks
   * Removes the key from the .env file completely. This operation
   * cannot be undone, so ensure you have backed up any important mnemonics.
   *
   * @example
   * ```typescript
   * await keyStore.deleteKey('WALLET_OLD');
   * console.log('Key deleted successfully');
   * ```
   */
  async deleteKey(name: string): Promise<void> {
    await this.saveToEnvFile(name, undefined);
  }

  /**
   * Lists all keys that appear to be mnemonics
   *
   * @returns Promise resolving to an array of key names
   *
   * @remarks
   * Identifies mnemonics by checking if the value contains at least 12 words
   * (the minimum for a valid BIP39 mnemonic). This helps filter out other
   * environment variables that might be in the same .env file.
   *
   * @example
   * ```typescript
   * const keys = await keyStore.listKeys();
   * console.log('Available wallets:', keys);
   * // Output: ['WALLET_MAIN', 'WALLET_BACKUP', 'WALLET_TEST']
   * ```
   */
  async listKeys(): Promise<string[]> {
    const envVariables = await this.readEnvVariables();
    const keyNames: string[] = [];

    for (const [key, value] of Object.entries(process.env)) {
      if (value && typeof value === "string" && value.split(" ").length >= 12) {
        keyNames.push(key);
      }
    }

    for (const [key, value] of Object.entries(envVariables)) {
      // Basic check if value looks like a mnemonic (contains spaces and multiple words)
      if (value && typeof value === "string" && value.split(" ").length >= 12) {
        keyNames.push(key);
      }
    }

    return [...new Set(keyNames)];
  }

  /**
   * Reads and parses environment variables from the .env file
   *
   * @returns Promise resolving to a key-value object of environment variables
   * @private
   *
   * @remarks
   * Uses dotenv.parse() to parse the file content without affecting process.env,
   * ensuring complete isolation from the global environment.
   */
  private async readEnvVariables(): Promise<Record<string, string>> {
    if (existsSync(this.envFilePath)) {
      const envContent = await readFile(this.envFilePath, "utf-8");
      // Use dotenv's parse method to parse without loading into process.env
      return dotenv.parse(envContent);
    }

    return {};
  }

  /**
   * Saves or deletes a key-value pair in the .env file
   *
   * @param name - The environment variable name
   * @param value - The mnemonic value (pass undefined to delete)
   * @returns Promise that resolves when the file is updated
   * @throws Error if the file operation fails
   * @private
   *
   * @remarks
   * - Updates existing keys in place to preserve file structure
   * - Adds new keys at the end of the file
   * - Deletes keys when value is undefined
   * - Preserves other environment variables in the file
   */
  private async saveToEnvFile(name: string, value?: string): Promise<void> {
    try {
      let envContent = "";

      // Read existing content if file exists
      if (existsSync(this.envFilePath)) {
        envContent = await readFile(this.envFilePath, "utf-8");
      }

      if (value) {
        // We are trying to insert a value, check if the variable already exists in the file
        const envRegex = new RegExp(`^${name}=.*$`, "m");
        if (envRegex.test(envContent)) {
          // Update existing variable
          envContent = envContent.replace(envRegex, `${name}="${value}"`);
        } else {
          // Add new variable
          if (envContent && !envContent.endsWith("\n")) {
            envContent += "\n";
          }
          envContent += `${name}="${value}"\n`;
        }
      } else {
        // If value passed is undefined or empty, try to delete value
        const envRegex = new RegExp(`^${name}=.*$\n?`, "gm");
        envContent = envContent.replace(envRegex, "");
      }

      // Write back to file
      await writeFile(this.envFilePath, envContent, "utf-8");
    } catch (error: any) {
      throw new Error(`Failed to save key to .env file: ${error?.message}`);
    }
  }
}
