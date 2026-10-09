import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../../src/components/MaturityAuditSystem.jsx", import.meta.url), "utf8");

test("Form 5S memakai empty state dan tombol tambah saat form tertutup", () => {
  assert.match(source, /const \[formOpen, setFormOpen\]/);
  assert.match(source, /!formOpen \? \(/);
  assert.match(source, /Tambah Pengisian 5S/);
  assert.match(source, /Tidak ada form aktif/);
  assert.match(source, /const startNewEntry = \(\) =>/);
  assert.match(source, /onClick=\{startNewEntry\}/);
  assert.match(source, /setSaved\(false\); setDraftSaved\(false\); setSaveError\(""\); setInvalidField\(""\); setLastSavedRecord\(null\)/);
  assert.match(source, /Pengisian 5S berhasil disimpan/);
  assert.match(source, /Data masuk ke History Audit 5S/);
  assert.match(source, /minHeight: 44/);
});

test("Form 5S membuka draft dan menutup setelah simpan final", () => {
  assert.match(source, /setFormOpen\(true\)/);
  assert.doesNotMatch(source, /clearMaturity5SDraft\?\./);
  assert.match(source, /setFormOpen\(false\)/);
  assert.match(source, /URL\.revokeObjectURL\(photo\.preview\)/);
  assert.match(source, /setChecks\(initChecks\(\)\); setSamplePhotos\(\[\]\); setGudang\(""\)/);
});
