import { TokenAmount } from "../token-amount";

export abstract class AbstractChainAccount {
  public restEndpoint: string;

  constructor(
    public address: string,
    environment: "mainnet" | "testnet" = "mainnet"
  ) {}

  abstract getAvailableBalances(): Promise<Record<string, TokenAmount>>;

  abstract getTokenAvailableBalance(denom: string): Promise<TokenAmount>;
}
