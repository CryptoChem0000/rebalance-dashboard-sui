import { BoltOnArchway } from "../bolt-liquidity";
import {
  ARCHWAY_MAINNET_CHAIN_INFO,
  ARCHWAY_TESTNET_CHAIN_INFO,
  findRegistryTokenEquivalentOnOtherChain,
  RegistryToken,
} from "../registry";

import { BoltClientParams } from "./types";

export const getPairPriceOnBoltArchway = async (
  token0: RegistryToken,
  token1: RegistryToken,
  boltClientParams?: BoltClientParams
): Promise<string> => {
  const environment = boltClientParams?.environment ?? "mainnet";
  const archwayChainInfo =
    environment === "mainnet"
      ? ARCHWAY_MAINNET_CHAIN_INFO
      : ARCHWAY_TESTNET_CHAIN_INFO;

  const client =
    boltClientParams?.boltClient ??
    BoltOnArchway.makeBoltClient(
      environment,
      boltClientParams?.rpcEndpoint,
      boltClientParams?.restEndpoint
    );

  const token0Archway = findRegistryTokenEquivalentOnOtherChain(
    token0,
    archwayChainInfo.id
  );
  const token1Archway = findRegistryTokenEquivalentOnOtherChain(
    token1,
    archwayChainInfo.id
  );

  if (!token0Archway || !token1Archway) {
    throw new Error("Tokens not found on our config for Bolt on Archway");
  }

  const result = await client.getPrice(
    token0Archway.denom,
    token1Archway.denom
  );

  return result.price;
};
