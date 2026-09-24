import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const app = read("App.jsx");
const page = read("src/components/Form5SPage.jsx");
const form = read("src/components/MaturityAuditSystem.jsx");
const hook = read("src/hooks/useMaturity.jsx");
const drive = read("src/lib/maturityDrive.js");
const edge = read("supabase/functions/maturity-drive/index.ts");
const migration = read("supabase/migrations/20260919_form5s_photo_storage_guard.sql");
const draftMigration = read("supabase/migrations/20260919_maturity_5s_drafts.sql");
const schema = read("supabase/schema.sql");
const builder = read("src/lib/docBuilders.js");
const sync = read("src/lib/maturitySync.js");

test("Form 5S uses maturity permission alias and is top-level", () => {
  assert.match(app, /id:"maturity5s"[\s\S]{0,160}permissionKey:"menu\.maturity"/);
  assert.match(app, /tab === "maturity5s" &&/);
  assert.doesNotMatch(read("src/components/MaturityDashboardTab.jsx"), /id: "5s"/);
});

test("summary and history are canonical upt_id scoped", () => {
  assert.match(page, /item\.uptId === uptId/);
  assert.match(page, /item\.uptId === upt\.id/);
  assert.match(form, /item\.uptId === selectedUptId/);
  assert.match(app, /cacheScope === null \? \(cm5s \|\| \[\]\) : \(cm5s \|\| \[\]\)\.filter\(item => item\.uptId/);
  assert.match(hook, /function getCurrentMonth5SEvidence\(uptId\)[\s\S]{0,500}item\.uptId === uptId/);
  assert.match(hook, /mergeCurrentMonth5SEvidence\(\{\}, selectedMaturityUptId\)/);
});

test("photo endpoint accepts assessment ID and index only", () => {
  assert.match(drive, /downloadForm5SPhoto\(assessmentId, photoIndex\)/);
  assert.match(drive, /request\("sign-5s-photo", \{ assessmentId, photoIndex: index \}\)/);
  assert.match(edge, /action === "sign-5s-photo"/);
  assert.match(edge, /createSignedUrl\(storagePath, 600\)/);
  assert.match(edge, /action === "download-5s-photo"/);
  assert.match(edge, /findUptById\(text\(assessment\.upt_id/);
  assert.match(edge, /storagePath\.startsWith\(`form-5s\/\$\{upt\.id\}\//);
  assert.doesNotMatch(drive.match(/export async function downloadForm5SPhoto[\s\S]*?\n}/)?.[0] || "", /storagePath|driveFileId/);
});

test("Form 5S history signs all self-host photos in one scoped batch", () => {
  assert.match(drive, /openForm5SPhotos\(assessmentId, photoCount\)/);
  assert.match(drive, /request\("sign-5s-photos", \{ assessmentId \}\)/);
  assert.match(edge, /action === "sign-5s-photos"/);
  assert.match(edge, /select\("id,upt_id,sample_photos"\)/);
  assert.match(edge, /photos\.length > 3/);
  assert.match(edge, /storagePath\.startsWith\(`form-5s\/\$\{upt\.id\}\//);
  assert.match(edge, /createSignedUrl\(storagePath, 600\)/);
  assert.match(form, /openForm5SPhotos\(selected\.id, photos\.length\)/);
  assert.match(form, /openForm5SPhotos\(record\.id, Math\.min\(3, \(record\.samplePhotos \|\| \[\]\)\.length\)\)/);
});

test("new Form 5S photos are guarded by storage trigger", () => {
  for (const source of [migration, schema]) {
    assert.match(source, /validate_maturity_5s_photo_storage/);
    assert.match(source, /jsonb_array_length\(new\.sample_photos\) not between 1 and 3/);
    assert.match(source, /FORM5S_STORAGE_PATH_INVALID/);
    assert.match(source, /FORM5S_STORAGE_OBJECT_MISSING/);
    assert.match(source, /storage\.objects/);
  }
});

test("Form 5S PDF prioritizes canonical UPT master and persisted history", () => {
  assert.match(builder, /const uptNama = \(uptList \|\| \[\]\)\.find\(u => u\.id === record\.uptId\)\?\.nama \|\| record\.upt/);
  assert.doesNotMatch(builder, /const src = photo\.preview \|\| photo\.url/);
  assert.match(form, /Simpan checklist terlebih dahulu sebelum mencetak/);
  assert.match(form, /openForm5SPhotos\(record\.id, Math\.min\(3, \(record\.samplePhotos \|\| \[\]\)\.length\)\)/);
  assert.doesNotMatch(hook, /url: photo\.url/);
  assert.doesNotMatch(form, /url: photo\.url/);
});

test("Form 5S draft is owner-and-UPT scoped and final save cleans it up", () => {
  assert.match(draftMigration, /create table if not exists public\.maturity_5s_drafts/);
  assert.match(draftMigration, /unique \(owner_id, upt_id\)/);
  assert.match(draftMigration, /p_owner_id uuid,?\s*\n?\s*p_upt_id text/);
  assert.match(draftMigration, /p_owner_id = auth\.uid\(\)/);
  assert.match(draftMigration, /can_write_maturity_upt\(p_upt_id\)/);
  assert.match(draftMigration, /for delete to authenticated/);
  assert.match(schema, /maturity_5s_drafts/);
  assert.match(sync, /loadMaturity5SDraft/);
  assert.match(sync, /upsertMaturity5SDraft/);
  assert.match(sync, /deleteMaturity5SDraft/);
  assert.match(read("src/hooks/useMaturity.jsx"), /deleteMaturity5SDraft\(\{ id: maturity5SDraft\?\.id, uptId: entry\.uptId \}\)/);
});

test("Form 5S history stays compact and photo source is chosen after one trigger", () => {
  assert.match(form, /const selected = history\.find\(item => item\.id === selectedId\) \|\| null/);
  assert.match(form, /Tambah Foto/);
  assert.match(form, /Pilih sumber foto/);
  assert.match(form, /capture="environment"/);
  assert.match(form, /Detail Audit/);
  assert.match(form, /onPrint\(item\)[\s\S]{0,80}>Cetak \/ PDF/);
  assert.doesNotMatch(form, /\{false &&/);
});

test("Form 5S history keeps the popup alive while photo bytes are prepared", () => {
  const printHandler = form.slice(form.indexOf("const handlePrintRecord = async record =>"), form.indexOf("const handlePrint = () =>"));
  const preparationPage = printHandler.indexOf("Menyiapkan foto eviden...");
  const signedSource = printHandler.indexOf("openForm5SPhotos(record.id, Math.min(3, (record.samplePhotos || []).length))");
  const popupCleanup = printHandler.indexOf("beforeunload");
  const finalRender = printHandler.indexOf("buildForm5SHTML(printRecord, users, uptList)");
  assert.ok(preparationPage >= 0, "print handler must render a preparation page immediately");
  assert.ok(signedSource >= 0, "print handler must resolve signed photo URLs");
  assert.ok(popupCleanup >= 0, "legacy proxy object URLs must live until popup unload");
  assert.ok(finalRender > signedSource, "final print document must wait for photo URLs");
  assert.match(builder, /data-form5s-photo/);
  assert.match(builder, /form5s-print/);
});
