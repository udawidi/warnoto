import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// streamSSEDeltas() lives in App.jsx (module-scope helper, no closure deps),
// so we extract its source and eval it standalone rather than importing the
// whole JSX file (App.jsx isn't loadable by plain Node).
const appSource = await readFile(new URL("../App.jsx", import.meta.url), "utf8");
const start = appSource.indexOf("async function streamSSEDeltas");
assert.notEqual(start, -1, "streamSSEDeltas must exist in App.jsx");
const end = appSource.indexOf("\n// ════", start);
const fnSource = appSource.slice(start, end);
const streamSSEDeltas = new Function(`"use strict"; return (${fnSource});`)();

function streamFromChunks(chunks) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    getReader() {
      return {
        async read() {
          if (i >= chunks.length) return { done: true, value: undefined };
          return { done: false, value: encoder.encode(chunks[i++]) };
        },
      };
    },
  };
}

test("streamSSEDeltas accumulates delta content and stops at [DONE]", async () => {
  const chunks = [
    'data: {"choices":[{"delta":{"content":"Hal"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"o "}}]}\ndata: {"choices":[{"delta":{"content":"dunia"}}]}\n\n',
    "data: [DONE]\n\n",
  ];
  let out = "";
  await streamSSEDeltas(streamFromChunks(chunks), (d) => { out += d; });
  assert.equal(out, "Halo dunia");
});

test("streamSSEDeltas buffers a data: line split across chunk boundaries", async () => {
  const full = 'data: {"choices":[{"delta":{"content":"utuh"}}]}\n\n';
  const chunks = [full.slice(0, 20), full.slice(20)];
  let out = "";
  await streamSSEDeltas(streamFromChunks(chunks), (d) => { out += d; });
  assert.equal(out, "utuh");
});

test("streamSSEDeltas ignores malformed lines without throwing", async () => {
  const chunks = ["data: not-json\n\n", 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'];
  let out = "";
  await streamSSEDeltas(streamFromChunks(chunks), (d) => { out += d; });
  assert.equal(out, "ok");
});
