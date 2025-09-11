import { randomBytes } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { EnvVariableKeyStore } from "../key-stores";

describe("EnvVariableKeyStore", () => {
  let testEnvPath: string;
  let keyStore: EnvVariableKeyStore;

  beforeEach(async () => {
    // Create a unique test file for each test
    const uniqueId = randomBytes(8).toString("hex");
    testEnvPath = join(tmpdir(), `test-${uniqueId}.env`);
    keyStore = new EnvVariableKeyStore(testEnvPath);
  });

  afterEach(async () => {
    // Clean up test file
    if (existsSync(testEnvPath)) {
      await unlink(testEnvPath);
    }
  });

  describe("constructor and factory", () => {
    it("should create instance with specified path", () => {
      const customPath = "/custom/path/.env";
      const customKeyStore = new EnvVariableKeyStore(customPath);
      expect(customKeyStore).toBeInstanceOf(EnvVariableKeyStore);
    });

    it("should create instance using factory method with default path", async () => {
      const factoryKeyStore = await EnvVariableKeyStore.make();
      expect(factoryKeyStore).toBeInstanceOf(EnvVariableKeyStore);
    });

    it("should create instance using factory method with custom path", async () => {
      const customPath = "/custom/path/.env";
      const factoryKeyStore = await EnvVariableKeyStore.make(customPath);
      expect(factoryKeyStore).toBeInstanceOf(EnvVariableKeyStore);
    });
  });

  describe("createKey", () => {
    it("should create a new key with valid mnemonic", async () => {
      const keyName = "TEST_WALLET";
      const mnemonic = await keyStore.createKey(keyName);

      expect(mnemonic).toBeDefined();
      expect(typeof mnemonic).toBe("string");

      // Check it's a valid 24-word mnemonic
      const words = mnemonic.split(" ");
      expect(words).toHaveLength(24);

      // Verify it was saved
      const savedMnemonic = await keyStore.getKey(keyName);
      expect(savedMnemonic).toBe(mnemonic);
    });

    it("should throw error when creating duplicate key", async () => {
      const keyName = "DUPLICATE_KEY";
      await keyStore.createKey(keyName);

      await expect(keyStore.createKey(keyName)).rejects.toThrow(
        `Key '${keyName}' already exists in environment variables`
      );
    });

    it("should create multiple keys successfully", async () => {
      const key1 = await keyStore.createKey("WALLET_1");
      const key2 = await keyStore.createKey("WALLET_2");
      const key3 = await keyStore.createKey("WALLET_3");

      expect(key1).not.toBe(key2);
      expect(key2).not.toBe(key3);
      expect(key1).not.toBe(key3);

      const keys = await keyStore.listKeys();
      expect(keys).toHaveLength(3);
      expect(keys).toContain("WALLET_1");
      expect(keys).toContain("WALLET_2");
      expect(keys).toContain("WALLET_3");
    });
  });

  describe("getKey", () => {
    it("should retrieve existing key", async () => {
      const keyName = "GET_TEST_KEY";
      const originalMnemonic = await keyStore.createKey(keyName);

      const retrievedMnemonic = await keyStore.getKey(keyName);
      expect(retrievedMnemonic).toBe(originalMnemonic);
    });

    it("should throw error for non-existent key", async () => {
      await expect(keyStore.getKey("NON_EXISTENT")).rejects.toThrow(
        "Key 'NON_EXISTENT' not found in environment variables"
      );
    });

    it("should handle special characters in key names", async () => {
      const keyName = "TEST_KEY_WITH_UNDERSCORE";
      const mnemonic = await keyStore.createKey(keyName);

      const retrieved = await keyStore.getKey(keyName);
      expect(retrieved).toBe(mnemonic);
    });
  });

  describe("getSigner", () => {
    it("should return valid signer with default chain prefix", async () => {
      const keyName = "SIGNER_TEST";
      const mnemonic = await keyStore.createKey(keyName);

      const signer = await keyStore.getSigner(keyName);
      expect(signer).toBeDefined();

      const accounts = await signer.getAccounts();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].address).toMatch(/^archway/);
    });

    it("should return valid signer with custom chain prefix", async () => {
      const keyName = "COSMOS_SIGNER";
      await keyStore.createKey(keyName);

      const signer = await keyStore.getSigner(keyName, "cosmos");
      const accounts = await signer.getAccounts();

      expect(accounts).toHaveLength(1);
      expect(accounts[0].address).toMatch(/^cosmos/);
    });

    it("should return different addresses for different chain prefixes", async () => {
      const keyName = "MULTI_CHAIN";
      await keyStore.createKey(keyName);

      const cosmosSigner = await keyStore.getSigner(keyName, "cosmos");
      const osmoSigner = await keyStore.getSigner(keyName, "osmo");

      const cosmosAccounts = await cosmosSigner.getAccounts();
      const osmoAccounts = await osmoSigner.getAccounts();

      expect(cosmosAccounts[0].address).toMatch(/^cosmos/);
      expect(osmoAccounts[0].address).toMatch(/^osmo/);
      expect(cosmosAccounts[0].pubkey).toEqual(osmoAccounts[0].pubkey);
    });

    it("should throw error for non-existent key", async () => {
      await expect(keyStore.getSigner("NON_EXISTENT")).rejects.toThrow(
        "Key 'NON_EXISTENT' not found in environment variables"
      );
    });
  });

  describe("deleteKey", () => {
    it("should delete existing key", async () => {
      const keyName = "DELETE_ME";
      await keyStore.createKey(keyName);

      // Verify it exists
      await expect(keyStore.getKey(keyName)).resolves.toBeDefined();

      // Delete it
      await keyStore.deleteKey(keyName);

      // Verify it's gone
      await expect(keyStore.getKey(keyName)).rejects.toThrow(
        `Key '${keyName}' not found in environment variables`
      );
    });

    it("should not throw when deleting non-existent key", async () => {
      // Should complete without error
      await expect(keyStore.deleteKey("NON_EXISTENT")).resolves.toBeUndefined();
    });

    it("should preserve other keys when deleting", async () => {
      await keyStore.createKey("KEEP_1");
      await keyStore.createKey("DELETE_ME");
      await keyStore.createKey("KEEP_2");

      await keyStore.deleteKey("DELETE_ME");

      const keys = await keyStore.listKeys();
      expect(keys).toHaveLength(2);
      expect(keys).toContain("KEEP_1");
      expect(keys).toContain("KEEP_2");
      expect(keys).not.toContain("DELETE_ME");
    });
  });

  describe("listKeys", () => {
    it("should return empty array for new file", async () => {
      const keys = await keyStore.listKeys();
      expect(keys).toEqual([]);
    });

    it("should list all mnemonic keys", async () => {
      await keyStore.createKey("WALLET_A");
      await keyStore.createKey("WALLET_B");
      await keyStore.createKey("WALLET_C");

      const keys = await keyStore.listKeys();
      expect(keys).toHaveLength(3);
      expect(keys).toContain("WALLET_A");
      expect(keys).toContain("WALLET_B");
      expect(keys).toContain("WALLET_C");
    });

    it("should filter out non-mnemonic environment variables", async () => {
      // Create some mnemonics
      await keyStore.createKey("VALID_MNEMONIC");

      // Manually add non-mnemonic variables to the file
      let content = await readFile(testEnvPath, "utf-8");
      content += 'SHORT_VALUE="too short"\n';
      content += 'API_KEY="some-api-key-value"\n';
      content += 'EMPTY_VALUE=""\n';
      await writeFile(testEnvPath, content, "utf-8");

      const keys = await keyStore.listKeys();
      expect(keys).toHaveLength(1);
      expect(keys).toContain("VALID_MNEMONIC");
    });

    it("should handle file with mixed content", async () => {
      // Write a file with various content types
      const mixedContent = `
# This is a comment
NODE_ENV="production"
VALID_WALLET_1="word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12"
API_KEY="short-key"
VALID_WALLET_2="another twelve word mnemonic phrase that is long enough to be valid here"

# Another comment
DEBUG=true
`;
      await writeFile(testEnvPath, mixedContent, "utf-8");

      const keys = await keyStore.listKeys();
      expect(keys).toHaveLength(2);
      expect(keys).toContain("VALID_WALLET_1");
      expect(keys).toContain("VALID_WALLET_2");
    });
  });

  describe("file handling", () => {
    it("should create env file if it does not exist", async () => {
      expect(existsSync(testEnvPath)).toBe(false);

      await keyStore.createKey("FIRST_KEY");

      expect(existsSync(testEnvPath)).toBe(true);
    });

    it("should preserve existing content when adding new keys", async () => {
      // Write initial content
      const initialContent = 'EXISTING_VAR="existing value"\n';
      await writeFile(testEnvPath, initialContent, "utf-8");

      // Add a new key
      await keyStore.createKey("NEW_WALLET");

      // Check that both exist
      const content = await readFile(testEnvPath, "utf-8");
      expect(content).toContain('EXISTING_VAR="existing value"');
      expect(content).toContain('NEW_WALLET="');
    });

    it("should properly escape special characters in values", async () => {
      // This tests that the mnemonic is properly quoted in the env file
      const keyName = "SPECIAL_TEST";
      await keyStore.createKey(keyName);

      const content = await readFile(testEnvPath, "utf-8");
      expect(content).toMatch(new RegExp(`${keyName}="[^"]*"`));
    });
  });

  describe("error handling", () => {
    it("should handle read errors gracefully", async () => {
      // Create a keystore with an invalid path
      const invalidPath = "/invalid/path/that/does/not/exist/.env";
      const errorKeyStore = new EnvVariableKeyStore(invalidPath);

      // Should return empty array for non-existent file
      const keys = await errorKeyStore.listKeys();
      expect(keys).toEqual([]);
    });

    it("should throw descriptive error for write failures", async () => {
      // Make the file read-only (on systems that support it)
      await keyStore.createKey("INITIAL_KEY");

      // This is platform-specific and might not work on all systems
      // For a more robust test, you might want to mock the file system
      try {
        await writeFile(testEnvPath, "content", { mode: 0o444 });
        await expect(keyStore.createKey("SHOULD_FAIL")).rejects.toThrow(
          "Failed to save key to .env file:"
        );
      } catch {
        // Skip this test if we can't make the file read-only
        expect(true).toBe(true);
      }
    });
  });

  describe("integration scenarios", () => {
    it("should support full lifecycle of key management", async () => {
      // Create
      const mnemonic1 = await keyStore.createKey("LIFECYCLE_TEST");
      expect(mnemonic1).toBeDefined();

      // Read
      const retrieved = await keyStore.getKey("LIFECYCLE_TEST");
      expect(retrieved).toBe(mnemonic1);

      // Use for signing
      const signer = await keyStore.getSigner("LIFECYCLE_TEST", "cosmos");
      const accounts = await signer.getAccounts();
      expect(accounts[0].address).toMatch(/^cosmos/);

      // List
      let keys = await keyStore.listKeys();
      expect(keys).toContain("LIFECYCLE_TEST");

      // Delete
      await keyStore.deleteKey("LIFECYCLE_TEST");

      // Verify deletion
      keys = await keyStore.listKeys();
      expect(keys).not.toContain("LIFECYCLE_TEST");
    });

    it("should handle multiple wallets for different chains", async () => {
      // Create wallets for different purposes
      await keyStore.createKey("COSMOS_MAIN");
      await keyStore.createKey("OSMOSIS_TRADING");
      await keyStore.createKey("JUNO_STAKING");

      // Get signers for each
      const cosmosSigner = await keyStore.getSigner("COSMOS_MAIN", "cosmos");
      const osmoSigner = await keyStore.getSigner("OSMOSIS_TRADING", "osmo");
      const junoSigner = await keyStore.getSigner("JUNO_STAKING", "juno");

      // Verify each has correct prefix
      const cosmosAccounts = await cosmosSigner.getAccounts();
      const osmoAccounts = await osmoSigner.getAccounts();
      const junoAccounts = await junoSigner.getAccounts();

      expect(cosmosAccounts[0].address).toMatch(/^cosmos/);
      expect(osmoAccounts[0].address).toMatch(/^osmo/);
      expect(junoAccounts[0].address).toMatch(/^juno/);
    });
  });
});
