import type {
  OfferValidationFieldRef,
  OfferValidationFieldKey,
  OfferValidationInfo,
} from "../types";
import { isAllTakePayMechanicType } from "../../../../../shared/allTakePayMechanic";

export interface LineSegment {
  text: string;
  match?: "correct" | "wrong";
  fieldKey?: OfferValidationFieldKey;
  action?: "fix" | "open";
  value?: string;
}

const INSTALLMENT_MECHANIC_TYPE = "De X Por Y Parcelamento";

const VALIDATED_TYPES = new Set([
  "Simples",
  "De X Por Y | X% Desconto | Leve X Pague Y",
  "Todos A Com X% Desconto",
]);

const PRICE_PATTERN = /(?:\d{1,3}(?:\.\d{3})+|\d+),\d+|\b\d+\s+centavos?\b/gi;
const PERCENT_PATTERN = /\d+(?:,\d+)?%/g;
const LEVE_PAGUE_PATTERN =
  /\b(LEVE(?:\s+X)?\s+)(\d+)(\s+(?:E\s+)?PAGUE(?:\s+Y)?\s+)(\d+)\b/i;

const normalizePriceMatch = (value: string): string => {
  const cents = /^(\d+)\s+centavos?$/i.exec(value);
  return cents ? (Number(cents[1]) / 100).toFixed(2).replace(".", ",") : value;
};

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
  if (!field || field.value === "") return [];

  const value = normalizeValue(field.value);
  return Number.isFinite(value) ? [value] : [];
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

const getInstallmentFieldKey = (
  line: string,
  contextStart: number,
  matchIndex: number,
  info: OfferValidationInfo
): OfferValidationFieldKey | undefined => {
  const before = line.slice(contextStart, matchIndex).toUpperCase();

  if (/(VEZES|PARCELA|PARCELAS|JUROS)/.test(before) || /\b\d+\s*X\s*(?:DE\s*)?$/.test(before)) {
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

  return undefined;
};

const buildInstallmentSegments = (
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

    const fieldKey = getInstallmentFieldKey(
      line,
      lastIndex,
      priceMatch.index,
      info
    );
    const aeValues =
      fieldKey !== undefined
        ? getFieldPriceValues(info, fieldKey)
        : getAcceptedPriceValues(info);
    const fieldValue = normalizePriceMatch(priceMatch[0]);
    const roteiroValue = normalizeValue(fieldValue);
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
      value: fieldValue,
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
  if (info && isAllTakePayMechanicType(info.mechanicType)) {
    return buildLevePagueSegments(line, info);
  }

  if (info?.mechanicType === INSTALLMENT_MECHANIC_TYPE) {
    return buildInstallmentSegments(line, info);
  }

  if (!info || !VALIDATED_TYPES.has(info.mechanicType) || !info.priceValue) {
    return [{ text: line }];
  }

  const isPercent = info.mechanicType === "Todos A Com X% Desconto";
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

    const fieldValue = isPercent ? match[0] : normalizePriceMatch(match[0]);
    const roteiroValue = normalizeValue(fieldValue);
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
      value: fieldValue,
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
