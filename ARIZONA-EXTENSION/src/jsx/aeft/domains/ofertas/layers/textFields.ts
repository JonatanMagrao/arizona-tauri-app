import type { InternalTextField, OfferFieldFormat } from "../types";
import {
  addError,
  getLayerByIndex,
  getLayerByName,
  getLayerSource,
} from "./findLayers";

export const getNestedTextProperty = (
  precompLayer: Layer,
  textLayerName: string,
  context: string,
  errors: string[]
): Property | null => {
  const source = getLayerSource(precompLayer, context, errors);
  if (source === null) return null;

  return getTextPropertyByLayerName(source, textLayerName, context, errors);
};

export const getTextPropertyByLayerName = (
  source: CompItem | null,
  layerName: string,
  context: string,
  errors: string[]
): Property | null => {
  if (source === null) return null;

  const layer = getLayerByName(source, layerName);
  if (layer === null) {
    addError(errors, 'Nao encontrei a layer "' + layerName + '" em ' + context + ".");
    return null;
  }

  const property = getSourceTextProperty(layer);
  if (property === null) {
    addError(
      errors,
      'A layer "' + layerName + '" nao possui Source Text em ' + context + "."
    );
  }

  return property;
};

export const getSourceTextProperty = (layer: Layer | null): Property | null => {
  if (layer === null) return null;

  try {
    if (layer instanceof TextLayer && layer.text.sourceText) {
      return layer.text.sourceText as Property;
    }
  } catch (error) {
  }

  try {
    return layer
      .property("ADBE Text Properties")
      .property("ADBE Text Document") as Property;
  } catch (error) {
    return null;
  }
};

export const readText = (textProperty: Property | null): string => {
  if (textProperty === null) return "";

  try {
    const value = textProperty.value;
    if (value !== null && typeof value !== "undefined" && typeof value.text !== "undefined") {
      return String(value.text);
    }

    if (value === null || typeof value === "undefined") {
      return "";
    }

    return String(value);
  } catch (error) {
    return "";
  }
};

export const setText = (textProperty: Property | null, text: string): void => {
  if (textProperty === null) return;

  const value = textProperty.value;
  if (value !== null && typeof value !== "undefined" && typeof value.text !== "undefined") {
    value.text = text;
    textProperty.setValue(value);
  } else {
    textProperty.setValue(text);
  }
};

export const readFieldValue = (field: InternalTextField): string => {
  if (field.valueKind === "value") {
    return readValueProperty(field.property);
  }

  return readText(field.property);
};

export const setFieldValue = (
  field: InternalTextField,
  value: string
): void => {
  if (field.valueKind === "value") {
    setValueProperty(field.property, value);
    return;
  }

  setText(field.property, value);
};

export const getWritableFieldValue = (
  field: InternalTextField,
  value: string
): string => {
  return value;
};

export const readValueProperty = (property: Property | null): string => {
  if (property === null) return "";

  try {
    if (property.value === null || typeof property.value === "undefined") {
      return "";
    }

    return String(property.value);
  } catch (error) {
    return "";
  }
};

export const setValueProperty = (
  property: Property | null,
  value: string
): void => {
  if (property === null) return;

  const text = trimString(String(value || ""));
  const numberValue = Number(text.replace(/\./g, "").replace(",", "."));

  if (isNaN(numberValue)) {
    throw new Error('Valor numerico invalido: "' + value + '".');
  }

  property.setValue(numberValue);
};

export const readLegalText = (textProperty: Property | null): string => {
  if (textProperty === null) return "";

  return readText(textProperty);
};

export const setLegalText = (
  textProperty: Property | null,
  text: string
): void => {
  if (textProperty === null) return;

  try {
    if (textProperty.expression && textProperty.expression !== "") {
      textProperty.expression = text;
      return;
    }
  } catch (error) {
  }

  setText(textProperty, text);
};

export const normalizeValue = (
  value: string,
  format: OfferFieldFormat
): string => {
  if (format === "price") return normalizePrice(value);
  if (format === "percent") return normalizeInteger(value);
  if (format === "integer") return normalizeInteger(value);

  return String(value);
};

