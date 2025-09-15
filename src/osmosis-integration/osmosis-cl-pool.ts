import { OfflineSigner } from "@cosmjs/proto-signing";
import BigNumber from "bignumber.js";
import { MsgCreateConcentratedPoolResponse } from "osmojs/osmosis/concentratedliquidity/poolmodel/concentrated/v1beta1/tx";
import {
  MsgCreatePositionResponse,
  MsgWithdrawPositionResponse,
} from "osmojs/osmosis/concentratedliquidity/v1beta1/tx";
import {
  PoolResponse,
  SpotPriceResponse,
} from "osmojs/osmosis/poolmanager/v1beta1/query";
import { osmosis } from "osmojs";

import { getSignerAddress } from "../utils";
import { simulateFees } from "./utils";

import {
  CreatePoolParams,
  CreatePositionParams,
  CreatePositionResponse,
  OsmosisQueryClient,
  OsmosisSigningClient,
  WithdrawPositionParams,
} from "./types";

export class OsmosisCLPool {
  public token0?: string;
  public token1?: string;

  constructor(
    public poolId: string,
    public queryClient: OsmosisQueryClient,
    public signer: OfflineSigner,
    public signingClient: OsmosisSigningClient,
    token0?: string,
    token1?: string
  ) {
    this.token0 = token0;
    this.token1 = token1;
  }

  static async createPool(
    queryClient: OsmosisQueryClient,
    signer: OfflineSigner,
    signingClient: OsmosisSigningClient,
    params: CreatePoolParams,
    memo: string = ""
  ): Promise<OsmosisCLPool> {
    const sender = await getSignerAddress(signer);

    const msg =
      osmosis.concentratedliquidity.poolmodel.concentrated.v1beta1.MessageComposer.withTypeUrl.createConcentratedPool(
        {
          denom0: params.token0,
          denom1: params.token1,
          sender,
          spreadFactor: BigNumber(params.spreadFactor).toFixed(),
          tickSpacing: BigInt(params.tickSpacing),
        }
      );

    const fees = await simulateFees(signingClient, sender, [msg], memo);

    const response = await signingClient.signAndBroadcast(
      sender,
      [msg],
      fees,
      memo
    );

    if (!response.msgResponses?.[0]?.value) {
      throw new Error("No valid response from the Create Pool transaction");
    }

    const parsedResponse = MsgCreateConcentratedPoolResponse.decode(
      response.msgResponses[0].value
    );

    const newPoolId = BigNumber(parsedResponse.poolId).toFixed();

    return new OsmosisCLPool(
      newPoolId,
      queryClient,
      signer,
      signingClient,
      params.token0,
      params.token1
    );
  }

  async createPosition(
    params: CreatePositionParams,
    memo: string = ""
  ): Promise<CreatePositionResponse> {
    const sender = await getSignerAddress(this.signer);

    const msg =
      osmosis.concentratedliquidity.v1beta1.MessageComposer.withTypeUrl.createPosition(
        {
          poolId: BigInt(this.poolId),
          sender,
          lowerTick: BigInt(params.lowerTick),
          upperTick: BigInt(params.upperTick),
          tokensProvided: params.tokensProvided,
          tokenMinAmount0: params.tokenMinAmount0,
          tokenMinAmount1: params.tokenMinAmount1,
        }
      );

    const fees = await simulateFees(this.signingClient, sender, [msg], memo);

    const response = await this.signingClient.signAndBroadcast(
      sender,
      [msg],
      fees,
      memo
    );

    if (!response.msgResponses?.[0]?.value) {
      throw new Error("No valid response from the Create Position transaction");
    }

    const parsedResponse = MsgCreatePositionResponse.decode(
      response.msgResponses[0].value
    );

    return {
      positionId: BigNumber(parsedResponse.positionId).toFixed(),
      amount0: parsedResponse.amount0,
      amount1: parsedResponse.amount1,
      liquidityCreated: parsedResponse.liquidityCreated,
      lowerTick: BigNumber(parsedResponse.lowerTick).toFixed(),
      upperTick: BigNumber(parsedResponse.upperTick).toFixed(),
    };
  }

  async withdrawPosition(
    params: WithdrawPositionParams,
    memo: string = ""
  ): Promise<MsgWithdrawPositionResponse> {
    const sender = await getSignerAddress(this.signer);

    const msg =
      osmosis.concentratedliquidity.v1beta1.MessageComposer.withTypeUrl.withdrawPosition(
        {
          positionId: BigInt(params.positionId),
          sender,
          liquidityAmount: params.liquidityAmount,
        }
      );

    const fees = await simulateFees(
      this.signingClient,
      sender,
      [msg],
      memo,
      "high"
    );

    const response = await this.signingClient.signAndBroadcast(
      sender,
      [msg],
      fees,
      memo
    );

    if (!response.msgResponses?.[0]?.value) {
      throw new Error(
        "No valid response from the Withdraw Position transaction"
      );
    }

    return MsgWithdrawPositionResponse.decode(response.msgResponses[0].value);
  }

  async getPoolInfo(): Promise<PoolResponse> {
    const response = await this.queryClient.osmosis.poolmanager.v1beta1.pool({
      poolId: BigInt(this.poolId),
    });

    this.token0 = response.pool?.["token0"];
    this.token1 = response.pool?.["token1"];

    return response;
  }

  async getPoolSpotPrice(): Promise<SpotPriceResponse> {
    return await this.queryClient.osmosis.poolmanager.v1beta1.spotPrice({
      poolId: BigInt(this.poolId),
      baseAssetDenom: "uosmo",
      quoteAssetDenom: "uion",
    });
  }

  async getPositionInfo(positionId: string): Promise<any> {
    return await this.queryClient.osmosis.concentratedliquidity.v1beta1.positionById(
      {
        positionId: BigInt(positionId),
      }
    );
  }

  async getAritmethicTwapToNow(
    token0?: string,
    token1?: string,
    startTime?: Date
  ): Promise<any> {
    let token0Denom = token0 ?? this.token0;
    let token1Denom = token1 ?? this.token1;
    if (!token0Denom || !token1Denom) {
      await this.getPoolInfo();
      token0Denom = this.token0;
      token1Denom = this.token1;

      if (!token0Denom || !token1Denom) {
        throw new Error("Token pair denoms not found");
      }
    }

    return await this.queryClient.osmosis.twap.v1beta1.arithmeticTwapToNow({
      poolId: BigInt(this.poolId),
      baseAsset: token0Denom,
      quoteAsset: token1Denom,
      startTime: startTime ?? new Date(Date.now() - 24 * 60 * 60 * 1000), // Default to 1 day ago
    });
  }
}
