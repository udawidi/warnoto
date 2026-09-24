import test from "node:test";
import assert from "node:assert/strict";
import { buildTUG5ULTGHTML } from "../../src/lib/docBuilders.js";

const baseTxn = {
  id: "RSV-IDENTITY-TEST",
  namaPekerjaan: "Pekerjaan uji",
  lokasiPekerjaan: "Lokasi uji",
  stockItems: [],
};

const ultgList = [
  { id: "ultg-sbu", nama: "ULTG SBU", kode: "SBU" },
  { id: "ultg-surabaya-utara", nama: "Surabaya Utara", kode: "SBU-UTARA" },
];

test("buildTUG5ULTGHTML renders the selected ULTG identity without cross-unit names", () => {
  const sbuHtml = buildTUG5ULTGHTML({ ...baseTxn, ultgId: "ultg-sbu" }, [], [], ultgList);
  const surabayaUtaraHtml = buildTUG5ULTGHTML({ ...baseTxn, ultgId: "ultg-surabaya-utara" }, [], [], ultgList);

  assert.match(sbuHtml, /ULTG SBU/);
  assert.doesNotMatch(sbuHtml, /Surabaya Utara/);
  assert.match(surabayaUtaraHtml, /Surabaya Utara/);
  assert.doesNotMatch(surabayaUtaraHtml, /ULTG SBU/);
});

test("buildTUG5ULTGHTML renders manual requestor and approval signature labels", () => {
  const html = buildTUG5ULTGHTML({ ...baseTxn, ultgId: "ultg-sbu", penanggungJawab: "Budi", jabatanPenanggungJawab: "PIC" }, [], [], ultgList);
  assert.match(html, /PENANGGUNG JAWAB/);
  assert.match(html, /Budi/);
  assert.match(html, /PIC/);
  assert.match(html, /MENGETAHUI, MANAGER ULTG/);
});
