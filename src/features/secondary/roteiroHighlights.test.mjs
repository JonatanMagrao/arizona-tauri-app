import assert from "node:assert/strict";
import test from "node:test";
import { getRoteiroHighlightRanges } from "./roteiroHighlights.js";

const highlightedParts = (text) =>
  getRoteiroHighlightRanges(text).map(({ start, end }) => text.slice(start, end));

test("destaca os dois números de Leve X Pague Y", () => {
  assert.deepEqual(
    highlightedParts("TODOS OS SALGADINHOS, LEVE 3 PAGUE 2"),
    ["3", "2"]
  );
  assert.deepEqual(
    highlightedParts("LEVE X 4 E PAGUE Y 3"),
    ["4", "3"]
  );
});

test("destaca preços e percentuais sem marcar números comuns", () => {
  assert.deepEqual(
    highlightedParts("VODKA 750ML 33,90 E 20% DE DESCONTO - 2"),
    ["33,90", "20%"]
  );
});
