import { OfflineSigner } from "@cosmjs/proto-signing";

export const getSignerAddress = async (
  signer: OfflineSigner
): Promise<string> => {
  const accounts = await signer.getAccounts();

  if (!accounts?.[0]) {
    throw new Error("Signer account's address not found");
  }

  return accounts[0].address;
};
