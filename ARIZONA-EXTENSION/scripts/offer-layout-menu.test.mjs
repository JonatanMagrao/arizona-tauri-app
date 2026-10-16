import assert from "node:assert/strict";
import test from "node:test";
import { compileOfferMenu, createOfferMenuHarness, deferred, settle } from "./helpers/offer-menu-harness.mjs";

const compiled = await compileOfferMenu(Object.fromEntries(Object.entries({
  menu: "../src/js/main/domains/ofertas/components/OfferLayoutMenu.tsx",
  options: "../src/js/main/domains/ofertas/hooks/useOfferLayoutOptions.ts",
  tooltips: "../src/js/main/utils/tooltips.ts",
  errors: "../src/js/main/utils/errors.ts",
}).map(([name, path]) => [name, new URL(path, import.meta.url)])));

const createHarness = (options) => createOfferMenuHarness(compiled, {
  componentName: "OfferLayoutMenu",
  optionsImport: "../hooks/useOfferLayoutOptions",
  readService: "loadOfferLayoutOptions",
}, options);

const layoutData = (offerLayerIndex = 4) => ({
  ok: true,
  message: "Réguas disponíveis.",
  errors: [],
  context: {
    projectKey: "C:/jobs/current.aep", compItemId: 10, offerLayerIndex,
    offerLayerId: 40 + offerLayerIndex, layerComment: "CAMADA OFERTA " + String(offerLayerIndex).padStart(2, "0"),
    sourceItemId: 50, folderItemId: 60, folderComment: "OFERTA 04",
  },
  options: [
    { comment: "REGUA 1", label: "Régua atual", itemId: 50, current: true, enabled: true },
    { comment: "REGUA 2", label: "Régua disponível", itemId: 70, current: false, enabled: true },
    { comment: "REGUA 3", label: "Régua ausente", itemId: null, current: false, enabled: false,
      disabledSummary: "A régua não foi encontrada.", disabledReason: 'Adicione o comentário "REGUA 3" à composição.' },
    { comment: "REGUA 4", label: "Outra régua disponível", itemId: 90, current: false, enabled: true },
  ],
});


test("layout options are read lazily and reopening requests current host options", async () => {
  const h = createHarness();
  assert.equal(h.reads.length, 0);
  assert.equal(h.menu, undefined);
  h.click(h.trigger);
  assert.deepEqual(h.reads.map(({ index }) => index), [4]);
  assert.equal(h.trigger.props["aria-expanded"], true);
  assert.equal(h.menu.props["aria-busy"], true);
  h.reads[0].resolve(layoutData());
  await settle(); h.render();
  assert.equal(h.options.length, 4);
  assert.equal(h.menu.parentElement, h.document.body, "The menu is outside the scrolling offer cards");
  assert.equal(h.options[0].props["aria-checked"], true);
  assert.equal(h.options[2].disabled, true);
  assert.match(h.options[2].parentElement.props["data-tooltip-resolution"], /REGUA 3/);
  h.click(h.trigger);
  assert.equal(h.menu, undefined);
  h.click(h.trigger);
  assert.equal(h.reads.length, 2, "A later open cannot reuse stale project options");
  assert.equal(h.options.length, 0);
  h.unmount();
});

for (const cancellation of ["close", "offer", "snapshot", "busy", "blocked", "unmount"]) {
  test(`a pending layout read cannot restore the menu after ${cancellation}`, async () => {
    const h = createHarness();
    h.click(h.trigger);
    if (cancellation === "close") h.click(h.trigger);
    else if (cancellation === "offer") h.update({ offerLayerIndex: 5 });
    else if (cancellation === "snapshot") h.update({ resetKey: "snapshot-2" });
    else if (cancellation === "busy") h.update({ busy: true });
    else if (cancellation === "blocked") h.update({ blocked: true });
    else h.unmount();
    h.reads.forEach((request) => request.resolve(layoutData(request.index)));
    await settle();
    if (cancellation !== "unmount") {
      h.render();
      assert.equal(h.menu, undefined);
      assert.equal(h.options.length, 0);
      if (cancellation === "offer") {
        h.click(h.trigger);
        assert.equal(h.reads.at(-1).index, 5);
        assert.equal(h.options.length, 0, "The old response must not become the new offer's menu");
      }
      h.unmount();
    }
    assert.equal(h.settersAfterUnmount, 0);
    assert.deepEqual(h.changes, []);
    assert.deepEqual(h.statuses, []);
  });
}