export const normalizePrice = (value: string): string => {
  const text = trimString(String(value || ""));
  const separatorIndex = getPriceDecimalSeparatorIndex(text);

  if (separatorIndex >= 0) {
    const rawIntegerPart = text.substring(0, separatorIndex);
    const rawDecimalPart = text.substring(separatorIndex + 1);
    const rawIntegerDigits = keepDigits(rawIntegerPart);
    let decimalPart = keepDigits(rawDecimalPart);

    if (rawIntegerDigits === "" && decimalPart === "") return "";

    while (decimalPart.length < 2) {
      decimalPart += "0";
    }

    if (decimalPart.length > 2) {
      decimalPart = decimalPart.substring(0, 2);
    }

    return (
      formatThousands(stripLeadingZeroes(rawIntegerDigits || "0")) +
      "," +
      decimalPart
    );
  }

  const digits = keepDigits(text);
  if (digits === "") return "";

  const paddedDigits = digits.length < 3 ? padStart(digits, 3, "0") : digits;
  const rawIntegerDigits = paddedDigits.substring(0, paddedDigits.length - 2);
  const decimalPart = paddedDigits.substring(paddedDigits.length - 2);
  const integerDigits = stripLeadingZeroes(rawIntegerDigits);

  return formatThousands(integerDigits || "0") + "," + decimalPart;
};

export const padStart = (
  value: string,
  targetLength: number,
  padString: string
): string => {
  let output = String(value || "");

  while (output.length < targetLength) {
    output = padString + output;
  }

  return output;
};

export const trimString = (value: string): string => {
  let start = 0;
  let end = value.length - 1;

  while (start <= end && isWhitespace(value.charAt(start))) {
    start += 1;
  }

  while (end >= start && isWhitespace(value.charAt(end))) {
    end -= 1;
  }

  return value.substring(start, end + 1);
};

export const isWhitespace = (value: string): boolean =>
  value === " " ||
  value === "\t" ||
  value === "\n" ||
  value === "\r" ||
  value === "\f";

export const getPriceDecimalSeparatorIndex = (value: string): number => {
  const commaIndex = value.lastIndexOf(",");

  if (commaIndex >= 0) return commaIndex;

  const dotIndex = value.lastIndexOf(".");

  if (dotIndex < 0) return -1;

  const decimalDigits = keepDigits(value.substring(dotIndex + 1));

  return decimalDigits.length > 0 && decimalDigits.length <= 2 ? dotIndex : -1;
};

export const formatThousands = (value: string): string => {
  let output = "";
  let groupSize = 0;

  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (groupSize === 3) {
      output = "." + output;
      groupSize = 0;
    }

    output = value.charAt(index) + output;
    groupSize += 1;
  }

  return output;
};

export const stripLeadingZeroes = (value: string): string => {
  const stripped = value.replace(/^0+/, "");
  return stripped === "" ? "0" : stripped;
};

export const normalizeInteger = (value: string): string => {
  const text = String(value || "");
  let output = "";

  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (character >= "0" && character <= "9") {
      output += character;
    }
  }

  return output;
};

export const keepDigitsAndOneComma = (value: string): string => {
  const text = String(value || "").replace(/\./g, ",");
  let output = "";
  let hasComma = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (character >= "0" && character <= "9") {
      output += character;
    } else if (character === "," && !hasComma) {
      output += character;
      hasComma = true;
    }
  }

  if (output === ",") return "";

  return output;
};

export const keepDigits = (value: string): string => {
  const text = String(value || "");
  let output = "";

  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (character >= "0" && character <= "9") {
      output += character;
    }
  }

  return output;
};

export const createFieldId = (layerName: string): string =>
  String(layerName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export const makeIndexedTextField = (
  source: CompItem | null,
  layerIndex: number,
  label: string,
  format: OfferFieldFormat,
  context: string,
  errors: string[]
): InternalTextField => {
  const layer = getLayerByIndex(source, layerIndex);
  let property: Property | null = null;

  if (layer === null) {
    addError(
      errors,
      "Nao encontrei a layer " + layerIndex + " em " + context + "."
    );
  } else {
    property = getSourceTextProperty(layer);

    if (property === null) {
      addError(
        errors,
        'A layer "' +
          layer.name +
          '" nao possui Source Text em ' +
          context +
          "."
      );
    }
  }

  return {
    id: createFieldId(layer !== null ? layer.name : label + "-" + layerIndex),
    label,
    value: readText(property),
    format,
    enabled: property !== null,
    property,
    valueKind: "text",
  };
};
