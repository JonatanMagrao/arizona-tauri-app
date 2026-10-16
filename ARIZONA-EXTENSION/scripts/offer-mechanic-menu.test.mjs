import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { compileOfferMenu, createOfferMenuHarness, deferred, settle } from "./helpers/offer-menu-harness.mjs";

const compiled = await compileOfferMenu(Object.fromEntries(Object.entries({
  menu: "../src/js/main/domains/ofertas/components/OfferMechanicMenu.tsx",
  options: "../src/js/main/domains/ofertas/hooks/useOfferMechanicOptions.ts",
  tooltips: "../src/js/main/utils/tooltips.ts",
  errors: "../src/js/main/utils/errors.ts",
}).map(([name, path]) => [name, new URL(path, import.meta.url)])));
const panelSource = await readFile(new URL("../src/js/main/domains/ofertas/components/OffersPanel.tsx", import.meta.url), "utf8");
const allTakePaySource = await readFile(new URL("../src/shared/allTakePayMechanic.js", import.meta.url), "utf8");

const createHarness = (options) => createOfferMenuHarness(compiled, {
  componentName: "OfferMechanicMenu",
  optionsImport: "../hooks/useOfferMechanicOptions",
  readService: "loadOfferMechanicOptions",
  defaultProps: { productIndex: 1, label: "Simples" },
}, options);

const mechanicData = (offerLayerIndex = 4, productIndex = 1) => ({
  ok: true,
  message: "Mecânicas disponíveis.",
  errors: [],
  context: {
    offer: {
      projectKey: "C:/jobs/current.aep", compItemId: 10, offerLayerIndex,
      offerLayerId: 40 + offerLayerIndex, layerComment: "CAMADA OFERTA " + String(offerLayerIndex).padStart(2, "0"),
      sourceItemId: 50, folderItemId: 60, folderComment: "OFERTA 04",
    },
    productIndex, mechanicLayerIndex: 3, mechanicLayerId: 43,
    mechanicLayerComment: "MECANICA " + (productIndex + 1), mechanicSourceItemId: 80,
    mechanicsFolderItemId: 90,
  },
  options: [
    { comment: "SIMPLES " + (productIndex + 1), label: "Simples", itemId: 80, current: true, enabled: true },
    { comment: "DE X POR Y PARCELAMENTO", label: "De X por Y Parcelamento", itemId: 100, current: false, enabled: true },
    { comment: "DESCONTO R$ CARTAO CRF", label: "Desconto R$ Cartão CRF", itemId: null, current: false, enabled: false,
      disabledSummary: 'Nenhuma composição tem o comentário "DESCONTO R$ CARTAO CRF".',
      disabledReason: 'No painel Projeto, adicione "DESCONTO R$ CARTAO CRF" à composição dentro da pasta "MECANICAS".' },
  ],
});

test("mechanic menu reads only when opened and forwards the exact second-product identity on selection", async () => {
  const h = createHarness();
  assert.equal(h.reads.length, 0);
  h.click(h.trigger);
  assert.deepEqual(h.reads.map(({ index, productIndex }) => [index, productIndex]), [[4, 1]]);
  assert.equal(h.menu.props["aria-busy"], true);
  assert.equal(h.options.length, 0);
  const data = mechanicData();
  h.reads[0].resolve(data);
  await settle(); h.render();
  assert.equal(h.options[0].props["aria-checked"], true);
  assert.equal(h.options[2].disabled, true);
  assert.equal(h.options[2].parentElement.props["data-tooltip"], data.options[2].disabledSummary);
  assert.equal(h.options[2].parentElement.props["data-tooltip-resolution"], data.options[2].disabledReason);
  h.options[2].props.onClick();
  assert.deepEqual(h.changes, []);
  const choose = h.options[1].props.onClick;
  choose(); choose(); h.render();
  assert.equal(h.changes.length, 1);
  assert.equal(h.changes[0].context, data.context);
  assert.equal(h.changes[0].context.productIndex, 1);
  assert.equal(h.changes[0].context.mechanicLayerComment, "MECANICA 2");
  assert.equal(h.changes[0].targetItemId, 100);
  assert.equal(h.menu, undefined);
  assert.equal(h.trigger.disabled, true);
  h.change.resolve();
  await settle(); h.render();
  assert.equal(h.trigger.disabled, false);
  h.unmount();
});

