import { OfflineSigner } from "@cosmjs/proto-signing";
import {
  executeRoute,
  route,
  setClientOptions,
  TransactionState,
} from "@skip-go/client";

import {
  ARCHWAY_MAINNET_CHAIN_INFO,
  ARCHWAY_TESTNET_CHAIN_INFO,
  findRegistryTokenEquivalentOnOtherChain,
  OSMOSIS_MAINNET_CHAIN_INFO,
  OSMOSIS_TESTNET_CHAIN_INFO,
} from "../registry";

import { BridgeTokenResult, BridgeTokenParams } from "./types";

export class SkipBridging {
  rpcEndpointsMap: Record<string, string> = {
    [ARCHWAY_MAINNET_CHAIN_INFO.id]: ARCHWAY_MAINNET_CHAIN_INFO.rpcEndpoint,
    [ARCHWAY_TESTNET_CHAIN_INFO.id]: ARCHWAY_TESTNET_CHAIN_INFO.rpcEndpoint,
    [OSMOSIS_MAINNET_CHAIN_INFO.id]: OSMOSIS_MAINNET_CHAIN_INFO.rpcEndpoint,
    [OSMOSIS_TESTNET_CHAIN_INFO.id]: OSMOSIS_TESTNET_CHAIN_INFO.rpcEndpoint,
  };
  restEndpointsMap: Record<string, string> = {
    [ARCHWAY_MAINNET_CHAIN_INFO.id]: ARCHWAY_MAINNET_CHAIN_INFO.restEndpoint,
    [ARCHWAY_TESTNET_CHAIN_INFO.id]: ARCHWAY_TESTNET_CHAIN_INFO.restEndpoint,
    [OSMOSIS_MAINNET_CHAIN_INFO.id]: OSMOSIS_MAINNET_CHAIN_INFO.restEndpoint,
    [OSMOSIS_TESTNET_CHAIN_INFO.id]: OSMOSIS_TESTNET_CHAIN_INFO.restEndpoint,
  };

  constructor(
    rpcEndpointsOverride?: Record<string, string>,
    restEndpointsOverride?: Record<string, string>
  ) {
    for (const [key, value] of Object.entries(rpcEndpointsOverride ?? {})) {
      this.rpcEndpointsMap[key] = value;
    }
    for (const [key, value] of Object.entries(restEndpointsOverride ?? {})) {
      this.restEndpointsMap[key] = value;
    }
    setClientOptions({
      endpointOptions: {
        getRpcEndpointForChain: async (chainId: string) => {
          if (!this.rpcEndpointsMap[chainId]) {
            throw new Error(
              `No rpc endpoint configured on skip for chain ${chainId}`
            );
          }
          return this.rpcEndpointsMap[chainId];
        },
        getRestEndpointForChain: async (chainId: string) => {
          if (!this.restEndpointsMap[chainId]) {
            throw new Error(
              `No rest endpoint configured on skip for chain ${chainId}`
            );
          }
          return this.restEndpointsMap[chainId];
        },
      },
    });
  }

  async bridgeToken(
    signer: OfflineSigner,
    addressesByChain: Record<string, string>,
    params: BridgeTokenParams
  ): Promise<BridgeTokenResult> {
    const destinationToken = findRegistryTokenEquivalentOnOtherChain(
      params.fromToken,
      params.toChainId
    );

    if (!destinationToken) {
      throw new Error("Bridge destination token not found in system config");
    }

    const payload = {
      sourceAssetDenom: params.fromToken.denom,
      sourceAssetChainId: params.fromToken.chainId,
      destAssetDenom: destinationToken.denom,
      destAssetChainId: destinationToken.chainId,
      amountIn: params.amount,
    };

    const bridgeRoute = await route(payload);

    if (!bridgeRoute) {
      throw new Error("Bridging route not found");
    }

    const userAddresses = bridgeRoute.requiredChainAddresses.map((chainId) => {
      const foundAddress = addressesByChain[chainId];
      if (!foundAddress) {
        throw new Error(`Missing address for the chain ${chainId}`);
      }
      return {
        chainId,
        address: foundAddress,
      };
    });

    let result: BridgeTokenResult | undefined;

    await executeRoute({
      route: bridgeRoute,
      userAddresses,
      getCosmosSigner: async () => signer,
      onTransactionCompleted: async ({ txHash, chainId, status }) => {
        if (status?.error) {
          throw new Error(
            `Error ${status.error.type}: ${
              status.error.message ?? "-"
            }. Details: ${
              status.error.details ?? "-"
            }, chainId: ${chainId}, tx: ${txHash}`
          );
        }

        if (status?.state !== TransactionState.STATE_COMPLETED_SUCCESS) {
          throw new Error(
            `Error ${status?.state}, chainId: ${chainId}, tx: ${txHash}`
          );
        }

        result = {
          txHash,
          chainId,
          status,
        };
      },
      onValidateGasBalance: async (validation) => {
        if (validation.status === "error") {
          throw new Error(
            `Insufficient gas balance or gas validation error on chain ${validation.chainId} (Tx Index: ${validation.txIndex}).`
          );
        }
      },
    });

    if (!result) {
      throw new Error("Transaction failed");
    }

    return result;
  }
}
