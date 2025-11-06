import { parseDateString } from "../../utils/parsers";

export const createRangeVisual = (
  percentage: number,
  width: number = 50
): string => {
  const position = Math.round((percentage / 100) * width);
  const leftBracket = "[";
  const rightBracket = "]";
  const filledChar = "=";
  const emptyChar = "-";
  const positionChar = "●";

  let visual = leftBracket;
  for (let i = 0; i < width; i++) {
    if (i === position) {
      visual += positionChar;
    } else if (i < position) {
      visual += filledChar;
    } else {
      visual += emptyChar;
    }
  }
  visual += rightBracket;

  return visual;
};

export const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const parseDateOptions = (options: { start?: string; end?: string }) => {
  let startDate: Date | undefined;
  let endDate: Date | undefined;

  if (options.start) {
    try {
      startDate = new Date(options.start);
      if (isNaN(+startDate)) {
        throw new Error();
      }
    } catch (error) {
      console.error(
        `❌ Invalid start date: ${options.start}. Use format DD-MM-YYYY`
      );
      process.exit(1);
    }
  }

  if (options.end) {
    try {
      endDate = new Date(options.end);
      if (isNaN(+endDate)) {
        throw new Error();
      }
      if (
        endDate.getHours() === 0 &&
        endDate.getMinutes() === 0 &&
        endDate.getSeconds() === 0 &&
        endDate.getMilliseconds() === 0
      ) {
        // Set to end of day to include the entire day
        endDate.setHours(23, 59, 59, 999);
      }
    } catch (error) {
      console.error(
        `❌ Invalid end date: ${options.end}. Use format DD-MM-YYYY`
      );
      process.exit(1);
    }
  }

  // Validate that start date is not after end date
  if (startDate && endDate && startDate > endDate) {
    console.error("❌ Start date cannot be after end date");
    process.exit(1);
  }

  return { startDate, endDate };
};
