import { FEE_VALUES } from "@osmonauts/utils";
import { BigNumber } from "bignumber.js";
import { EncodeObject } from "osmojs";

import { DEFAULT_GAS_MULTIPLIER, NATIVE_TOKEN_DENOM } from "../constants";

import { OsmosisSigningClient } from "../types";

export const simulateFees = async (
  signingClient: OsmosisSigningClient,
  sender: string,
  messages: EncodeObject[],
  memo: string,
  fees: "low" | "medium" | "high" = "medium",
  gasMultiplier: number = DEFAULT_GAS_MULTIPLIER
) => {
  const gasEstimated = await signingClient.simulate(sender, messages, memo);

  return {
    amount: [{ denom: NATIVE_TOKEN_DENOM, amount: FEE_VALUES.osmosis[fees] }],
    gas: BigNumber(gasEstimated).times(gasMultiplier).toFixed(0),
  };
};
