import { RegistryToken } from "./token";

export type ChainInfo = {
  name: string;
  id: string;
  prefix: string;
  rpcEndpoint: string;
  restEndpoint: string;
  nativeToken: RegistryToken;
};
