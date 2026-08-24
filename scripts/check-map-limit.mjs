// Mirrors mapLimit() in supabase/functions/maturity-drive/index.ts
// (duplicated because that file is Deno TS; keep both in sync on change).
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
  console.log(`ok - ${label}`);
}

const orderResult = await mapLimit([1, 2, 3, 4, 5], 2, async (x) => x * 2);
assertEqual(orderResult, [2, 4, 6, 8, 10], "results ordered by input index regardless of completion order");

let active = 0, maxConcurrent = 0;
await mapLimit([1, 2, 3, 4, 5, 6], 2, async () => {
  active++;
  maxConcurrent = Math.max(maxConcurrent, active);
  await new Promise((resolve) => setTimeout(resolve, 5));
  active--;
});
if (maxConcurrent > 2) throw new Error(`concurrency exceeded limit: maxConcurrent=${maxConcurrent}`);
console.log(`ok - concurrency never exceeded limit (max ${maxConcurrent})`);

console.log("check-map-limit: all checks passed");
