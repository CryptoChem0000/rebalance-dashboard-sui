import { ChainInfo, RegistryToken } from "./types";

// MAINNET
export const DEFAULT_ARCHWAY_MAINNET_RPC_ENDPOINT =
  "https://rpc.mainnet.archway.io";
export const DEFAULT_ARCHWAY_MAINNET_REST_ENDPOINT =
  "https://api.mainnet.archway.io";
export const ARCHWAY_MAINNET_NATIVE_TOKEN: RegistryToken = {
  chainId: "archway-1",
  denom: "aarch",
  name: "ARCH",
  decimals: 18,
  logo: "https://raw.githubusercontent.com/cosmos/chain-registry/refs/heads/master/archway/images/arch.png",
  coingeckoId: "archway",
};
export const ARCHWAY_MAINNET_CHAIN_INFO: ChainInfo = {
  name: "Archway",
  id: "archway-1",
  rpcEndpoint: DEFAULT_ARCHWAY_MAINNET_RPC_ENDPOINT,
  restEndpoint: DEFAULT_ARCHWAY_MAINNET_REST_ENDPOINT,
  nativeToken: ARCHWAY_MAINNET_NATIVE_TOKEN,
  prefix: "archway",
};
export const ARCHWAY_MAINNET_TOKENS_MAP: Record<string, RegistryToken> = {
  [ARCHWAY_MAINNET_NATIVE_TOKEN.denom]: ARCHWAY_MAINNET_NATIVE_TOKEN,
  "ibc/43897B9739BD63E3A08A88191999C632E052724AB96BD4C74AE31375C991F48D": {
    chainId: "archway-1",
    denom:
      "ibc/43897B9739BD63E3A08A88191999C632E052724AB96BD4C74AE31375C991F48D",
    name: "USDC",
    decimals: 6,
    logo: "https://raw.githubusercontent.com/cosmos/chain-registry/master/noble/images/USDCoin.png",
    coingeckoId: "usd-coin",
    originDenom: "uusdc",
    originChainId: "noble-1",
  },
  "ibc/0471F1C4E7AFD3F07702BEF6DC365268D64570F7C1FDC98EA6098DD6DE59817B": {
    chainId: "archway-1",
    denom:
      "ibc/0471F1C4E7AFD3F07702BEF6DC365268D64570F7C1FDC98EA6098DD6DE59817B",
    name: "OSMO",
    decimals: 6,
    logo: "https://raw.githubusercontent.com/cosmos/chain-registry/master/osmosis/images/osmo.png",
    coingeckoId: "osmosis",
    originDenom: "uosmo",
    originChainId: "osmosis-1",
  },
  "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2": {
    chainId: "archway-1",
    denom:
      "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
    name: "ATOM",
    decimals: 6,
    logo: "https://raw.githubusercontent.com/cosmos/chain-registry/master/cosmoshub/images/atom.png",
    coingeckoId: "cosmos",
    originDenom: "uatom",
    originChainId: "cosmoshub-4",
  },
  "ibc/B68560022FB3CAD599224B16AAEB62FB85848A7674E40B68A0F1982F270B356E": {
    chainId: "archway-1",
    denom:
      "ibc/B68560022FB3CAD599224B16AAEB62FB85848A7674E40B68A0F1982F270B356E",
    name: "TIA",
    decimals: 6,
    logo: "https://raw.githubusercontent.com/cosmos/chain-registry/master/celestia/images/celestia.png",
    coingeckoId: "celestia",
    originDenom: "utia",
    originChainId: "celestia",
  },
};

// TESTNET
export const DEFAULT_ARCHWAY_TESTNET_RPC_ENDPOINT =
  "https://rpc.constantine.archway.io";
export const DEFAULT_ARCHWAY_TESTNET_REST_ENDPOINT =
  "https://api.constantine.archway.io";
export const ARCHWAY_TESTNET_NATIVE_TOKEN: RegistryToken = {
  chainId: "constantine-3",
  denom: "aconst",
  name: "CONST",
  decimals: 18,
  logo: "https://raw.githubusercontent.com/cosmos/chain-registry/refs/heads/master/archway/images/arch.png",
  coingeckoId: "archway",
};
export const ARCHWAY_TESTNET_CHAIN_INFO: ChainInfo = {
  name: "Archway Testnet",
  id: "constantine-3",
  rpcEndpoint: DEFAULT_ARCHWAY_TESTNET_RPC_ENDPOINT,
  restEndpoint: DEFAULT_ARCHWAY_TESTNET_REST_ENDPOINT,
  nativeToken: ARCHWAY_TESTNET_NATIVE_TOKEN,
  prefix: "archway",
};
export const ARCHWAY_TESTNET_TOKENS_MAP: Record<string, RegistryToken> = {
  [ARCHWAY_TESTNET_NATIVE_TOKEN.denom]: ARCHWAY_TESTNET_NATIVE_TOKEN,
  "ibc/34F8D3402273FFA5278AE5757D81CE151ACFD4B19C494C0EE372A7229714824F": {
    chainId: "constantine-3",
    denom:
      "ibc/34F8D3402273FFA5278AE5757D81CE151ACFD4B19C494C0EE372A7229714824F",
    name: "USDC",
    decimals: 6,
    logo: "https://raw.githubusercontent.com/cosmos/chain-registry/master/noble/images/USDCoin.png",
    coingeckoId: "usd-coin",
    originDenom: "uusdc",
    originChainId: "grand-1",
  },
  "ibc/F05050E6851A163E36B927EA821A13A6CE0D596C7B85FBF90570AC57C3F16D5A": {
    chainId: "constantine-3",
    denom:
      "ibc/F05050E6851A163E36B927EA821A13A6CE0D596C7B85FBF90570AC57C3F16D5A",
    name: "OSMO",
    decimals: 6,
    logo: "https://raw.githubusercontent.com/cosmos/chain-registry/master/osmosis/images/osmo.png",
    coingeckoId: "osmosis",
    originDenom: "uosmo",
    originChainId: "osmo-test-5",
  },
};
