import axios from "axios";

import {
  DEFAULT_OSMOSIS_MAINNET_REST_ENDPOINT,
  DEFAULT_OSMOSIS_TESTNET_REST_ENDPOINT,
  findOsmosisTokensMap,
  RegistryToken,
} from "../registry";
import { TokenAmount } from "./token-amount";

import { AbstractChainAccount } from "./types";

export class OsmosisAccount implements AbstractChainAccount {
  public restEndpoint: string;
  public tokensMap: Record<string, RegistryToken>;
  constructor(
    public address: string,
    environment: "mainnet" | "testnet" = "mainnet"
  ) {
    this.restEndpoint =
      environment === "mainnet"
        ? DEFAULT_OSMOSIS_MAINNET_REST_ENDPOINT
        : DEFAULT_OSMOSIS_TESTNET_REST_ENDPOINT;
    this.tokensMap = findOsmosisTokensMap(environment);
  }

  async getAvailableBalances(): Promise<Record<string, TokenAmount>> {
    const result: Record<string, TokenAmount> = {};

    const response = await axios.get(
      `${this.restEndpoint}/cosmos/bank/v1beta1/balances/${this.address}`
    );

    for (const item of response.data?.balances ?? []) {
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
