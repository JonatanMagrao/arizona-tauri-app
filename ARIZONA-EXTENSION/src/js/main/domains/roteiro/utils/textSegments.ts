import type {
  OfferValidationFieldRef,
  OfferValidationFieldKey,
  OfferValidationInfo,
} from "../types";

export interface LineSegment {
  text: string;
  match?: "correct" | "wrong";
  fieldKey?: OfferValidationFieldKey;
  action?: "fix" | "open";
  value?: string;
}

const CARD_INSTALLMENT_MECHANIC_TYPE = "De Por Parcelamento Cartao Carrefour";

const VALIDATED_TYPES = new Set([
  "Simples",
  "De Por",
  "De Por Cartao CRF",
  "De Por Meu CRF (Dual)",
  CARD_INSTALLMENT_MECHANIC_TYPE,
  "Porcentagem Desconto",
  "Desconto X%",
  "Desconto X% Meu CRF",
  "Desconto X% Cartao CRF",
  "Desconto X% Cartao CRF Segunda Unidade",
]);

const PERCENT_MECHANIC_TYPES = new Set([
  "Porcentagem Desconto",
  "Desconto X%",
  "Desconto X% Meu CRF",
  "Desconto X% Cartao CRF",
  "Desconto X% Cartao CRF Segunda Unidade",
]);

const PRICE_PATTERN = /(?:\d{1,3}(?:\.\d{3})+|\d+),\d+/g;
const PERCENT_PATTERN = /\d+(?:,\d+)?%/g;
const LEVE_PAGUE_PATTERN =
  /\b(LEVE(?:\s+X)?\s+)(\d+)(\s+(?:E\s+)?PAGUE(?:\s+Y)?\s+)(\d+)\b/i;

const normalizeValue = (value: string): number =>
  parseFloat(value.replace("%", "").replace(/\./g, "").replace(",", "."));

const normalizeInteger = (value: string | undefined): number =>
  /^\s*\d+\s*$/.test(String(value ?? ""))
    ? parseInt(String(value ?? "").trim(), 10)
    : NaN;

const getMatchStatus = (
  roteiroValue: number,
  aeValue: number
): LineSegment["match"] =>
  Number.isFinite(aeValue) && roteiroValue === aeValue ? "correct" : "wrong";

const getValidationFieldCount = (info: OfferValidationInfo): number => {
  if (info.priceField) return 1;

  let count = 0;
  if (info.deField) count += 1;
  if (info.porField) count += 1;
  if (info.leveField) count += 1;
  if (info.pagueField) count += 1;
  return count;
};

const getValidationField = (
  info: OfferValidationInfo,
  fieldKey: OfferValidationFieldKey
): OfferValidationFieldRef | undefined => {
  if (fieldKey === "price") return info.priceField;
  if (fieldKey === "de") return info.deField;
  if (fieldKey === "por") return info.porField;
  if (fieldKey === "leve") return info.leveField;
  return info.pagueField;
};

const getWrongSegmentAction = (
  info: OfferValidationInfo,
  fieldKey: OfferValidationFieldKey,
  allowDirectFieldFix: boolean = false
): LineSegment["action"] => {
  if (allowDirectFieldFix && getValidationField(info, fieldKey)) {
    return "fix";
  }

  if (info.priceAcceptedValues && info.priceAcceptedValues.length > 1) {
    return "open";
  }

  const fieldCount = getValidationFieldCount(info);

  if (fieldCount === 1 && fieldKey === "price" && info.priceField) {
    return "fix";
  }

  return fieldCount > 0 ? "open" : undefined;
};

const buildLevePagueSegments = (
  line: string,
  info: OfferValidationInfo
): LineSegment[] => {
  if (!info.leveValue || !info.pagueValue) return [{ text: line }];

  const match = LEVE_PAGUE_PATTERN.exec(line);
  if (!match || match.index === undefined) return [{ text: line }];

  const leveStart = match.index + match[1].length;
  const leveEnd = leveStart + match[2].length;
  const pagueStart = leveEnd + match[3].length;
  const pagueEnd = pagueStart + match[4].length;
  const aeLeveValue = normalizeInteger(info.leveValue);
  const aePagueValue = normalizeInteger(info.pagueValue);
  const segments: LineSegment[] = [];

  if (leveStart > 0) {
    segments.push({ text: line.slice(0, leveStart) });
  }

  const leveMatch = getMatchStatus(normalizeInteger(match[2]), aeLeveValue);
  segments.push({
    text: line.slice(leveStart, leveEnd),
    match: leveMatch,
    fieldKey: "leve",
    action: leveMatch === "wrong" ? getWrongSegmentAction(info, "leve") : undefined,
    value: match[2],
  });

  if (pagueStart > leveEnd) {
    segments.push({ text: line.slice(leveEnd, pagueStart) });
  }

  const pagueMatch = getMatchStatus(normalizeInteger(match[4]), aePagueValue);
  segments.push({
    text: line.slice(pagueStart, pagueEnd),
    match: pagueMatch,
    fieldKey: "pague",
    action: pagueMatch === "wrong" ? getWrongSegmentAction(info, "pague") : undefined,
    value: match[4],
  });

  if (pagueEnd < line.length) {
    segments.push({ text: line.slice(pagueEnd) });
  }

  return segments;
};

