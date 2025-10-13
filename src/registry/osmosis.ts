import { ChainInfo, RegistryToken } from "./types";

// MAINNET
export const DEFAULT_OSMOSIS_MAINNET_RPC_ENDPOINT =
  "https://rpc.osmosis.zone:443";
export const DEFAULT_OSMOSIS_MAINNET_REST_ENDPOINT = "https://lcd.osmosis.zone";
export const OSMOSIS_MAINNET_NATIVE_TOKEN: RegistryToken = {
  chainId: "osmosis-1",
  denom: "uosmo",
  name: "OSMO",
  decimals: 6,
  logo: "https://raw.githubusercontent.com/cosmos/chain-registry/master/osmosis/images/osmo.png",
  coingeckoId: "osmosis",
};
export const OSMOSIS_MAINNET_CHAIN_INFO: ChainInfo = {
  name: "Osmosis",
  id: "osmosis-1",
  rpcEndpoint: DEFAULT_OSMOSIS_MAINNET_RPC_ENDPOINT,
  restEndpoint: DEFAULT_OSMOSIS_MAINNET_REST_ENDPOINT,
  nativeToken: OSMOSIS_MAINNET_NATIVE_TOKEN,
  prefix: "osmo",
};
export const OSMOSIS_MAINNET_TOKENS_MAP: Record<string, RegistryToken> = {
  [OSMOSIS_MAINNET_NATIVE_TOKEN.denom]: OSMOSIS_MAINNET_NATIVE_TOKEN,
  "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4": {
    chainId: "osmosis-1",
    denom:
      "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4",
    name: "USDC",
    decimals: 6,
    logo: "https://raw.githubusercontent.com/cosmos/chain-registry/master/noble/images/USDCoin.png",
    coingeckoId: "usd-coin",
    originDenom: "uusdc",
    originChainId: "noble-1",
  },
  "ibc/23AB778D694C1ECFC59B91D8C399C115CC53B0BD1C61020D8E19519F002BDD85": {
    chainId: "osmosis-1",
    denom:
      "ibc/23AB778D694C1ECFC59B91D8C399C115CC53B0BD1C61020D8E19519F002BDD85",
    name: "ARCH",
    decimals: 18,
    logo: "https://raw.githubusercontent.com/cosmos/chain-registry/refs/heads/master/archway/images/arch.png",
    coingeckoId: "archway",
    originDenom: "aarch",
    originChainId: "archway-1",
  },
  "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2": {
    chainId: "osmosis-1",
    denom:
      "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
    name: "ATOM",
    decimals: 6,
    logo: "https://raw.githubusercontent.com/cosmos/chain-registry/master/cosmoshub/images/atom.png",
    coingeckoId: "cosmos",
    originDenom: "uatom",
    originChainId: "cosmoshub-4",
  },
  "ibc/D79E7D83AB399BFFF93433E54FAA480C191248FC556924A2A8351AE2638B3877": {
    chainId: "osmosis-1",
    denom:
      "ibc/D79E7D83AB399BFFF93433E54FAA480C191248FC556924A2A8351AE2638B3877",
    name: "TIA",
    decimals: 6,
    logo: "https://raw.githubusercontent.com/cosmos/chain-registry/master/celestia/images/celestia.png",
    coingeckoId: "celestia",
    originDenom: "utia",
    originChainId: "celestia",
  },
};

export const DEFAULT_OSMOSIS_TESTNET_RPC_ENDPOINT =
  "https://rpc.osmotest5.osmosis.zone";
export const DEFAULT_OSMOSIS_TESTNET_REST_ENDPOINT =
  "https://lcd.osmotest5.osmosis.zone";
export const OSMOSIS_TESTNET_NATIVE_TOKEN: RegistryToken = {
  chainId: "osmo-test-5",
  denom: "uosmo",
  name: "OSMO",
  decimals: 6,
  logo: "https://raw.githubusercontent.com/cosmos/chain-registry/master/osmosis/images/osmo.png",
  coingeckoId: "osmosis",
};
export const OSMOSIS_TESTNET_CHAIN_INFO: ChainInfo = {
  name: "Osmosis Testnet",
  id: "osmo-test-5",
  rpcEndpoint: DEFAULT_OSMOSIS_TESTNET_RPC_ENDPOINT,
  restEndpoint: DEFAULT_OSMOSIS_TESTNET_REST_ENDPOINT,
  nativeToken: OSMOSIS_TESTNET_NATIVE_TOKEN,
  prefix: "osmo",
};
export const OSMOSIS_TESTNET_TOKENS_MAP: Record<string, RegistryToken> = {
  [OSMOSIS_TESTNET_NATIVE_TOKEN.denom]: OSMOSIS_TESTNET_NATIVE_TOKEN,
  "ibc/DE6792CF9E521F6AD6E9A4BDF6225C9571A3B74ACC0A529F92BC5122A39D2E58": {
    chainId: "osmo-test-5",
    denom:
      "ibc/DE6792CF9E521F6AD6E9A4BDF6225C9571A3B74ACC0A529F92BC5122A39D2E58",
    name: "USDC",
    decimals: 6,
    logo: "https://raw.githubusercontent.com/cosmos/chain-registry/master/noble/images/USDCoin.png",
    coingeckoId: "usd-coin",
    originDenom: "uusdc",
    originChainId: "grand-1",
  },
  "ibc/5F10B4BED1A80DC44975D95D716AEF8CEBFB99B3F088C98361436A7D0CF5A830": {
    chainId: "osmo-test-5",
    denom:
      "ibc/5F10B4BED1A80DC44975D95D716AEF8CEBFB99B3F088C98361436A7D0CF5A830",
    name: "CONST",
    decimals: 18,
    logo: "https://raw.githubusercontent.com/cosmos/chain-registry/refs/heads/master/archway/images/arch.png",
    coingeckoId: "archway",
    originDenom: "aconst",
    originChainId: "constantine-3",
  },
};
