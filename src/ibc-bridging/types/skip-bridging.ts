import { TransferStatus } from "@skip-go/client";

import { RegistryToken } from "../../registry";

export type BridgeTokenParams = {
  fromToken: RegistryToken;
  toChainId: string;
  amount: string;
};

export type BridgeTokenResult = {
  destinationToken: RegistryToken;
  destinationAddress: string;
  txHash: string;
  chainId: string;
  status?: TransferStatus;
};
