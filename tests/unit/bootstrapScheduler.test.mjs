import assert from "node:assert/strict";
import { test } from "node:test";
import { runBootstrapTasks } from "../../src/lib/bootstrapScheduler.js";

test("bootstrap scheduler limits concurrency, preserves order, and isolates failures", async () => {
  let active = 0;
  let maximum = 0;
  const tasks = Array.from({ length: 7 }, (_, index) => async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, index % 2 ? 2 : 1));
    active -= 1;
    if (index === 3) throw new Error("one loader failed");
    return index;
  });
  const results = await runBootstrapTasks(tasks, { limit: 3, priority: [5, 1, 2] });
  assert.equal(maximum, 3);
  assert.deepEqual(results, [0, 1, 2, null, 4, 5, 6]);
});