for (const cancellation of ["close", "product", "offer", "snapshot", "unmount"]) {
  test(`a delayed mechanic list cannot survive ${cancellation} or leak into another product`, async () => {
    const h = createHarness();
    h.click(h.trigger);
    if (cancellation === "close") h.click(h.trigger);
    if (cancellation === "product") h.update({ productIndex: 2 });
    if (cancellation === "offer") h.update({ offerLayerIndex: 5 });
    if (cancellation === "snapshot") h.update({ resetKey: "another-project" });
    if (cancellation === "unmount") h.unmount();
    h.reads.forEach((request) => request.resolve(mechanicData(request.index, request.productIndex)));
    await settle();
    if (cancellation !== "unmount") {
      h.render();
      assert.equal(h.menu, undefined);
      assert.equal(h.options.length, 0);
      h.click(h.trigger);
      assert.equal(h.reads.at(-1).productIndex, cancellation === "product" ? 2 : 1);
      assert.equal(h.reads.at(-1).index, cancellation === "offer" ? 5 : 4);
      assert.equal(h.options.length, 0, "Reopening reads again instead of reusing the old context");
      h.unmount();
    }
    assert.deepEqual(h.changes, []);
    assert.equal(h.settersAfterUnmount, 0);
  });
}

for (const outcome of ["allow", "cancel", "project", "product", "unmount"]) {
  test(`mechanic preflight ${outcome} applies only the product from a still-current project`, async () => {
    const before = deferred();
    let preflightCalls = 0;
    const h = createHarness({ props: {
      onBeforeChange: () => { preflightCalls += 1; return before.promise; },
    } });
    h.click(h.trigger);
    const data = mechanicData();
    h.reads[0].resolve(data);
    await settle(); h.render();
    const choose = h.options[1].props.onClick;
    choose(); choose(); h.render();
    assert.equal(preflightCalls, 1);
    assert.deepEqual(h.changes, []);
    assert.equal(h.trigger.disabled, true);
    if (outcome === "project") h.update({ resetKey: "new-project-snapshot" });
    if (outcome === "product") h.update({ productIndex: 0 });
    if (outcome === "unmount") h.unmount();
    before.resolve(outcome !== "cancel");
    await settle();
    if (outcome === "allow") {
      assert.equal(h.changes.length, 1);
      assert.equal(h.changes[0].context, data.context);
      h.change.resolve();
      await settle();
    } else assert.deepEqual(h.changes, []);
    if (outcome !== "unmount") {
      h.render();
      assert.equal(h.trigger.disabled, false);
      h.unmount();
    }
    assert.equal(h.settersAfterUnmount, 0);
  });
}

test("a missing mechanic folder exposes its exact Project-panel remedy and prevents every target", async () => {
  const h = createHarness();
  h.click(h.trigger);
  const summary = 'Nenhuma pasta tem o comentário "MECANICAS" dentro de "OFERTA 04".';
  const resolution = 'No painel Projeto, adicione "MECANICAS" à pasta de mecânicas dentro da pasta "OFERTA 04".';
  h.reads[0].resolve({ ...mechanicData(), ok: false, context: null, disabledSummary: summary, disabledReason: resolution });
  await settle(); h.render();
  const diagnostic = h.find((node) => node.type === "p" && node.props["data-tooltip"] === summary);
  assert.ok(diagnostic);
  assert.equal(diagnostic.props["data-tooltip-resolution"], resolution);
  assert.equal(h.document.activeElement, diagnostic);
  h.options.forEach((option) => { assert.equal(option.disabled, true); option.props.onClick(); });
  assert.deepEqual(h.changes, []);
  h.unmount();
});

test("mechanic keyboard navigation skips disabled candidates and current/Escape close without replacement", async () => {
  const h = createHarness();
  h.key(h.trigger, "ArrowUp");
  h.reads[0].resolve(mechanicData());
  await settle(); h.render();
  assert.equal(h.document.activeElement, h.options[1]);
  h.key(h.menu, "ArrowDown");
  assert.equal(h.document.activeElement, h.options[0]);
  const staleChoose = h.options[1].props.onClick;
  h.click(h.options[0]);
  assert.equal(h.menu, undefined);
  staleChoose();
  assert.deepEqual(h.changes, []);
  h.click(h.trigger);
  h.key(h.menu, "Escape");
  assert.equal(h.menu, undefined);
  assert.equal(h.document.activeElement, h.trigger);
  h.unmount();
});

test("mechanic read failure supports retry, and browser preview makes no host call", async () => {
  const h = createHarness();
  h.click(h.trigger);
  h.reads[0].reject(new Error("evalScript transport failed"));
  await settle(); h.render();
  const alert = h.find((node) => node.props.role === "alert");
  assert.ok(alert);
  assert.doesNotMatch(alert.props.children, /evalScript|transport/);
  const retry = h.find((node) => node.type === "button" && node.parentElement?.contains(alert));
  h.click(retry);
  assert.deepEqual(h.reads.map(({ index, productIndex }) => [index, productIndex]), [[4, 1], [4, 1]]);
  h.reads[1].resolve(mechanicData());
  await settle(); h.render();
  assert.equal(h.options.length, 3);
  h.unmount();
  const preview = createHarness({ cep: false });
  preview.trigger.props.onClick(); preview.render();
  assert.equal(preview.trigger.disabled, true);
  assert.equal(preview.menu, undefined);
  assert.deepEqual(preview.reads, []);
  preview.unmount();
});

