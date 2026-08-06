const PRICE_PATTERN = /(?:\d{1,3}(?:\.\d{3})+|\d+),\d+/g;
const PERCENT_PATTERN = /\d+(?:,\d+)?%/g;
const LEVE_PAGUE_PATTERN =
  /\b(LEVE(?:\s+X)?\s+)(\d+)(\s+(?:E\s+)?PAGUE(?:\s+Y)?\s+)(\d+)\b/gi;

export function getRoteiroHighlightRanges(text) {
  const value = String(text || "");
  const ranges = [];

  LEVE_PAGUE_PATTERN.lastIndex = 0;
  let mechanicMatch;
  while ((mechanicMatch = LEVE_PAGUE_PATTERN.exec(value)) !== null) {
    const leveStart = mechanicMatch.index + mechanicMatch[1].length;
    const leveEnd = leveStart + mechanicMatch[2].length;
    const pagueStart = leveEnd + mechanicMatch[3].length;
    const pagueEnd = pagueStart + mechanicMatch[4].length;
    ranges.push({ start: leveStart, end: leveEnd });
    ranges.push({ start: pagueStart, end: pagueEnd });
  }

  addPatternRanges(value, PRICE_PATTERN, ranges);
  addPatternRanges(value, PERCENT_PATTERN, ranges);

  return ranges
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .filter((range, index, sorted) => index === 0 || range.start >= sorted[index - 1].end);
}

function addPatternRanges(text, pattern, ranges) {
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
}
