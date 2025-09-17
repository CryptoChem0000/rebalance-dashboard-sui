import { BoltCosmWasmClient } from "@bolt-liquidity-hq/cosmwasm-client";

export class BoltOnArchway {
  static makeBoltClient(
    environment: "mainnet" | "testnet" = "mainnet",
    rpcEndpoint?: string,
    restEndpoint?: string
  ) {
    return new BoltCosmWasmClient({
      environment,
      chain: "archway",
      customOverride: { chainConfig: { rpcEndpoint, restEndpoint } },
    });
  }
}