test("only a valid noncurrent option sends its captured context once, and closes the menu", async () => {
  const h = createHarness();
  h.click(h.trigger);
  const data = layoutData();
  h.reads[0].resolve(data);
  await settle(); h.render();
  const options = h.options;
  options[2].props.onClick();
  assert.deepEqual(h.changes, [], "Disabled targets cannot replace the offer");
  const select = options[1].props.onClick;
  select(); select();
  h.render();
  assert.equal(h.changes.length, 1);
  assert.equal(h.changes[0].context, data.context);
  assert.equal(h.changes[0].targetItemId, 70);
  assert.equal(h.menu, undefined);
  assert.equal(h.trigger.disabled, true);
  assert.equal(h.document.activeElement, h.trigger);
  h.change.resolve();
  await settle(); h.render();
  assert.equal(h.trigger.disabled, false);
  h.unmount();
});

test("the current layout closes the menu without mutation and retained option handlers become inert", async () => {
  const h = createHarness();
  h.click(h.trigger);
  h.reads[0].resolve(layoutData());
  await settle(); h.render();
  const staleSelection = h.options[1].props.onClick;
  h.click(h.options[0]);
  assert.equal(h.menu, undefined);
  staleSelection();
  assert.deepEqual(h.changes, []);
  h.unmount();
  staleSelection();
  assert.deepEqual(h.changes, []);
  assert.equal(h.settersAfterUnmount, 0);
});

for (const outcome of ["allow", "cancel", "snapshot", "offer", "unmount"]) {
  test(`layout preflight ${outcome} only applies a still-current confirmed selection`, async () => {
    const before = deferred();
    let preflightCalls = 0;
    const h = createHarness({ props: {
      onBeforeChange: () => { preflightCalls += 1; return before.promise; },
    } });
    h.click(h.trigger);
    const data = layoutData();
    h.reads[0].resolve(data);
    await settle(); h.render();
    const select = h.options[1].props.onClick;
    select(); select();
    h.render();
    assert.equal(preflightCalls, 1);
    assert.equal(h.menu, undefined);
    assert.equal(h.trigger.disabled, true);
    assert.deepEqual(h.changes, [], "Do not mutate the host before the project check completes");

    if (outcome === "snapshot") h.update({ resetKey: "snapshot-2" });
    if (outcome === "offer") h.update({ offerLayerIndex: 5 });
    if (outcome === "unmount") h.unmount();
    before.resolve(outcome !== "cancel");
    await settle();
    if (outcome === "allow") {
      assert.equal(h.changes.length, 1);
      assert.equal(h.changes[0].context, data.context);
      assert.equal(h.changes[0].targetItemId, 70);
      h.change.resolve();
      await settle();
    } else {
      assert.deepEqual(h.changes, [], "Cancellation or a changed offer must discard the captured request");
    }
    if (outcome !== "unmount") {
      h.render();
      assert.equal(h.trigger.disabled, false);
      h.unmount();
    }
    assert.equal(h.settersAfterUnmount, 0);
    assert.deepEqual(h.statuses, []);
  });
}

test("missing offer context prevents selection even if the host listed an enabled target", async () => {
  const h = createHarness();
  h.click(h.trigger);
  h.reads[0].resolve({ ...layoutData(), context: null });
  await settle(); h.render();
  h.options.forEach((option) => {
    assert.equal(option.disabled, true);
    option.props.onClick();
  });
  assert.deepEqual(h.changes, []);
  h.unmount();
});

