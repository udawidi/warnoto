import test from "node:test";
import assert from "node:assert/strict";
import { servicesProxyError } from "../../src/lib/rag.js";

test("servicesProxyError extracts nested JSON message", async () => {
  const error = new Error("Edge Function returned a non-2xx status code");
  error.context = new Response(JSON.stringify({ error: { message: "COHERE_API_KEY belum diset" } }), { status: 500 });
  assert.equal((await servicesProxyError(error)).message, "COHERE_API_KEY belum diset");
});

test("servicesProxyError falls back to response text", async () => {
  const error = new Error("Edge Function returned a non-2xx status code");
  error.context = new Response("services-proxy gagal", { status: 502 });
  assert.equal((await servicesProxyError(error)).message, "services-proxy gagal");
});

test("servicesProxyError preserves SDK error when response has no detail", async () => {
  const error = new Error("Edge Function returned a non-2xx status code");
  error.context = new Response("", { status: 500 });
  assert.equal((await servicesProxyError(error)).message, error.message);
});
