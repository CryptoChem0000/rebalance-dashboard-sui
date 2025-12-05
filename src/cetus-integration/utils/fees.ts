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

export const extractPlatformFees = (
  txResponse: SuiTransactionBlockResponse,
  feeToken: RegistryToken
): TokenAmount => {
  const z = txResponse.events?.[0]?.parsedJson as
    | Record<string, unknown>
    | undefined;
  const y = z?.amount_out ?? "0";
  const totalPlatformFee = BigNumber(
    (txResponse.events?.[0]?.parsedJson as Record<string, any> | undefined)
      ?.swap_fee ?? "0"
  );

  return new TokenAmount(totalPlatformFee, feeToken);
};