const getAcceptedPriceValues = (info: OfferValidationInfo): number[] => {
  const values =
    info.priceAcceptedValues && info.priceAcceptedValues.length > 0
      ? info.priceAcceptedValues
      : [info.priceValue];
  const normalized: number[] = [];

  for (let i = 0; i < values.length; i += 1) {
    const value = normalizeValue(values[i]);
    if (Number.isFinite(value)) {
      normalized.push(value);
    }
  }

  return normalized;
};

const getFieldPriceValues = (
  info: OfferValidationInfo,
  fieldKey: OfferValidationFieldKey
): number[] => {
  const field = getValidationField(info, fieldKey);
  if (!field || field.value === "") return getAcceptedPriceValues(info);

  const value = normalizeValue(field.value);
  return Number.isFinite(value) ? [value] : getAcceptedPriceValues(info);
};

const matchesAnyPriceValue = (
  roteiroValue: number,
  aeValues: number[]
): boolean => {
  for (let i = 0; i < aeValues.length; i += 1) {
    if (Math.abs(roteiroValue - aeValues[i]) < 0.001) {
      return true;
    }
  }

  return false;
};

const getCardInstallmentFieldKey = (
  line: string,
  contextStart: number,
  matchIndex: number,
  priceCount: number,
  info: OfferValidationInfo
): OfferValidationFieldKey | undefined => {
  const before = line.slice(contextStart, matchIndex).toUpperCase();

  if (/(VEZES|PARCELA|PARCELAS|JUROS)/.test(before)) {
    return "price";
  }

  if (/\bPOR\s*$/.test(before)) {
    return "por";
  }

  if (/\bA\s+PARTIR\s+DE\s*$/.test(before)) {
    return info.porField ? "por" : undefined;
  }

  if (/\bDE\s*$/.test(before)) {
    return "de";
  }

  if (priceCount === 1 && info.priceField) {
    return "price";
  }

  return undefined;
};

const buildCardInstallmentSegments = (
  line: string,
  info: OfferValidationInfo
): LineSegment[] => {
  const matches: RegExpExecArray[] = [];
  PRICE_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = PRICE_PATTERN.exec(line)) !== null) {
    matches.push(match);
  }

  if (matches.length === 0 || getAcceptedPriceValues(info).length === 0) {
    return [{ text: line }];
  }

  const segments: LineSegment[] = [];
  let lastIndex = 0;

  for (let index = 0; index < matches.length; index += 1) {
    const priceMatch = matches[index];

    if (priceMatch.index > lastIndex) {
      segments.push({ text: line.slice(lastIndex, priceMatch.index) });
    }

    const fieldKey = getCardInstallmentFieldKey(
      line,
      lastIndex,
      priceMatch.index,
      matches.length,
      info
    );
    const aeValues =
      fieldKey !== undefined
        ? getFieldPriceValues(info, fieldKey)
        : getAcceptedPriceValues(info);
    const roteiroValue = normalizeValue(priceMatch[0]);
    const segmentMatch = matchesAnyPriceValue(roteiroValue, aeValues)
      ? "correct"
      : "wrong";
    const action =
      segmentMatch === "wrong" && fieldKey !== undefined
        ? getWrongSegmentAction(info, fieldKey, true)
        : segmentMatch === "wrong"
          ? "open"
          : undefined;

    segments.push({
      text: priceMatch[0],
      match: segmentMatch,
      fieldKey,
      action,
      value: priceMatch[0],
    });

    lastIndex = priceMatch.index + priceMatch[0].length;
  }

  if (lastIndex < line.length) {
    segments.push({ text: line.slice(lastIndex) });
  }

  return segments;
};

export const buildLineSegments = (
  line: string,
  info: OfferValidationInfo | undefined
): LineSegment[] => {
  if (info?.mechanicType === "Leve X Pague Y") {
    return buildLevePagueSegments(line, info);
  }

  if (info?.mechanicType === CARD_INSTALLMENT_MECHANIC_TYPE) {
    return buildCardInstallmentSegments(line, info);
  }

  if (!info || !VALIDATED_TYPES.has(info.mechanicType) || !info.priceValue) {
    return [{ text: line }];
  }

  const isPercent = PERCENT_MECHANIC_TYPES.has(info.mechanicType);
  const pattern = isPercent ? PERCENT_PATTERN : PRICE_PATTERN;
  const aeValues = getAcceptedPriceValues(info);
  const segments: LineSegment[] = [];
  let lastIndex = 0;

  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: line.slice(lastIndex, match.index) });
    }

    const roteiroValue = normalizeValue(match[0]);
    const segmentMatch = matchesAnyPriceValue(roteiroValue, aeValues)
      ? "correct"
      : "wrong";
    segments.push({
      text: match[0],
      match: segmentMatch,
      fieldKey: "price",
      action:
        segmentMatch === "wrong"
          ? getWrongSegmentAction(info, "price")
          : undefined,
      value: match[0],
    });

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < line.length) {
    segments.push({ text: line.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ text: line }];
};

export const mapLinesToOffers = (lines: string[]): number[] => {
  const indices: number[] = [];
  let meaningfulCount = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") {
      indices.push(-1);
    } else if (meaningfulCount === 0) {
      indices.push(-1); // first meaningful line = praça
      meaningfulCount++;
    } else {
      indices.push(meaningfulCount - 1);
      meaningfulCount++;
    }
  }

  return indices;
};
