import { TransferStatus } from "@skip-go/client";

import { RegistryToken } from "../../registry";

export type BridgeTokenParams = {
  fromToken: RegistryToken;
  toChainId: string;
  amount: string;
};

export type BridgeTokenResult = {
  chainId: string;
  txHash: string;
  status?: TransferStatus;
};
