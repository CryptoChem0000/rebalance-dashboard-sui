import { OfflineSigner } from "@cosmjs/proto-signing";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

export const getSignerAddress = async (
  signer: OfflineSigner | Ed25519Keypair
): Promise<string> => {
  if (signer instanceof Ed25519Keypair) {
    return signer.toSuiAddress();
  } else {
    const accounts = await signer.getAccounts();

    if (!accounts?.[0]) {
      throw new Error("Signer account's address not found");
    }

    return accounts[0].address;
  }
};
