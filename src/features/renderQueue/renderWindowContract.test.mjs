import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rustSource = readFileSync(
  new URL("../../../src-tauri/src/render_queue.rs", import.meta.url),
  "utf8"
);
const windowSource = readFileSync(new URL("./RenderQueueWindow.jsx", import.meta.url), "utf8");
const capability = JSON.parse(readFileSync(
  new URL("../../../src-tauri/capabilities/render-queue.json", import.meta.url),
  "utf8"
));

function sourceRegion(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `Missing source marker: ${startMarker}`);
  assert.ok(end > start, `Missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test("closing the render queue only hides its window", () => {
  const closeCommand = sourceRegion(
    rustSource,
    "pub(crate) fn render_queue_close_window",
    "pub(crate) async fn render_queue_status"
  );
  assert.match(closeCommand, /window\.hide\(\)/u);
  assert.doesNotMatch(
    closeCommand,
    /set_availability|enabled\.store|cancel_current|shutdown|has_received_work|is_enabled/u
  );

  const closeHandler = sourceRegion(
    windowSource,
    "const closeWindow = useCallback",
    "const minimizeWindow ="
  );
  assert.match(closeHandler, /renderQueueCloseWindow/u);
  assert.match(closeHandler, /visibilityRevisionRef\.current \+= 1/u);
  assert.doesNotMatch(closeHandler, /shouldKeepReceiverViewOpen|hasActiveReceivedJobs/u);
});

test("revealing a hidden queue resumes its authoritative refresh", () => {
  const revealCommand = sourceRegion(
    rustSource,
    "fn reveal_queue_window",
    "struct RenderOutput"
  );
  assert.match(revealCommand, /window\.unminimize\(\)/u);
  assert.match(revealCommand, /window\.show\(\)/u);
  assert.match(revealCommand, /WINDOW_SHOWN_EVENT/u);
  assert.match(revealCommand, /window\.set_focus\(\)/u);
  assert.match(rustSource, /focus_queue_window[\s\S]*reveal_queue_window/u);

  const shownHandler = sourceRegion(
    windowSource,
    "const handleShown =",
    "window.addEventListener"
  );
  assert.match(shownHandler, /panelOpenRef\.current = true/u);
  assert.match(shownHandler, /visibilityRevisionRef\.current \+= 1/u);
  assert.match(shownHandler, /refreshStatus\(\{ silent: true \}\)/u);
  assert.match(windowSource, /listen\("arizona-render-queue:shown", handleShown\)/u);
});

test("the queue window can minimize and query its real visibility", () => {
  assert.match(windowSource, /getCurrentWindow\(\)\.minimize\(\)/u);
  assert.match(windowSource, /getCurrentWindow\(\)[\s\S]*\.isVisible\(\)/u);
  assert.match(
    windowSource,
    /visibilityRevisionRef\.current === visibilityRevision/u
  );
  assert.ok(capability.permissions.includes("core:window:allow-minimize"));
  assert.ok(capability.permissions.includes("core:window:allow-is-visible"));
});