test("an unavailable offer folder keeps its exact comment and Project-panel fix in a focusable tooltip", async () => {
  const h = createHarness({ props: { offerLayerIndex: 1 } });
  h.click(h.trigger);
  const summary = 'Nenhuma pasta do projeto tem o comentário "OFERTA 01".';
  const resolution = 'No painel Projeto, adicione o comentário "OFERTA 01" à pasta desta oferta.';
  h.reads[0].resolve({
    ...layoutData(1),
    ok: false,
    message: summary,
    context: null,
    disabledSummary: summary,
    disabledReason: resolution,
  });
  await settle(); h.render();

  const diagnostic = h.find((node) => node.type === "p" && node.props["data-tooltip"] === summary);
  assert.ok(diagnostic);
  assert.equal(diagnostic.props["data-tooltip-title"], "Réguas indisponíveis");
  assert.equal(diagnostic.props["data-tooltip-resolution"], resolution);
  assert.equal(diagnostic.props.title, undefined);
  assert.equal(diagnostic.props.tabIndex, 0);
  assert.equal(h.document.activeElement, diagnostic, "Keyboard users reach the explanation when the read completes");
  h.options.forEach((option) => {
    assert.equal(option.disabled, true, "An unavailable folder cannot expose an actionable layout");
    option.props.onClick();
  });
  assert.deepEqual(h.changes, []);
  h.key(h.menu, "Escape");
  assert.equal(h.document.activeElement, h.trigger);
  h.unmount();
});

test("keyboard navigation skips unavailable options and Escape restores trigger focus", async () => {
  const h = createHarness();
  assert.equal(h.key(h.trigger, "ArrowDown").prevented, true);
  h.reads[0].resolve(layoutData());
  await settle(); h.render();
  assert.equal(h.document.activeElement, h.options[0]);
  h.key(h.menu, "ArrowDown");
  assert.equal(h.document.activeElement, h.options[1]);
  h.key(h.menu, "ArrowDown");
  assert.equal(h.document.activeElement, h.options[3]);
  h.key(h.menu, "Home");
  assert.equal(h.document.activeElement, h.options[0]);
  h.key(h.menu, "End");
  assert.equal(h.document.activeElement, h.options[3]);
  h.key(h.menu, "ArrowDown");
  assert.equal(h.document.activeElement, h.options[0]);
  assert.equal(h.key(h.menu, "Escape").prevented, true);
  assert.equal(h.menu, undefined);
  assert.equal(h.document.activeElement, h.trigger);
  assert.deepEqual(h.changes, []);
  h.unmount();
});

for (const dismissal of ["pointerdown", "focusin", "scroll", "resize"]) {
  test(`${dismissal} outside closes the layout menu without selecting an option`, () => {
    const h = createHarness();
    h.click(h.trigger);
    h.dispatch("pointerdown", h.menu);
    h.dispatch("scroll", h.menu);
    assert.ok(h.menu, "Interactions inside the menu do not dismiss it");
    h.dispatch(dismissal, h.document.body, dismissal === "resize" ? h.window : h.document);
    assert.equal(h.menu, undefined);
    assert.deepEqual(h.changes, []);
    h.unmount();
    assert.ok([...h.document.listeners.values()].every((listeners) => listeners.size === 0));
    assert.ok([...h.window.listeners.values()].every((listeners) => listeners.size === 0));
  });
}

test("a failed option read can retry, and browser preview never queries the host", async () => {
  const h = createHarness();
  h.click(h.trigger);
  h.reads[0].reject(new Error("evalScript transport failed"));
  await settle(); h.render();
  const alert = h.find((node) => node.props.role === "alert");
  assert.ok(alert);
  assert.doesNotMatch(alert.props.children, /evalScript|transport/);
  const retry = h.find((node) => node.type === "button" && node.parentElement?.contains(alert));
  assert.ok(retry);
  h.click(retry);
  assert.equal(h.reads.length, 2);
  h.reads[1].resolve(layoutData());
  await settle(); h.render();
  assert.equal(h.options.length, 4);
  h.unmount();

  const preview = createHarness({ cep: false });
  assert.equal(preview.trigger.disabled, true);
  preview.trigger.props.onClick();
  preview.render();
  assert.equal(preview.menu, undefined);
  assert.deepEqual(preview.reads, []);
  preview.unmount();
});
