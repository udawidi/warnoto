import test from "node:test";
import assert from "node:assert/strict";
import { decodeDataUrl, inspectRows, run, storagePath } from "../../scripts/migrate_stock_legacy_img_to_storage.mjs";

test("decodes image data URL and derives stable SHA-256 path", () => {
  const image = decodeDataUrl("data:image/png;base64,SGVsbG8=");
  assert.equal(image.mime, "image/png");
  assert.equal(image.bytes.toString(), "Hello");
  assert.equal(storagePath(image.hash, image.extension), `legacy/${image.hash}.png`);
});

test("inspectRows counts references, unique bytes, and ignores remote/non-image values", () => {
  const img = "data:image/jpeg;base64,SGVsbG8=";
  const report = inspectRows([
    { id: "S-1", data: { img } },
    { id: "S-2", data: { img } },
    { id: "S-3", data: { img: "https://warnoto.com/storage/x" } },
    { id: "S-4", data: { img: "data:text/plain;base64,SGVsbG8=" } },
  ]);
  assert.equal(report.references, 2);
  assert.equal(report.unique.length, 1);
  assert.equal(report.bytes, 10);
  assert.deepEqual(report.affected.map((row) => row.id), ["S-1", "S-2"]);
});

test("malformed and empty data URLs are ignored", () => {
  assert.equal(decodeDataUrl("data:image/png;base64,"), null);
  assert.equal(decodeDataUrl("not-a-data-url"), null);
});

test("apply uploads one deduplicated object, updates only img, and skips stale rows", async () => {
  const img = "data:image/jpeg;base64,SGVsbG8=";
  const rows = [
    { id: "S-1", data: { img, qty: 3, name: "A" } },
    { id: "S-2", data: { img, qty: 4, name: "B" } },
  ];
  const uploads = [];
  const updates = [];
  const fake = {
    storage: { from: () => ({ upload: async (...args) => { uploads.push(args); return { error: null }; } }) },
    from: (table) => ({
      select: () => ({
        order: () => ({ limit: () => ({ then: (resolve) => resolve({ data: rows, error: null }) }) }),
        eq: (_field, id) => ({ maybeSingle: async () => ({ data: rows.find((row) => row.id === id), error: null }) }),
      }),
      update: (payload) => ({ eq: (_field, id) => ({ select: async () => { updates.push({ table, id, payload }); return { data: [{ id }], error: null }; } }) }),
    }),
  };
  const result = await run({ supabase: fake, url: "https://warnoto.com", apply: true, log: () => {} });
  assert.equal(uploads.length, 1);
  assert.equal(result.updated, 2);
  assert.equal(updates.length, 2);
  assert.deepEqual(updates.map((item) => item.payload.data.img), [
    `https://warnoto.com/storage/v1/object/public/stock-photos/${storagePath(decodeDataUrl(img).hash, "jpg")}`,
    `https://warnoto.com/storage/v1/object/public/stock-photos/${storagePath(decodeDataUrl(img).hash, "jpg")}`,
  ]);
  assert.deepEqual(updates.map((item) => item.payload.data.qty), [3, 4]);

  const staleRows = [{ id: "S-1", data: { img: "data:image/jpeg;base64,Qnll", qty: 3, name: "A" } }];
  const staleFake = { ...fake, from: (table) => table === "stocks" ? {
    select: () => ({ order: () => ({ limit: () => ({ then: (resolve) => resolve({ data: rows.slice(0, 1), error: null }) }) }), eq: () => ({ maybeSingle: async () => ({ data: staleRows[0], error: null }) }) }),
    update: () => ({ eq: () => ({ select: async () => { throw new Error("must not update stale row"); } }) }),
  } : fake.from(table) };
  const stale = await run({ supabase: staleFake, url: "https://warnoto.com", apply: true, log: () => {} });
  assert.equal(stale.updated, 0);
  assert.equal(stale.stale, 1);
});
