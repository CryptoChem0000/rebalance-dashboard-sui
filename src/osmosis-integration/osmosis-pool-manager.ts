import { OfflineSigner } from "@cosmjs/proto-signing";
import { osmosis, getSigningOsmosisClient } from "osmojs";

import { OsmosisCLPool } from "./osmosis-cl-pool";
import {
  DEFAULT_OSMOSIS_MAINNET_REST_ENDPOINT,
  DEFAULT_OSMOSIS_MAINNET_RPC_ENDPOINT,
  DEFAULT_OSMOSIS_TESTNET_REST_ENDPOINT,
  DEFAULT_OSMOSIS_TESTNET_RPC_ENDPOINT,
} from "../registry";

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
        ? DEFAULT_OSMOSIS_MAINNET_RPC_ENDPOINT
        : DEFAULT_OSMOSIS_TESTNET_RPC_ENDPOINT);
    this.restEndpoint =
      restEndpoint ??
      (this.environment === "mainnet"
        ? DEFAULT_OSMOSIS_MAINNET_REST_ENDPOINT
        : DEFAULT_OSMOSIS_TESTNET_REST_ENDPOINT);
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

  async getSignerWithSigningClient(
    signer?: OfflineSigner,
    signingClient?: OsmosisSigningClient
  ): Promise<SignerWithSigningClient> {
    if (signer && signingClient) {
      this.signer = signer;
      this.signingClient = signingClient;
    } else {
      if (!signer) {
        throw new Error("Missing Signer to create signing client");
      }

      this.signer = signer;
      this.signingClient = await getSigningOsmosisClient({
        rpcEndpoint: this.rpcEndpoint,
        signer: this.signer,
      });
    }

    return {
      signer: this.signer,
      signingClient: this.signingClient,
    };
  }

  async createOsmosisCLPool(
    params: CreatePoolParams,
    signer?: OfflineSigner,
    signingClient?: OsmosisSigningClient
  ): Promise<OsmosisCLPool> {
    const queryClient = await this.getQueryClient();
    const signingClientResult = await this.getSignerWithSigningClient(signer, signingClient);

    return await OsmosisCLPool.createPool(
      queryClient,
      signingClientResult.signer,
      signingClientResult.signingClient,
      params
    );
  }

  async getOsmosisCLPool(
    poolId: string,
    signer?: OfflineSigner,
    signingClient?: OsmosisSigningClient
  ): Promise<OsmosisCLPool> {
    const queryClient = await this.getQueryClient();
    const signingClientResult = await this.getSignerWithSigningClient(signer, signingClient);

    return new OsmosisCLPool(
      poolId,
      queryClient,
      signingClientResult.signer,
      signingClientResult.signingClient,
      this.environment
    );
  }
}
