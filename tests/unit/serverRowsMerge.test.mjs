import test from "node:test";
import assert from "node:assert/strict";
import { mergeServerRowsById } from "../../src/lib/utils.js";

test("server refresh wins by id and keeps unrelated legacy rows", () => {
  const local = [
    { id: "same", value: "stale" },
    { id: "flagged", canonical3: true },
    { id: "legacy", value: "keep" },
  ];
  const server = [{ id: "same", value: "server" }];
  assert.deepEqual(mergeServerRowsById(local, server, "canonical3"), [
    { id: "legacy", value: "keep" },
    { id: "same", value: "server" },
  ]);
});

test("refresh helper supports each canonical transaction flag", () => {
  for (const flag of ["canonical", "canonical3", "canonical10"]) {
    const result = mergeServerRowsById([{ id: "old", [flag]: true }], [{ id: "new" }], flag);
    assert.deepEqual(result, [{ id: "new" }]);
  }
});
