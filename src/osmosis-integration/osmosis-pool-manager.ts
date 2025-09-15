import { OfflineSigner } from "@cosmjs/proto-signing";
import { osmosis, getSigningOsmosisClient } from "osmojs";

import {
  DEFAULT_MAINNET_REST_ENDPOINT,
  DEFAULT_MAINNET_RPC_ENDPOINT,
  DEFAULT_TESTNET_REST_ENDPOINT,
  DEFAULT_TESTNET_RPC_ENDPOINT,
} from "./constants";
import { OsmosisCLPool } from "./osmosis-cl-pool";

import {
  CreatePoolParams,
  Environment,
  OsmosisPoolManagerParams,
  OsmosisQueryClient,
  OsmosisSigningClient,
  SignerWithSigningClient,
} from "./types";

export class OsmosisPoolManager {
  public environment: Environment;
  public rpcEndpoint: string;
  public restEndpoint: string;
  public queryClient?: OsmosisQueryClient;
  public signer?: OfflineSigner;
  public signingClient?: OsmosisSigningClient;

  constructor(params?: OsmosisPoolManagerParams) {
    const {
      environment,
      rpcEndpoint,
      restEndpoint,
      queryClient,
      signingClient,
    } = params ?? {};

    this.environment = environment ?? "mainnet";
    this.rpcEndpoint =
      rpcEndpoint ??
      (this.environment === "mainnet"
        ? DEFAULT_MAINNET_RPC_ENDPOINT
        : DEFAULT_TESTNET_RPC_ENDPOINT);
    this.restEndpoint =
      restEndpoint ??
      (this.environment === "mainnet"
        ? DEFAULT_MAINNET_REST_ENDPOINT
        : DEFAULT_TESTNET_REST_ENDPOINT);
    this.queryClient = queryClient;
    this.signingClient = signingClient;
  }

  async getQueryClient(): Promise<OsmosisQueryClient> {
    if (!this.queryClient) {
      this.queryClient = await osmosis.ClientFactory.createRPCQueryClient({
        rpcEndpoint: this.rpcEndpoint,
      });
    }
    return this.queryClient;
  }

  async getSigningClient(
    newSigner?: OfflineSigner
  ): Promise<SignerWithSigningClient> {
    if (!this.signingClient || !this.signer || newSigner) {
      this.signer = newSigner ?? this.signer;

      if (!this.signer) {
        throw new Error("Missing Signer to create signing client");
      }

      this.signingClient = await getSigningOsmosisClient({
        rpcEndpoint: this.rpcEndpoint,
        signer: this.signer,
      });
    }

    if (!this.signer) {
      throw new Error("Missing Signer to create signing client");
    }

    return {
      signer: this.signer,
      signingClient: this.signingClient,
    };
  }

  async createOsmosisCLPool(
    params: CreatePoolParams,
    signer?: OfflineSigner
  ): Promise<OsmosisCLPool> {
    const queryClient = await this.getQueryClient();
    const signingClient = await this.getSigningClient(signer);

    return await OsmosisCLPool.createPool(
      queryClient,
      signingClient.signer,
      signingClient.signingClient,
      params
    );
  }

  async getOsmosisCLPool(
    poolId: string,
    signer?: OfflineSigner
  ): Promise<OsmosisCLPool> {
    const queryClient = await this.getQueryClient();
    const signingClient = await this.getSigningClient(signer);

    return new OsmosisCLPool(
      poolId,
      queryClient,
      signingClient.signer,
      signingClient.signingClient
    );
  }
}
