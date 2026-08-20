import assert from "node:assert/strict";
import test from "node:test";
import {
  compareHistoryIds,
  mergeRenderHistoryEntries,
  readRenderHistoryPage,
  reconcilePolledRenderHistory,
  renderDirectionForDevice,
} from "./renderHistoryData.js";

test("reads the keyset pagination contract", () => {
  const page = readRenderHistoryPage({
    localDeviceId: "device-a",
    localMemberId: "member-a",
    jobs: [{ id: "job-1" }],
    pagination: {
      total: 51,
      hasMore: true,
      nextCursor: {
        beforeCreatedAt: "2026-08-18T12:00:00.000Z",
        beforeId: "job-1",
      },
    },
  });

  assert.equal(page.localDeviceId, "device-a");
  assert.equal(page.localMemberId, "member-a");
  assert.equal(page.total, 51);
  assert.equal(page.hasMore, true);
  assert.deepEqual(page.nextCursor, {
    beforeCreatedAt: "2026-08-18T12:00:00.000Z",
    beforeId: "job-1",
  });
});

test("derives render direction from the current device", () => {
  assert.equal(renderDirectionForDevice({ requesterDeviceId: "a", targetDeviceId: "b" }, "a"), "sent");
  assert.equal(renderDirectionForDevice({ requesterDeviceId: "a", targetDeviceId: "b" }, "b"), "received");
  assert.equal(renderDirectionForDevice({ requesterDeviceId: "a", targetDeviceId: "a" }, "a"), "both");
  assert.equal(
    renderDirectionForDevice(
      { requesterDeviceId: "old", requesterMemberId: "member-a", targetDeviceId: "b" },
      "new",
      "member-a"
    ),
    "account_sent"
  );
});

test("merges refreshed jobs without duplicating loaded history", () => {
  assert.deepEqual(
    mergeRenderHistoryEntries(
      [{ id: "one", status: "rendering" }, { id: "two", status: "completed" }],
      [{ id: "one", status: "completed" }, { id: "three", status: "queued" }]
    ),
    [
      { id: "one", status: "completed" },
      { id: "two", status: "completed" },
      { id: "three", status: "queued" },
    ]
  );
});

test("rebases the cursor when a polled page no longer overlaps loaded history", () => {
  assert.deepEqual(
    reconcilePolledRenderHistory({
      currentEntries: [{ id: "old-1" }, { id: "old-2" }],
      currentCursor: { beforeCreatedAt: "old", beforeId: "old-2" },
      incomingEntries: [{ id: "new-1" }, { id: "new-2" }],
      incomingCursor: { beforeCreatedAt: "new", beforeId: "new-2" },
      total: 100,
    }),
    {
      entries: [{ id: "new-1" }, { id: "new-2" }],
      cursor: { beforeCreatedAt: "new", beforeId: "new-2" },
      hasMore: true,
    }
  );
});

test("keeps numeric history ids in numeric order and render UUIDs lexical", () => {
  assert.equal(compareHistoryIds("9", "10"), -1);
  assert.equal(compareHistoryIds("render-b", "render-a"), 1);
});
