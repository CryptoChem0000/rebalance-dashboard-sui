import { OfflineSigner } from "@cosmjs/proto-signing";
import { osmosis, getSigningOsmosisClient } from "osmojs";

export type OsmosisQueryClient = Awaited<
  ReturnType<typeof osmosis.ClientFactory.createRPCQueryClient>
>;

export type OsmosisSigningClient = Awaited<
  ReturnType<typeof getSigningOsmosisClient>
>;

export type Environment = "mainnet" | "testnet";

export type SignerWithSigningClient = {
  signer: OfflineSigner;
  signingClient: OsmosisSigningClient;
};
