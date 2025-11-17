import { ALL_CHAINS_TOKEN_MAP } from "../all-chains";
import {
  ARCHWAY_MAINNET_TOKENS_MAP,
  ARCHWAY_TESTNET_TOKENS_MAP,
} from "../archway";
import {
  OSMOSIS_MAINNET_TOKENS_MAP,
  OSMOSIS_TESTNET_TOKENS_MAP,
} from "../osmosis";
import { SUI_MAINNET_TOKENS_MAP, SUI_TESTNET_TOKENS_MAP } from "../sui";

import { RegistryToken } from "../types";

export const findToken = (
  chainId: string,
  denom: string
): RegistryToken | undefined => {
  return ALL_CHAINS_TOKEN_MAP[chainId]?.[denom];
};

export const findRegistryTokenEquivalentOnOtherChain = (
  token: RegistryToken,
  externalChainId: string
): RegistryToken | undefined => {
  return token.chainId === externalChainId
    ? token
    : Object.values(ALL_CHAINS_TOKEN_MAP[externalChainId] ?? {}).find((item) =>
        token.originDenom
          ? (item.denom === token.originDenom &&
              item.chainId === token.originChainId) ||
            (item.originDenom === token.originDenom &&
              item.originChainId === token.originChainId)
          : item.originDenom === token.denom &&
            item.originChainId === token.chainId
      );
};

export const findArchwayTokensMap = (
  environment: "mainnet" | "testnet" = "mainnet"
): Record<string, RegistryToken> => {
  return environment === "mainnet"
    ? ARCHWAY_MAINNET_TOKENS_MAP
    : ARCHWAY_TESTNET_TOKENS_MAP;
};

export const findOsmosisTokensMap = (
  environment: "mainnet" | "testnet" = "mainnet"
): Record<string, RegistryToken> => {
  return environment === "mainnet"
    ? OSMOSIS_MAINNET_TOKENS_MAP
    : OSMOSIS_TESTNET_TOKENS_MAP;
};

export const findSuiTokensMap = (
  environment: "mainnet" | "testnet" = "mainnet"
): Record<string, RegistryToken> => {
  return environment === "mainnet"
    ? SUI_MAINNET_TOKENS_MAP
    : SUI_TESTNET_TOKENS_MAP;
};
