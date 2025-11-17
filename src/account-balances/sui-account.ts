import { SuiClient } from "@mysten/sui/client";
import { normalizeStructTag } from "@mysten/sui/utils";

import {
  DEFAULT_SUI_MAINNET_RPC_ENDPOINT,
  DEFAULT_SUI_TESTNET_RPC_ENDPOINT,
  findSuiTokensMap,
  RegistryToken,
} from "../registry";
import { TokenAmount } from "./token-amount";

import { AbstractChainAccount } from "./types";

export class SuiAccount implements AbstractChainAccount {
  public client: SuiClient;
  public tokensMap: Record<string, RegistryToken>;

  constructor(
    public address: string,
    environment: "mainnet" | "testnet" = "mainnet"
  ) {
    const rpcEndpoint =
      environment === "mainnet"
        ? DEFAULT_SUI_MAINNET_RPC_ENDPOINT
        : DEFAULT_SUI_TESTNET_RPC_ENDPOINT;

    this.client = new SuiClient({ url: rpcEndpoint });
    this.tokensMap = findSuiTokensMap();
  }

  async getAvailableBalances(): Promise<Record<string, TokenAmount>> {
    const result: Record<string, TokenAmount> = {};

    // Get all coin balances for the address
    const allBalances = await this.client.getAllBalances({
      owner: this.address,
    });

    for (const coinBalance of allBalances) {
      // Sui uses coin type as the identifier (e.g., "0x2::sui::SUI")
      const denom = normalizeStructTag(coinBalance.coinType);
      const registryToken = this.tokensMap[denom];

      if (registryToken) {
        result[registryToken.denom] = new TokenAmount(
          coinBalance.totalBalance,
          registryToken
        );
      }
    }

    return result;
  }

  async getTokenAvailableBalance(denom: string): Promise<TokenAmount> {
    const registryToken = this.tokensMap[normalizeStructTag(denom)];

    if (!registryToken) {
      throw new Error("Token coin type not supported");
    }

    // Get balance for specific coin type
    const balance = await this.client.getBalance({
      owner: this.address,
      coinType: denom,
    });

    return new TokenAmount(balance.totalBalance, registryToken);
  }
}
