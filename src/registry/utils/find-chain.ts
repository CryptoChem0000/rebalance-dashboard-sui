import {
  ARCHWAY_MAINNET_CHAIN_INFO,
  ARCHWAY_TESTNET_CHAIN_INFO,
} from "../archway";
import {
  OSMOSIS_MAINNET_CHAIN_INFO,
  OSMOSIS_TESTNET_CHAIN_INFO,
} from "../osmosis";
import { SUI_MAINNET_CHAIN_INFO, SUI_TESTNET_CHAIN_INFO } from "../sui";

import { ChainInfo } from "../types";

export const findArchwayChainInfo = (
  environment: "mainnet" | "testnet" = "mainnet"
): ChainInfo => {
  return environment === "mainnet"
    ? ARCHWAY_MAINNET_CHAIN_INFO
    : ARCHWAY_TESTNET_CHAIN_INFO;
};

export const findOsmosisChainInfo = (
  environment: "mainnet" | "testnet" = "mainnet"
): ChainInfo => {
  return environment === "mainnet"
    ? OSMOSIS_MAINNET_CHAIN_INFO
    : OSMOSIS_TESTNET_CHAIN_INFO;
};

export const findSuiChainInfo = (
  environment: "mainnet" | "testnet" = "mainnet"
): ChainInfo => {
  return environment === "mainnet"
    ? SUI_MAINNET_CHAIN_INFO
    : SUI_TESTNET_CHAIN_INFO;
};
