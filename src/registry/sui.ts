import { normalizeStructTag, SUI_TYPE_ARG } from "@mysten/sui/utils";
import { ChainInfo, RegistryToken } from "./types";

// MAINNET
export const DEFAULT_SUI_MAINNET_RPC_ENDPOINT =
  "https://fullnode.mainnet.sui.io:443";
export const DEFAULT_SUI_MAINNET_REST_ENDPOINT = "";
export const SUI_MAINNET_NATIVE_TOKEN: RegistryToken = {
  chainId: "101",
  denom: normalizeStructTag(SUI_TYPE_ARG),
  name: "SUI",
  decimals: 9,
  logo: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/sui/info/logo.png",
  coingeckoId: "sui",
};
export const SUI_MAINNET_CHAIN_INFO: ChainInfo = {
  name: "Sui",
  id: "101",
  rpcEndpoint: DEFAULT_SUI_MAINNET_RPC_ENDPOINT,
  restEndpoint: DEFAULT_SUI_MAINNET_REST_ENDPOINT,
  nativeToken: SUI_MAINNET_NATIVE_TOKEN,
  prefix: "sui",
};
export const SUI_MAINNET_TOKENS_MAP: Record<string, RegistryToken> = {
  [SUI_MAINNET_NATIVE_TOKEN.denom]: SUI_MAINNET_NATIVE_TOKEN,
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC":
    {
      chainId: "101",
      denom:
        "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
      name: "USDC",
      decimals: 6,
      logo: "https://raw.githubusercontent.com/cosmos/chain-registry/refs/heads/master/_non-cosmos/ethereum/images/usdc.png",
      coingeckoId: "usd-coin",
    },
  "06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS":
    {
      chainId: "101",
      denom:
        "06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS",
      name: "CETUS",
      decimals: 9,
      logo: "https://strapi-dev.scand.app/uploads/Cetus_fd3e9a7dbd.png",
      coingeckoId: "cetus-protocol",
    },
};

export const DEFAULT_SUI_TESTNET_RPC_ENDPOINT =
  "https://fullnode.testnet.sui.io:443";
export const DEFAULT_SUI_TESTNET_REST_ENDPOINT = "";
export const SUI_TESTNET_NATIVE_TOKEN: RegistryToken = {
  chainId: "103",
  denom: normalizeStructTag(SUI_TYPE_ARG),
  name: "SUI",
  decimals: 9,
  logo: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/sui/info/logo.png",
  coingeckoId: "sui",
};
export const SUI_TESTNET_CHAIN_INFO: ChainInfo = {
  name: "Sui Testnet",
  id: "103",
  rpcEndpoint: DEFAULT_SUI_TESTNET_RPC_ENDPOINT,
  restEndpoint: DEFAULT_SUI_TESTNET_REST_ENDPOINT,
  nativeToken: SUI_TESTNET_NATIVE_TOKEN,
  prefix: "sui",
};
export const SUI_TESTNET_TOKENS_MAP: Record<string, RegistryToken> = {
  [SUI_TESTNET_NATIVE_TOKEN.denom]: SUI_TESTNET_NATIVE_TOKEN,
  "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC":
    {
      chainId: "103",
      denom:
        "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
      name: "USDC",
      decimals: 6,
      logo: "https://raw.githubusercontent.com/cosmos/chain-registry/refs/heads/master/_non-cosmos/ethereum/images/usdc.png",
      coingeckoId: "usd-coin",
    },
};
