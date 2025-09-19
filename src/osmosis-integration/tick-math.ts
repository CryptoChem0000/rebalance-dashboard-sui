import { BigNumber } from "bignumber.js";

import { AuthorizedTickSpacing } from "./types";

export class OsmosisTickMath {
  // Constants from Osmosis
  static EXPONENT_AT_PRICE_ONE = -6;
  static MIN_TICK = new BigNumber("-108000000");
  static MAX_TICK = new BigNumber("342000000");
  static MIN_SPOT_PRICE = new BigNumber("0.000000000001"); // 10^-12
  static MAX_SPOT_PRICE = new BigNumber(
    "100000000000000000000000000000000000000"
  ); // 10^38

  // Osmosis tick to price conversion
  static tickToPrice(tickIndex: BigNumber.Value): string {
    const tick = new BigNumber(tickIndex);

    if (tick.isZero()) {
      return "1";
    }

    if (tick.lt(this.MIN_TICK) || tick.gt(this.MAX_TICK)) {
      throw new Error(`Tick out of range: ${tick.toFixed()}`);
    }

    const geometricExponentIncrementDistanceInTicks = new BigNumber(9).times(
      new BigNumber(10).pow(-this.EXPONENT_AT_PRICE_ONE)
    );

    const geometricExponentDelta = tick.dividedToIntegerBy(
      geometricExponentIncrementDistanceInTicks
    );

    let exponentAtCurTick = new BigNumber(this.EXPONENT_AT_PRICE_ONE).plus(
      geometricExponentDelta
    );

    if (tick.lt(0)) {
      exponentAtCurTick = exponentAtCurTick.minus(1);
    }

    const currentAdditiveIncrementInTicks = new BigNumber(10).pow(
      exponentAtCurTick
    );

    const numAdditiveTicks = tick.minus(
      geometricExponentDelta.times(
        geometricExponentIncrementDistanceInTicks.integerValue(BigNumber.ROUND_DOWN)
      )
    );

    const price = new BigNumber(10)
      .pow(geometricExponentDelta)
      .plus(numAdditiveTicks.times(currentAdditiveIncrementInTicks));

    if (price.gt(this.MAX_SPOT_PRICE) || price.lt(this.MIN_SPOT_PRICE)) {
      throw new Error(`Price out of range: ${price.toFixed()}`);
    }

    return price.toFixed();
  }

  // Osmosis price to tick conversion
  static priceToTick(price: BigNumber.Value): string {
    const priceBN = new BigNumber(price);

    if (priceBN.eq(1)) {
      return "0";
    }

    if (priceBN.lte(0)) {
      throw new Error("Price must be positive");
    }

    if (priceBN.gt(this.MAX_SPOT_PRICE) || priceBN.lt(this.MIN_SPOT_PRICE)) {
      throw new Error(`Price out of bounds: ${priceBN.toFixed()}`);
    }

    const geometricExponentIncrementDistanceInTicks = new BigNumber(9).times(
      new BigNumber(10).pow(-this.EXPONENT_AT_PRICE_ONE)
    );

    let currentPrice = new BigNumber(1);
    let ticksPassed = new BigNumber(0);
    let exponent;

    if (priceBN.gt(1)) {
      // Price > 1 case
      let maxPriceInTickIncrement = new BigNumber(10);
      exponent = new BigNumber(0);

      while (maxPriceInTickIncrement.lt(priceBN)) {
        exponent = exponent.plus(1);
        maxPriceInTickIncrement = maxPriceInTickIncrement.times(10);
      }

      currentPrice = maxPriceInTickIncrement.div(10);
      ticksPassed = geometricExponentIncrementDistanceInTicks
        .integerValue(BigNumber.ROUND_DOWN)
        .times(exponent);
    } else {
      // Price < 1 case
      let minPriceInTheExponent = new BigNumber(0.1);
      exponent = new BigNumber(-1);

      while (minPriceInTheExponent.gt(priceBN)) {
        exponent = exponent.minus(1);
        minPriceInTheExponent = minPriceInTheExponent.div(10);
      }

      currentPrice = minPriceInTheExponent;
      ticksPassed = ticksPassed.minus(
        geometricExponentIncrementDistanceInTicks
          .integerValue(BigNumber.ROUND_DOWN)
          .times(exponent.negated())
      );
    }

    const currentAdditiveIncrementInTicks = new BigNumber(10).pow(
      new BigNumber(this.EXPONENT_AT_PRICE_ONE).plus(exponent)
    );

    const ticksToBeFilledByCurrentExponent = priceBN
      .minus(currentPrice)
      .div(currentAdditiveIncrementInTicks);

    return ticksPassed
      .plus(ticksToBeFilledByCurrentExponent.integerValue(BigNumber.ROUND_DOWN))
      .toFixed();
  }

  // Convert sqrt price from chain to price
  static sqrtPriceToPrice(sqrtPriceStr: BigNumber.Value): string {
    const sqrtPrice = new BigNumber(sqrtPriceStr).div(
      new BigNumber(10).pow(18)
    );
    return sqrtPrice.pow(2).toFixed();
  }

  // Tick to sqrt price
  static tickToSqrtPrice(tickIndex: BigNumber.Value): string {
    const price = BigNumber(this.tickToPrice(tickIndex));
    return price.sqrt().toFixed();
  }

  // Round price to nearest tick with spacing
  static roundPriceToNearestTick(
    price: BigNumber.Value,
    tickSpacing: AuthorizedTickSpacing,
    isLowerTick = true
  ): string {
    const priceBN = new BigNumber(price);
    const tickSpacingBN = new BigNumber(tickSpacing);

    // Clamp price to valid range
    let clampedPrice = priceBN;
    if (priceBN.gt(this.MAX_SPOT_PRICE)) {
      clampedPrice = this.MAX_SPOT_PRICE;
    } else if (priceBN.lt(this.MIN_SPOT_PRICE)) {
      clampedPrice = this.MIN_SPOT_PRICE;
    }

    // Get tick from price
    let tick = BigNumber(this.priceToTick(clampedPrice));

    // Round to tick spacing if not zero
    if (!tickSpacingBN.isZero()) {
      const tickRemainder = tick.mod(tickSpacingBN);

      // Negative tick remainder
      if (tickRemainder.lt(0)) {
        tick = tick.minus(tickRemainder);
        if (isLowerTick) {
          tick = tick.plus(tickSpacingBN);
        } else {
          tick = tick.minus(tickSpacingBN);
        }
      }
      // Positive tick remainder
      else if (tickRemainder.gt(0)) {
        tick = tick.minus(tickRemainder);
        if (isLowerTick) {
          tick = tick.plus(tickSpacingBN);
        }
      }
    }

    // Convert back to price via sqrt price
    const sqrtPrice = BigNumber(this.tickToSqrtPrice(tick));
    return sqrtPrice.times(sqrtPrice).toFixed();
  }

  // Helper to round tick to spacing
  static roundToTickSpacing(
    tick: BigNumber.Value,
    tickSpacing: AuthorizedTickSpacing
  ): string {
    const tickBN = new BigNumber(tick);
    const spacingBN = new BigNumber(tickSpacing);

    const remainder = tickBN.mod(spacingBN);

    if (remainder.isZero()) {
      return tickBN.toFixed();
    }

    if (tickBN.lt(0)) {
      // Negative tick
      return tickBN.minus(remainder).minus(spacingBN).toFixed();
    } else {
      // Positive tick
      return tickBN.minus(remainder).toFixed();
    }
  }
}
