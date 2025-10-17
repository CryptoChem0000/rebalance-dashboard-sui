import { Coin } from "@cosmjs/proto-signing";
import axios from "axios";

import {
  DEFAULT_ARCHWAY_MAINNET_REST_ENDPOINT,
  DEFAULT_ARCHWAY_TESTNET_REST_ENDPOINT,
  findArchwayTokensMap,
  RegistryToken,
} from "../registry";
import { TokenAmount } from "./token-amount";

import { AbstractChainAccount } from "./types";

export class ArchwayAccount implements AbstractChainAccount {
  public restEndpoint: string;
  public tokensMap: Record<string, RegistryToken>;
  constructor(
    public address: string,
    environment: "mainnet" | "testnet" = "mainnet"
  ) {
    this.restEndpoint =
      environment === "mainnet"
        ? DEFAULT_ARCHWAY_MAINNET_REST_ENDPOINT
        : DEFAULT_ARCHWAY_TESTNET_REST_ENDPOINT;
    this.tokensMap = findArchwayTokensMap();
  }

  async getAvailableBalances(): Promise<Record<string, TokenAmount>> {
    const result: Record<string, TokenAmount> = {};

    let foundBalances: Coin[] = [];
    let nextPage: string | null = null;

    do {
      const response = await axios.get(
        `${this.restEndpoint}/cosmos/bank/v1beta1/balances/${this.address}${
          nextPage ? `?pagination.key=${nextPage}` : ""
        }`
      );

      foundBalances = foundBalances.concat(response.data?.balances ?? []);

      nextPage = response.data?.pagination?.next_key ?? null;
    } while (nextPage);

    for (const item of foundBalances) {
      const registryToken = this.tokensMap[item.denom];
      if (registryToken) {
        result[registryToken.denom] = new TokenAmount(
          item.amount ?? "0",
          registryToken
        );
      }
    }

    return result;
  }

  async getTokenAvailableBalance(denom: string): Promise<TokenAmount> {
    const response = await axios.get(
      `${this.restEndpoint}/cosmos/bank/v1beta1/balances/${this.address}/by_denom?denom=${denom}`
    );

    const registryToken = this.tokensMap[denom];

    if (!registryToken) {
      throw new Error("Token denom not supported");
    }

    return new TokenAmount(response.data.balance.amount ?? "0", registryToken);
  }
}
