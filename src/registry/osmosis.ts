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
    logo: "https://raw.githubusercontent.com/cosmos/chain-registry/refs/heads/master/_non-cosmos/ethereum/images/usdc.png",
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
  "ibc/64BA6E31FE887D66C6F8F31C7B1A80C7CA179239677B4088BB55F5EA07DBE273": {
    chainId: "osmosis-1",
    denom:
      "ibc/64BA6E31FE887D66C6F8F31C7B1A80C7CA179239677B4088BB55F5EA07DBE273",
    name: "INJ",
    decimals: 18,
    logo: "https://raw.githubusercontent.com/cosmos/chain-registry/master/injective/images/inj.png",
    coingeckoId: "injective-protocol",
    originDenom: "inj",
    originChainId: "injective-1",
  },
  "factory/osmo1z0qrq605sjgcqpylfl4aa6s90x738j7m58wyatt0tdzflg2ha26q67k743/wbtc":
    {
      chainId: "osmosis-1",
      denom:
        "factory/osmo1z0qrq605sjgcqpylfl4aa6s90x738j7m58wyatt0tdzflg2ha26q67k743/wbtc",
      name: "WBTC.osmo",
      decimals: 8,
      logo: "https://raw.githubusercontent.com/cosmos/chain-registry/master/_non-cosmos/ethereum/images/wbtc.png",
      coingeckoId: "wrapped-bitcoin",
    },
  "ibc/EA1D43981D5C9A1C4AAEA9C23BB1D4FA126BA9BC7020A25E0AE4AA841EA25DC5": {
    chainId: "osmosis-1",
    denom:
      "ibc/EA1D43981D5C9A1C4AAEA9C23BB1D4FA126BA9BC7020A25E0AE4AA841EA25DC5",
    name: "WETH.axl",
    decimals: 18,
    logo: "https://raw.githubusercontent.com/cosmos/chain-registry/master/_non-cosmos/ethereum/images/eth-white.png",
    coingeckoId: "axlweth",
    originDenom: "weth-wei",
    originChainId: "axelar-dojo-1",
  },
  "ibc/1480B8FD20AD5FCAE81EA87584D269547DD4D436843C1D20F15E00EB64743EF4": {
    chainId: "osmosis-1",
    denom:
      "ibc/1480B8FD20AD5FCAE81EA87584D269547DD4D436843C1D20F15E00EB64743EF4",
    name: "AKT",
    decimals: 6,
    logo: "https://raw.githubusercontent.com/cosmos/chain-registry/master/akash/images/akt.png",
    coingeckoId: "akash-network",
    originDenom: "uakt",
    originChainId: "akashnet-2",
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
    logo: "https://raw.githubusercontent.com/cosmos/chain-registry/refs/heads/master/_non-cosmos/ethereum/images/usdc.png",
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
