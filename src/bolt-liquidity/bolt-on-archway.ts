import { BoltCosmWasmClient } from "@bolt-liquidity-hq/cosmwasm-client";
import { SwapParams } from "@bolt-liquidity-hq/core";
import { OfflineSigner } from "@cosmjs/proto-signing";

export class BoltOnArchway {
  boltClient: BoltCosmWasmClient;

  constructor(
    environment: "mainnet" | "testnet" = "mainnet",
    rpcEndpoint?: string,
    restEndpoint?: string
  ) {
    this.boltClient = new BoltCosmWasmClient({
      environment,
      chain: 'archway',
      customOverride: { chainConfig: { rpcEndpoint, restEndpoint } },
    });
  }

  async swap(
    signer: OfflineSigner,
    params: SwapParams
  ): ReturnType<BoltCosmWasmClient["swap"]> {
    return await this.boltClient.swap(params, signer);
  }
}
