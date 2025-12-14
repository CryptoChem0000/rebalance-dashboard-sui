export type RegistryToken = {
  chainId: string;
  denom: string;
  name: string;
  decimals: number;
  logo?: string;
  coingeckoId?: string;
  originDenom?: string;
  originChainId?: string;
};
