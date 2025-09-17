import { ALL_CHAINS_TOKEN_MAP } from "../all-chains";

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
