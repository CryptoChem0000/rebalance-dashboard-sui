
import { Coin } from "@cosmjs/proto-signing";

export const parseStringToCoin = (value: string): Coin => {
  const match = value.match(/^(\d+)(.*)$/);

  if (match && match[1] && match[2]) {
    return {
      amount: match[1],
      denom: match[2],
    };
  }

  return {
    amount: "0",
    denom: value,
  };
};
