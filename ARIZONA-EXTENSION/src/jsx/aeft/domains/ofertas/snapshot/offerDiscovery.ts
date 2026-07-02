import type { OfferTextField } from "../types";
import { getOfferLayers, getOffersComp } from "../layers/findLayers";
import { generateOfferData } from "./buildOfferSnapshot";

const normalizeValidationFieldName = (value: string): string =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^\s+|\s+$/g, "");

const fieldNameContains = (field: OfferTextField, name: string): boolean => {
  const fieldName = normalizeValidationFieldName(field.id + " " + field.label);
  return fieldName.indexOf(name) !== -1;
};

const extractIntegerText = (value: string): string => {
  const match = String(value).match(/\d+/);
  return match !== null ? match[0] : "";
};

export const getOffersFirstProductInfo = (): Array<{
  offerLayerIndex: number;
  productIndex: number;
  mechanicType: string;
  priceValue: string;
  priceAcceptedValues: string[];
  priceField?: { fieldId: string; fieldIndex: number; value: string };
  deValue: string;
  porValue: string;
  deField?: { fieldId: string; fieldIndex: number; value: string };
  porField?: { fieldId: string; fieldIndex: number; value: string };
  leveValue: string;
  pagueValue: string;
  leveField?: { fieldId: string; fieldIndex: number; value: string };
  pagueField?: { fieldId: string; fieldIndex: number; value: string };
}> => {
  const comp = getOffersComp();
  if (comp === null) return [];

  const offerLayers = getOfferLayers(comp);
  const result: Array<{
    offerLayerIndex: number;
    productIndex: number;
    mechanicType: string;
    priceValue: string;
    priceAcceptedValues: string[];
    priceField?: { fieldId: string; fieldIndex: number; value: string };
    deValue: string;
    porValue: string;
    deField?: { fieldId: string; fieldIndex: number; value: string };
    porField?: { fieldId: string; fieldIndex: number; value: string };
    leveValue: string;
    pagueValue: string;
    leveField?: { fieldId: string; fieldIndex: number; value: string };
    pagueField?: { fieldId: string; fieldIndex: number; value: string };
  }> = [];

  for (let i = 0; i < offerLayers.length; i += 1) {
    const entry = {
      offerLayerIndex: offerLayers[i].index,
      productIndex: 0,
      mechanicType: "",
      priceValue: "",
      priceAcceptedValues: [],
      deValue: "",
      porValue: "",
      leveValue: "",
      pagueValue: "",
    };

    try {
      const data = generateOfferData(offerLayers[i]);

      if (data.products.length > 0) {
        const firstProduct = data.products[0];
        entry.productIndex = firstProduct.index;
        entry.mechanicType = firstProduct.mechanic.type;

        const fields = firstProduct.mechanic.fields;
        if (entry.mechanicType === "Leve X Pague Y") {
          for (let j = 0; j < fields.length; j += 1) {
            if (fieldNameContains(fields[j], "leve x")) {
              entry.leveValue = extractIntegerText(fields[j].value);
              entry.leveField = {
                fieldId: fields[j].id,
                fieldIndex: j,
                value: entry.leveValue,
              };
            } else if (fieldNameContains(fields[j], "pague y")) {
              entry.pagueValue = extractIntegerText(fields[j].value);
              entry.pagueField = {
                fieldId: fields[j].id,
                fieldIndex: j,
                value: entry.pagueValue,
              };
            }
          }
        } else if (
          entry.mechanicType === "De Por" ||
          entry.mechanicType === "De Por Cartao CRF" ||
          entry.mechanicType === "De Por Meu CRF (Dual)"
        ) {
          for (let j = 0; j < fields.length; j += 1) {
            if (fields[j].label === "De") {
              entry.deValue = fields[j].value;
              entry.deField = {
                fieldId: fields[j].id,
                fieldIndex: j,
                value: fields[j].value,
              };
            } else if (fields[j].label === "Por") {
              entry.porValue = fields[j].value;
              entry.porField = {
                fieldId: fields[j].id,
                fieldIndex: j,
                value: fields[j].value,
              };
              entry.priceValue = fields[j].value;
              entry.priceField = {
                fieldId: fields[j].id,
                fieldIndex: j,
                value: fields[j].value,
              };
            }
          }
        }

        if (
          entry.mechanicType === "De Por" ||
          entry.mechanicType === "De Por Cartao CRF" ||
          entry.mechanicType === "De Por Meu CRF (Dual)"
        ) {
          // Valida o roteiro contra o preco final ("Por") desta mecanica.
        } else if (entry.mechanicType === "De Por Parcelamento Cartao Carrefour") {
          for (let j = 0; j < fields.length; j += 1) {
            if (fields[j].format === "price" && fields[j].value !== "") {
              entry.priceAcceptedValues.push(fields[j].value);
            }

            if (fields[j].label === "De") {
              entry.deValue = fields[j].value;
              entry.deField = {
                fieldId: fields[j].id,
                fieldIndex: j,
                value: fields[j].value,
              };
            } else if (fields[j].label === "Preco") {
              entry.porValue = fields[j].value;
              entry.porField = {
                fieldId: fields[j].id,
                fieldIndex: j,
                value: fields[j].value,
              };
            } else if (fields[j].label === "Parcela") {
              entry.priceValue = fields[j].value;
              entry.priceField = {
                fieldId: fields[j].id,
                fieldIndex: j,
                value: fields[j].value,
              };
            }
          }

          if (entry.priceValue === "") {
            for (let j = 0; j < fields.length; j += 1) {
              if (fields[j].format === "price") {
                entry.priceValue = fields[j].value;
                entry.priceField = {
                  fieldId: fields[j].id,
                  fieldIndex: j,
                  value: fields[j].value,
                };
                break;
              }
            }
          }
        } else {
          for (let j = 0; j < fields.length; j += 1) {
            if (fields[j].format === "price") {
              entry.priceValue = fields[j].value;
              entry.priceField = {
                fieldId: fields[j].id,
                fieldIndex: j,
                value: fields[j].value,
              };
              break;
            }
          }
          if (entry.priceValue === "") {
            for (let j = 0; j < fields.length; j += 1) {
              if (fields[j].format === "percent") {
                entry.priceValue = fields[j].value;
                entry.priceField = {
                  fieldId: fields[j].id,
                  fieldIndex: j,
                  value: fields[j].value,
                };
                break;
              }
            }
          }
        }
      }
    } catch (e) {
      // keep empty defaults on error
    }

    result.push(entry);
  }

  return result;
};
