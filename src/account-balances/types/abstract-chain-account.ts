import { TokenAmount } from "../token-amount";

export abstract class AbstractChainAccount {
  constructor(
    public address: string,
  ) {}

  abstract getAvailableBalances(): Promise<Record<string, TokenAmount>>;

  abstract getTokenAvailableBalance(denom: string): Promise<TokenAmount>;
}
