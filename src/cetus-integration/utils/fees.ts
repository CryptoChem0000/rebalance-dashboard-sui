import { SuiTransactionBlockResponse } from "@mysten/sui/client";
import { BigNumber } from "bignumber.js";

import { TokenAmount } from "../../account-balances/token-amount";
import { RegistryToken } from "../../registry";

export const extractGasFees = (
  txResponse: SuiTransactionBlockResponse,
  nativeToken: RegistryToken
): TokenAmount => {
  const totalGasFee = BigNumber(
    txResponse?.effects?.gasUsed.computationCost ?? 0
  )
    .plus(txResponse?.effects?.gasUsed.storageCost ?? 0)
    .minus(txResponse?.effects?.gasUsed.storageRebate ?? 0);

  return new TokenAmount(totalGasFee, nativeToken);
};
