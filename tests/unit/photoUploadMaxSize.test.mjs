import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../../src/lib/supabaseSync.js", import.meta.url), "utf8");

test("photo upload rejects data larger than 4 MB at the shared storage boundary", () => {
  assert.match(source, /blob\.type\.startsWith\("image\/"\) && blob\.size > 4 \* 1024 \* 1024/);
  assert.match(source, /compressImage\(dataUrl, \{ maxBytes: 4 \* 1024 \* 1024 \}\)/);
  assert.match(source, /blob\.size > 4 \* 1024 \* 1024/);
  assert.match(source, /maksimal 4 MB/);
});

test("photo upload passes files at or below 4 MB through unchanged", () => {
  assert.match(source, /let blob = dataUrlToBlob\(dataUrl\)/);
  assert.match(source, /if \(blob\.type\.startsWith\("image\/"\) && blob\.size > 4 \* 1024 \* 1024\)/);
});

test("compression fails closed when the requested max size cannot be reached", () => {
  assert.match(source, /bytesOf\(dataUrl\) > maxBytes/);
  assert.match(source, /throw new Error\(`Foto terlalu besar setelah kompresi/);
});
