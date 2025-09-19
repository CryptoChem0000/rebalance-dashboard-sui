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
