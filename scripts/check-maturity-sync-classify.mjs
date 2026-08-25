// Self-check untuk folderSyncRole/aspectEvidenceMeta di supabase/functions/maturity-drive/index.ts
// (Deno EF, tak bisa diimpor langsung ke Node — fungsi dituliskan ulang identik di sini,
// jaga sinkron manual kalau logikanya berubah lagi). Jalankan: node scripts/check-maturity-sync-classify.mjs
import assert from "node:assert/strict";

function folderSyncRole(folderType) {
  return folderType === "ITEM" || folderType === "ASPECT" ? "evidence" : "unassigned";
}
function aspectEvidenceMeta(meta) {
  return {
    itemId: meta.itemId || `${meta.aspectId}::aspek`,
    itemLabel: meta.itemLabel || meta.aspectTitle || "Evidence Aspek",
    categoryLabel: meta.categoryLabel || "",
  };
}

assert.equal(folderSyncRole("ITEM"), "evidence");
assert.equal(folderSyncRole("ASPECT"), "evidence");
for (const t of ["ROOT", "PERIOD", "UPT", "CATEGORY"]) {
  assert.equal(folderSyncRole(t), "unassigned", `${t} harus tetap unassigned`);
}

// Folder ITEM: metadata lengkap, fallback tak boleh kepakai (no-op).
assert.deepEqual(
  aspectEvidenceMeta({ itemId: "5S-01", itemLabel: "Foto Rak", categoryLabel: "Kategori 1" }),
  { itemId: "5S-01", itemLabel: "Foto Rak", categoryLabel: "Kategori 1" }
);

// Folder ASPEK: tanpa itemId/itemLabel/categoryLabel -> fallback.
assert.deepEqual(
  aspectEvidenceMeta({ aspectId: "1.10", aspectTitle: "Tata Kelola Gudang" }),
  { itemId: "1.10::aspek", itemLabel: "Tata Kelola Gudang", categoryLabel: "" }
);

// aspectTitle kosong -> fallback label generik.
assert.equal(aspectEvidenceMeta({ aspectId: "3.4" }).itemLabel, "Evidence Aspek");

console.log("OK — check-maturity-sync-classify lulus.");
