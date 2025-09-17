import axios from "axios";
import { BigNumber } from "bignumber.js";

import {
  findRegistryTokenEquivalentOnOtherChain,
  OSMOSIS_MAINNET_CHAIN_INFO,
  OSMOSIS_TESTNET_CHAIN_INFO,
  RegistryToken,
} from "../registry";

export const getPairPriceOnOsmosis = async (
  token0: RegistryToken,
  token1: RegistryToken,
  environment: "mainnet" | "testnet" = "mainnet"
): Promise<string> => {
  const osmosisChainInfo =
    environment === "mainnet"
      ? OSMOSIS_MAINNET_CHAIN_INFO
      : OSMOSIS_TESTNET_CHAIN_INFO;

  const token0Osmosis = findRegistryTokenEquivalentOnOtherChain(
    token0,
    osmosisChainInfo.id
  );
  const token1Osmosis = findRegistryTokenEquivalentOnOtherChain(
    token1,
    osmosisChainInfo.id
  );

  if (!token0Osmosis || !token1Osmosis) {
    throw new Error("Tokens not found on our config for Osmosis");
  }

  const tokenIn = `${BigNumber(10)
    .pow(token0Osmosis.decimals - 1)
    .toFixed(0)}${token0Osmosis.denom}`;

  const baseUrl = environment === "mainnet" ? "sqsprod" : "sqs.testnet";

  const response = await axios.get(
    `https://${baseUrl}.osmosis.zone/router/quote?tokenIn=${encodeURIComponent(
      tokenIn
    )}&tokenOutDenom=${encodeURIComponent(token1Osmosis.denom)}`
  );

  if (!response?.data?.in_base_out_quote_spot_price) {
    throw new Error(
      `${token0Osmosis.name}/${token1Osmosis.name} pair price not found`
    );
  }

  return response.data.in_base_out_quote_spot_price;
};