const shallowNodes = (node) => {
  if (Array.isArray(node)) return node.flatMap(shallowNodes);
  return node && typeof node === "object" ? [node, ...shallowNodes(node.props?.children)] : [];
};

for (const [type, variantId, variantLabel] of [
  ["De X Por Y Parcelamento", "mechanicCondition", "Controlador de Mecânica"],
  ["De X Por Y | X% Desconto | Leve X Pague Y", "mechanicType", "Tipo"],
]) {
  test(`product header keeps only the source menu and moves ${variantId} below prices with its own update target`, () => {
    const module = { exports: {} };
    const tooltipModule = { exports: {} };
    const allTakePayModule = { exports: {} };
    vm.runInNewContext(compiled.tooltips, { module: tooltipModule, exports: tooltipModule.exports });
    vm.runInNewContext(ts.transpileModule(allTakePaySource, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText, { module: allTakePayModule, exports: allTakePayModule.exports });
    const MechanicMenu = () => null;
    const element = (elementType, props) => ({ type: elementType, props });
    vm.runInNewContext(ts.transpileModule(panelSource + "\nexport { ProductEditor as ProductEditorForTest };", {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, {
      module, exports: module.exports, window: { clearTimeout() {} },
      require(specifier) {
        if (specifier === "react/jsx-runtime") return { jsx: element, jsxs: element };
        if (specifier === "react") return {
          useState: (value) => [value, () => {}], useRef: (value) => ({ current: value }),
          useCallback: (callback) => callback, useEffect() {},
        };
        if (specifier.endsWith("/utils/tooltips")) return tooltipModule.exports;
        if (specifier.endsWith("/shared/allTakePayMechanic")) return allTakePayModule.exports;
        if (specifier === "./OfferMechanicMenu") return { OfferMechanicMenu: MechanicMenu };
        return {};
      },
    });
    const changes = [];
    const before = async () => true;
    const replace = async (request) => changes.push(["source", request]);
    const group = { id: variantId, label: variantLabel, type: "controller", placement: "header",
      enabled: true, selectedIndex: 0, options: [{ label: "Uma opção" }, { label: "Outra opção" }] };
    const price = { id: "preco-por", label: "Preço", format: "price", value: "10,00", enabled: true };
    const product = { index: 1, description: { value: "PRODUTO", enabled: true, label: "Descrição" }, image: null,
      mechanic: { type, fields: [price], optionGroups: [group] } };
    const tree = module.exports.ProductEditorForTest({
      product, isRnProject: false, projectName: "current.aep", offerLayerIndex: 4,
      previewRevision: 0, busy: false, resetKey: "current-snapshot", menuBlocked: false,
      draggedProduct: null,
      onBeforeMechanicChange: before, onMechanicChange: replace,
      onOptionChange: (...args) => changes.push(["variant", ...args]),
    });
    const header = shallowNodes(tree).find((node) => node.type === "header");
    const sourceMenu = shallowNodes(header).find((node) => node.type === MechanicMenu);
    assert.ok(sourceMenu, "The product header exposes the source menu");
    assert.deepEqual(shallowNodes(header).filter((node) => node !== header), [sourceMenu],
      "Only the mechanic source menu belongs in the header");
    const controls = shallowNodes(tree).find((node) => node.props?.className === "offer-product-controls");
    const controlNodes = shallowNodes(controls);
    const variantControl = controlNodes.find((node) => node.props?.optionGroup === group);
    const priceControl = controlNodes.find((node) => node.props?.field === price);
    assert.ok(variantControl, "The mechanic variant remains editable in the settings area");
    assert.ok(priceControl && controlNodes.indexOf(priceControl) < controlNodes.indexOf(variantControl),
      "The variant setting follows the price fields");
    assert.equal(shallowNodes(tree).filter((node) => node.props?.optionGroup === group).length, 1);
    assert.equal(sourceMenu.props.offerLayerIndex, 4);
    assert.equal(sourceMenu.props.productIndex, 1);
    assert.equal(sourceMenu.props.onBeforeChange, before);
    assert.equal(sourceMenu.props.onChange, replace);
    const variantNodes = shallowNodes(variantControl.type(variantControl.props));
    assert.ok(variantNodes.some((node) => node.type === "span" && node.props.children === group.label),
      "The setting keeps a visible label alongside the other controls");
    const select = variantNodes.find((node) => node.type === "select");
    assert.equal(select.props.disabled, false);
    assert.equal(select.props.value, 0);
    select.props.onChange({ target: { value: "1" } });
    assert.deepEqual(changes, [["variant", 4, 1, variantId, 1]]);
  });
}
