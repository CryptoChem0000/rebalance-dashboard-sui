import { OfflineSigner } from "@cosmjs/proto-signing";

/**
 * Abstract base class for implementing key storage solutions.
 * Provides a common interface for managing cryptographic keys and signers.
 *
 * @template TStoredKey - The type of the stored key (e.g., string for mnemonics, object for encrypted data)
 */
export abstract class AbstractKeyStore<TStoredKey = unknown> {
  /**
   * Retrieve a stored key by name
   * @param name - The unique identifier for the key
   * @returns The stored key data
   */
  abstract getKey(name: string): TStoredKey | Promise<TStoredKey>;

  /**
   * Get an OfflineSigner instance for the specified key
   * @param name - The unique identifier for the key
   * @param chainPrefix - The blockchain prefix (e.g., "cosmos", "osmo", "juno")
   * @returns An OfflineSigner instance for transaction signing
   */
  abstract getSigner(
    name: string,
    chainPrefix: string
  ): OfflineSigner | Promise<OfflineSigner>;

  /**
   * Get the address for the specified key and chain
   * @param name - The unique identifier for the key
   * @param chainPrefix - The blockchain prefix (e.g., "cosmos", "osmo", "juno")
   * @returns The address string for the given key and chain
   */
  abstract getAddress(
    name: string,
    chainPrefix: string
  ): string | Promise<string>;

  /**
   * Create a new key with the given name
   * @param name - The unique identifier for the new key
   * @returns The newly created key data
   */
  abstract createKey(name: string): TStoredKey | Promise<TStoredKey>;

  /**
   * Delete a key from storage
   * @param name - The unique identifier for the key to delete
   */
  abstract deleteKey(name: string): void | Promise<void>;

  /**
   * List all available key names in the storage
   * @returns An array of key names
   */
  abstract listKeys(): string[] | Promise<string[]>;
}
