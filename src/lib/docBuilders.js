// Doc builders HTML (TUG-3/4/5/5ULTG/7/9/10 + Berita Acara Opname + Peminjaman
// Alat Berat) — dipindah dari App.jsx (refactor Fase 3b). Pure: terima data,
// kembalikan string HTML / buka window cetak. Tanpa React/state.
import { PLN_LOGO_DATA_URI } from "../assets/plnLogoBase64.js";
import { fmtNum, getSAPLabel } from "./ragShared.mjs";
import { fmtDate, fmtDateOnly, fmtRp, generateDocNumbers, terbilangHari } from "./utils.js";
import { COMPANY, UIT, UPT, WAREHOUSE, DOC_CODE } from "../constants.js";

// ─── TUG-9 DOCUMENT HTML BUILDER (Surat Jalan + Bon TUG-9 + Lampiran Foto) ────
// Returns a full standalone HTML string. Used for both in-app preview
// (rendered in an iframe inside a modal) and for downloading as a
// .html file the user can open in any browser and Print > Save as PDF.
export function buildTUG9HTML(txn, stocks, users, satpamList) {
  const docs = txn.docNumbers;
  const isTUG8 = txn.docType === "TUG8";
  const docKey = isTUG8 ? "tug8" : "tug9";
  const creator = users.find(u=>u.id===txn.createdBy) || {};
  const actualApprover = users.find(u=>u.id===txn.approvedBy) || {};
  // "Mengetahui" on the Bon Pemakaian is ALWAYS Asman Konstruksi, per baku format.
  // Whether Asman approved it directly or it was auto-approved alongside TL's
  // approval, the on-file Asman Konstruksi user always signs this slot.
  const asmanUser = users.find(u => u.role === "ASMAN") || {};
  // "Yang Menyerahkan" is always TL Logistik (whoever holds that role / actually approved if TL)
  const menyerahkanUser = txn.requiredApprover === "TL" ? actualApprover : (users.find(u=>u.role==="TL")||{});
  const satpamUser = (satpamList||[]).find(sp => sp.id === txn.satpamId) || {};
  const itemRows = txn.stockItems.map(si => {
    const stock = stocks.find(s=>s.id===si.stockId) || {};
    return { stock, qty: si.qty };
  });

  const materialRowsSJ = itemRows.map(({stock,qty}) => `
    <tr><td>${stock.name||""}</td><td>${stock.lokasi||""}</td><td style="text-align:center">${fmtNum(qty)}</td><td style="text-align:center">${stock.unit||""}</td><td>${stock.jenisBarang==="Non-Stock"?"(NON-STOCK) ":""}${txn.keteranganBarang||""}</td></tr>`).join("");

  const materialRowsTUG9 = itemRows.map(({stock,qty}) => `
    <tr><td style="text-align:center">${fmtNum(qty)}</td><td style="text-align:center">${stock.unit||""}</td><td>${stock.name||""}</td><td style="text-align:center">${stock.katalog||"-"}</td><td>${stock.jenisBarang==="Non-Stock"?"(NON-STOCK) ":""}${txn.keteranganBarang||""}</td></tr>`).join("");

  // ── Lampiran Foto: build photo rows (2 columns: Kendaraan/SIM-KTP, then Surat, then per-material) ──
  const hasAnyAttachment = txn.fotoKendaraan || txn.fotoSimKtp || txn.fotoSuratPengembalian || (txn.fotoMaterial && txn.fotoMaterial.length > 0);
  function photoCell(label, src) {
    return `<div class="photo-cell"><div class="photo-label">${label}</div>${src ? `<img src="${src}" alt="${label}"/>` : `<div class="photo-empty">Tidak ada foto</div>`}</div>`;
  }
  const materialPhotoCells = itemRows.map(({stock}) => {
    const photo = (txn.fotoMaterial||[]).find(fm => fm.stockId === stock.id);
    return photoCell(stock.name || "-", photo?.img);
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${isTUG8?"TUG-8":"TUG-9"} ${txn.id}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:10.5px;color:#111;background:#e5e7eb}
.page{padding:28px;page-break-after:always;min-height:100vh;background:white;max-width:794px;margin:0 auto 16px}
.page:last-child{page-break-after:auto;margin-bottom:0}
.topbar{height:6px;background:linear-gradient(90deg,#00377a,#0098da);margin-bottom:4px}
.head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}
.head h1{font-size:13px;font-weight:800;letter-spacing:.3px}
.head .sub{font-size:9px;color:#555}
.logobox{display:flex;align-items:center;gap:6px}
.logo{height:38px;width:auto;display:block;object-fit:contain}
.doctitle{text-align:center;margin-bottom:4px}
.doctitle h2{font-size:14px;font-weight:800;letter-spacing:.5px}
.doctitle .docno{font-size:10px;font-style:italic;color:#0098da;font-weight:700}
table.meta{width:100%;margin-bottom:10px;font-size:10.5px}
table.meta td{padding:2px 4px;vertical-align:top}
table.meta td.label{width:140px;color:#333}
table.meta td.colon{width:10px}
table.items{width:100%;border-collapse:collapse;margin-bottom:10px}
table.items th{background:#003087;color:white;padding:6px 6px;font-size:9.5px;text-align:left}
table.items td{padding:6px 6px;border-bottom:1px solid #ddd;font-size:10px}
.sig-row{display:flex;justify-content:space-between;margin-top:18px;text-align:center}
.sig-col{flex:1;font-size:10px}
.sig-space{height:50px}
.sig-name{font-weight:700;text-decoration:underline;margin-top:2px}
.note{font-size:9.5px;font-style:italic;margin-bottom:10px}
.status-stamp{display:inline-block;border:2px solid #16a34a;color:#16a34a;font-weight:800;padding:4px 14px;border-radius:6px;font-size:11px;transform:rotate(-8deg);margin-bottom:8px}
.print-bar{position:sticky;top:0;background:#003087;color:white;padding:10px 16px;text-align:center;font-size:13px;font-weight:700;z-index:10}
.print-bar button{background:#16a34a;color:white;border:none;border-radius:6px;padding:8px 18px;font-size:13px;font-weight:700;cursor:pointer;margin-left:10px}
.photo-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
.photo-cell{border:1px solid #ccc;border-radius:6px;overflow:hidden}
.photo-label{background:#f1f5f9;padding:6px 10px;font-size:10px;font-weight:700;border-bottom:1px solid #ccc}
.photo-cell img{width:100%;height:160px;object-fit:cover;display:block}
.photo-empty{height:160px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:10px;font-style:italic;background:#fafafa}
.section-heading{font-weight:800;font-size:11.5px;margin:14px 0 8px;color:#003087}
@media print{.print-bar{display:none}.page{box-shadow:none;margin:0;max-width:none}body{background:white}}
</style></head><body>

<div class="print-bar">📄 Dokumen TUG-9 siap dicetak &nbsp; <button onclick="window.print()">🖨️ Print / Save as PDF</button></div>

<!-- ════════ PAGE 1: SURAT JALAN ════════ -->
<div class="page">
  <div class="topbar"></div>
  <div class="head">
    <div><h1>${UIT}</h1><div class="sub">Unit Pelaksana Transmisi Surabaya</div></div>
    <div class="logobox"><img class="logo" src="${PLN_LOGO_DATA_URI}" alt="Logo PLN"/></div>
  </div>
  <div class="doctitle"><h2>SURAT JALAN PENGAMBILAN MATERIAL</h2><div class="docno">${docs.sj}</div></div>

  <table class="meta">
    <tr><td class="label">Dibawa Ke</td><td class="colon">:</td><td>${txn.lokasiPekerjaan}</td><td class="label" style="width:120px">Kendaraan / Nopol</td><td class="colon">:</td><td>${txn.nopol||"-"}</td></tr>
    <tr><td class="label">Tanggal Pengambilan</td><td class="colon">:</td><td>${fmtDateOnly(txn.createdAt)}</td><td class="label">No SIM / KTP Pengemudi</td><td class="colon">:</td><td>${txn.simKtp||"-"}</td></tr>
    <tr><td class="label">PIC Gudang ${UPT}</td><td class="colon">:</td><td colspan="3">${creator.name||"-"}</td></tr>
  </table>

  <table class="items">
    <thead><tr><th>Material</th><th>Gudang</th><th>Jumlah</th><th>Satuan</th><th>Keterangan</th></tr></thead>
    <tbody>${materialRowsSJ}</tbody>
  </table>

  <div class="note">Demikian Surat Jalan ini kami buat agar dipergunakan sebagaimana mestinya</div>

  <div class="sig-row">
    <div class="sig-col">Transporter,<div class="sig-space"></div><div class="sig-name">${txn.namaPengemudi||"....................."}</div></div>
    <div class="sig-col">Mengetahui,<br>SATPAM ${WAREHOUSE.toUpperCase()}<div class="sig-space"></div><div class="sig-name">${satpamUser.name||"....................."}</div></div>
    <div class="sig-col">Yang menyerahkan,<br>ADMINISTRASI GUDANG<div class="sig-space"></div><div class="sig-name">${creator.name||"....................."}</div></div>
  </div>
</div>

<!-- ════════ PAGE 2: BON PEMAKAIAN TUG-9 ════════ -->
<div class="page">
  <div class="topbar"></div>
  <div class="head">
    <div></div>
    <div class="logobox"><img class="logo" src="${PLN_LOGO_DATA_URI}" alt="Logo PLN"/></div>
  </div>
  <div style="text-align:right;font-weight:800;font-size:13px;margin-bottom:6px">${isTUG8 ? "TUG 8" : "TUG 9"}</div>
  <div class="doctitle"><h2>BON PEMAKAIAN</h2><div class="docno">${docs[docKey]}</div></div>

  ${txn.status==="APPROVED" ? `<div style="text-align:center"><span class="status-stamp">✓ DISETUJUI</span></div>` : ""}

  <table class="meta" style="border:1px solid #ccc;border-radius:4px;padding:6px;margin-bottom:10px">
    <tr><td colspan="6" style="font-weight:700;text-align:center;border-bottom:1px solid #ccc;padding-bottom:4px">${COMPANY.toUpperCase()} UNIT INDUK TRANSMISI JAWA BAGIAN TIMUR DAN BALI</td></tr>
    <tr><td class="label">PEKERJAAN</td><td class="colon">:</td><td colspan="2">${txn.pekerjaan}</td><td class="label" style="width:90px">UNIT/SEKTOR</td><td>: ${isTUG8 ? (txn.unitTujuan||"-") : UPT}</td></tr>
    <tr><td class="label">NAMA PEKERJAAN</td><td class="colon">:</td><td colspan="2">${txn.namaPekerjaan}</td><td class="label">SURAT/NODIN</td><td>: ${txn.noNodin||"-"}</td></tr>
    <tr><td class="label">LOKASI PEKERJAAN</td><td class="colon">:</td><td colspan="2">${txn.lokasiPekerjaan}</td><td class="label">TANGGAL</td><td>: ${fmtDateOnly(txn.createdAt)}</td></tr>
  </table>

  <table class="items">
    <thead><tr><th>Banyaknya</th><th>Satuan</th><th>Nama Barang / Spare Parts</th><th>Nomor Katalog</th><th>Keterangan</th></tr></thead>
    <tbody>${materialRowsTUG9}</tbody>
  </table>

  <table class="meta" style="border:1px solid #ccc;border-radius:4px;padding:6px;margin-bottom:10px">
    <tr><td class="label" style="width:160px">Perkiraan Pembebanan</td><td class="colon">:</td><td>${txn.perkiraanPembebanan||"-"}</td></tr>
    <tr><td class="label">Kode Perkiraan</td><td class="colon">:</td><td>${txn.kodePerkiraan||"-"}</td></tr>
    <tr><td class="label">Tanggal</td><td class="colon">:</td><td>${fmtDateOnly(txn.approvedAt||Date.now())}</td></tr>
  </table>

  <div class="sig-row">
    <div class="sig-col">Yang Menerima,<br>${txn.penerimaUnit||"-"}<div class="sig-space"></div><div class="sig-name">${txn.penerimaNama||"....................."}</div></div>
    <div class="sig-col">Mengetahui,<br>${asmanUser.jabatan||"ASMAN KONSTRUKSI " + UPT}<div class="sig-space"></div><div class="sig-name">${asmanUser.name||"....................."}</div></div>
    <div class="sig-col">Yang Menyerahkan,<br>${menyerahkanUser.jabatan||"TL LOGISTIK " + UPT}<div class="sig-space"></div><div class="sig-name">${menyerahkanUser.name||"....................."}</div></div>
  </div>
  ${txn.requiredApprover==="TL" ? `<div style="font-size:9px;color:#16a34a;text-align:center;margin-top:6px;font-style:italic">* Disetujui oleh TL Logistik, Asman Konstruksi turut menyetujui sesuai ketentuan internal</div>` : ""}
</div>

${hasAnyAttachment ? `
<!-- ════════ PAGE 3: LAMPIRAN FOTO ════════ -->
<div class="page">
  <div class="topbar"></div>
  <div class="head">
    <div><h1>${UIT}</h1><div class="sub">Unit Pelaksana Transmisi Surabaya</div></div>
    <div class="logobox"><img class="logo" src="${PLN_LOGO_DATA_URI}" alt="Logo PLN"/></div>
  </div>
  <div class="doctitle"><h2>LAMPIRAN FOTO</h2><div class="docno">${docs[docKey]}</div></div>

  <div class="section-heading">Foto Kendaraan &amp; SIM / KTP Pengemudi</div>
  <div class="photo-grid">
    ${photoCell("Foto Kendaraan", txn.fotoKendaraan)}
    ${photoCell("SIM / KTP Pengemudi", txn.fotoSimKtp)}
  </div>

  ${txn.fotoSuratPengembalian ? `
  <div class="section-heading">Surat Permintaan / Pengembalian</div>
  <div class="photo-grid">
    ${photoCell("Surat Permintaan / Pengembalian", txn.fotoSuratPengembalian)}
  </div>` : ""}

  ${itemRows.length > 0 ? `
  <div class="section-heading">Foto Material</div>
  <div class="photo-grid">
    ${materialPhotoCells}
  </div>` : ""}
</div>` : ""}

</body></html>`;
}

// Triggers a real browser download of the HTML document (works without
// any external CDN and without window.open — uses a Blob + <a download>).
// ─── TUG-10 DOCUMENT HTML BUILDER (Bon Pengembalian) ──────────────────
// Single-page document matching the uploaded format_TUG_10.pdf layout.
// Signature roles are reversed vs TUG-9: external party hands material
// back, internal SPV/TL Log receives it, Asman still signs "Mengetahui".
export function buildTUG10HTML(txn, katalogList, lokasiList, users) {
  const docs = txn.docNumbers;
  const asmanUser = users.find(u => u.role === "ASMAN") || {};
  const actualApprover = users.find(u=>u.id===txn.approvedBy) || {};
  // "Yang Menerima" is internal SPV/TL Log (whoever holds that role / actually approved if TL)
  const penerimaUser = txn.requiredApprover === "TL" ? actualApprover : (users.find(u=>u.role==="TL")||{});
  const lokTujuan = (lokasiList||[]).find(l => l.id === txn.lokasiTujuanId) || {};

  const itemRows = txn.stockItems.map(si => {
    const namaBarang = si.katalogMode==="existing" ? ((katalogList||[]).find(k=>k.id===si.katalogId)?.name||"-") : si.namaBaru;
    const satuan = si.katalogMode==="existing" ? ((katalogList||[]).find(k=>k.id===si.katalogId)?.satuan||"-") : (si.satuanBaru||"-");
    const ketStatus = si.statusMaterial==="Bongkaran ATTB (MTU)" ? `EKS BONGKARAN ATTB/MTU${si.noSeri?` — SN: ${si.noSeri}`:""}` : si.statusMaterial==="Bongkaran" ? "EKS BONGKARAN" : "MATERIAL SISA BARU";
    return `<tr><td>${namaBarang}</td><td style="text-align:center">${fmtNum(si.qty)}</td><td style="text-align:center">${satuan}</td><td style="text-align:center">${si.noAsset||"-"}</td><td>${ketStatus}</td></tr>`;
  }).join("");

  const hasAttachments = txn.fotoBAPengembalian || txn.stockItems.some(si=>si.fotoNameplate||si.fotoBarangRetur);
  // Note: with foto barang now mandatory for every item, hasAttachments will
  // almost always be true for transactions created after this fix.
  function photoCell(label, src) {
    return `<div class="photo-cell"><div class="photo-label">${label}</div>${src ? `<img src="${src}" alt="${label}"/>` : `<div class="photo-empty">Tidak ada foto</div>`}</div>`;
  }
  const materialPhotoCells = txn.stockItems.map(si => {
    const namaBarang = si.katalogMode==="existing" ? ((katalogList||[]).find(k=>k.id===si.katalogId)?.name||"-") : si.namaBaru;
    const cells = [photoCell(`${namaBarang} — Foto Barang (${si.statusMaterial})`, si.fotoBarangRetur)];
    if (si.statusMaterial === "Bongkaran ATTB (MTU)") cells.push(photoCell(`${namaBarang} — Nameplate`, si.fotoNameplate));
    return cells.join("");
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TUG-10 ${txn.id}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:10.5px;color:#111;background:#e5e7eb}
.page{padding:28px;page-break-after:always;min-height:100vh;background:white;max-width:794px;margin:0 auto 16px}
.page:last-child{page-break-after:auto;margin-bottom:0}
.topbar{height:6px;background:linear-gradient(90deg,#00377a,#0098da);margin-bottom:4px}
.head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}
.head h1{font-size:13px;font-weight:800;letter-spacing:.3px}
.head .sub{font-size:9px;color:#555}
.logobox{display:flex;align-items:center;gap:6px}
.logo{height:38px;width:auto;display:block;object-fit:contain}
.doctitle{text-align:center;margin-bottom:4px}
.doctitle h2{font-size:14px;font-weight:800;letter-spacing:.5px}
.doctitle .docno{font-size:10px;font-style:italic;color:#0098da;font-weight:700}
table.meta{width:100%;margin-bottom:10px;font-size:10.5px}
table.meta td{padding:2px 4px;vertical-align:top}
table.meta td.label{width:140px;color:#333}
table.meta td.colon{width:10px}
table.items{width:100%;border-collapse:collapse;margin-bottom:10px}
table.items th{background:#003087;color:white;padding:6px 6px;font-size:9.5px;text-align:left}
table.items td{padding:6px 6px;border-bottom:1px solid #ddd;font-size:10px}
.sig-row{display:flex;justify-content:space-between;margin-top:18px;text-align:center}
.sig-col{flex:1;font-size:10px}
.sig-space{height:50px}
.sig-name{font-weight:700;text-decoration:underline;margin-top:2px}
.status-stamp{display:inline-block;border:2px solid #16a34a;color:#16a34a;font-weight:800;padding:4px 14px;border-radius:6px;font-size:11px;transform:rotate(-8deg);margin-bottom:8px}
.print-bar{position:sticky;top:0;background:#003087;color:white;padding:10px 16px;text-align:center;font-size:13px;font-weight:700;z-index:10}
.print-bar button{background:#16a34a;color:white;border:none;border-radius:6px;padding:8px 18px;font-size:13px;font-weight:700;cursor:pointer;margin-left:10px}
.photo-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
.photo-cell{border:1px solid #ccc;border-radius:6px;overflow:hidden}
.photo-label{background:#f1f5f9;padding:6px 10px;font-size:10px;font-weight:700;border-bottom:1px solid #ccc}
.photo-cell img{width:100%;height:160px;object-fit:cover;display:block}
.photo-empty{height:160px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:10px;font-style:italic;background:#fafafa}
.section-heading{font-weight:800;font-size:11.5px;margin:14px 0 8px;color:#003087}
@media print{.print-bar{display:none}.page{box-shadow:none;margin:0;max-width:none}body{background:white}}
</style></head><body>

<div class="print-bar">📄 Dokumen TUG-10 siap dicetak &nbsp; <button onclick="window.print()">🖨️ Print / Save as PDF</button></div>

<!-- ════════ PAGE 1: BON PENGEMBALIAN ════════ -->
<div class="page">
  <div class="topbar"></div>
  <div class="head">
    <div></div>
    <div class="logobox"><img class="logo" src="${PLN_LOGO_DATA_URI}" alt="Logo PLN"/></div>
  </div>
  <div style="text-align:right;font-weight:800;font-size:13px;margin-bottom:6px">TUG 10<br/><span style="font-size:9px;font-weight:400">2. Untuk Fungsi Gudang</span></div>
  <div class="doctitle"><h2>BON PENGEMBALIAN</h2><div class="docno">${docs.tug10}</div></div>

  ${txn.status==="APPROVED" ? `<div style="text-align:center"><span class="status-stamp">✓ DISETUJUI</span></div>` : ""}

  <table class="meta" style="border:1px solid #ccc;border-radius:4px;padding:6px;margin-bottom:10px">
    <tr><td colspan="6" style="font-weight:700;text-align:center;border-bottom:1px solid #ccc;padding-bottom:4px">${COMPANY.toUpperCase()} UNIT INDUK TRANSMISI JAWA BAGIAN TIMUR DAN BALI</td></tr>
    <tr><td class="label">PEKERJAAN</td><td class="colon">:</td><td colspan="2">${txn.pekerjaan||"-"}</td><td class="label" style="width:100px">UNIT/SEKTOR</td><td>: ${UPT}</td></tr>
    <tr><td class="label">NAMA PEKERJAAN</td><td class="colon">:</td><td colspan="2">${txn.namaPekerjaan}</td><td class="label">NO BA PENGGANTIAN</td><td>: ${txn.noBAPenggantian||"-"}</td></tr>
    <tr><td class="label">LOKASI PEKERJAAN</td><td class="colon">:</td><td colspan="2">${txn.lokasiPekerjaan}</td><td class="label">TANGGAL</td><td>: ${fmtDateOnly(txn.createdAt)}</td></tr>
  </table>

  <table class="items">
    <thead><tr><th>Nama Barang / Spare Parts</th><th>Jumlah</th><th>Satuan</th><th>Nomor Asset</th><th>Keterangan</th></tr></thead>
    <tbody>${itemRows}</tbody>
  </table>

  <table class="meta" style="border:1px solid #ccc;border-radius:4px;padding:6px;margin-bottom:10px">
    <tr><td class="label" style="width:160px">Perkiraan Pembebanan</td><td class="colon">:</td><td>${txn.perkiraanPembebanan||"-"}</td></tr>
    <tr><td class="label">Kode Perkiraan</td><td class="colon">:</td><td>${txn.kodePerkiraan||"-"}</td></tr>
    <tr><td class="label">Disimpan di Lokasi</td><td class="colon">:</td><td>${lokTujuan.kode||"-"}</td></tr>
    <tr><td class="label">Tanggal</td><td class="colon">:</td><td>${fmtDateOnly(txn.approvedAt||Date.now())}</td></tr>
  </table>

  <div class="sig-row">
    <div class="sig-col">Mengetahui,<br>${asmanUser.jabatan||"ASMAN KONS UPT " + UPT}<div class="sig-space"></div><div class="sig-name">${asmanUser.name||"....................."}</div></div>
    <div class="sig-col">Yang Menerima,<br>${penerimaUser.jabatan||"SPV LOG UPT " + UPT}<div class="sig-space"></div><div class="sig-name">${penerimaUser.name||"....................."}</div></div>
    <div class="sig-col">Yang Menyerahkan<div class="sig-space"></div><div class="sig-name">${txn.menyerahkanNama||"....................."}</div></div>
  </div>
  ${txn.requiredApprover==="TL" ? `<div style="font-size:9px;color:#16a34a;text-align:center;margin-top:6px;font-style:italic">* Disetujui oleh TL Logistik, Asman Konstruksi turut menyetujui sesuai ketentuan internal</div>` : ""}
</div>

${hasAttachments ? `
<!-- ════════ PAGE 2: LAMPIRAN FOTO & SURAT BA ════════ -->
<div class="page">
  <div class="topbar"></div>
  <div class="head">
    <div><h1>${UIT}</h1><div class="sub">Unit Pelaksana Transmisi Surabaya</div></div>
    <div class="logobox"><img class="logo" src="${PLN_LOGO_DATA_URI}" alt="Logo PLN"/></div>
  </div>
  <div class="doctitle"><h2>LAMPIRAN — MATERIAL BEKAS/ATTB</h2><div class="docno">${docs.tug10}</div></div>

  ${txn.fotoBAPengembalian ? `
  <div class="section-heading">Surat BA Pengembalian</div>
  <div class="photo-grid">${photoCell("Surat BA Pengembalian", txn.fotoBAPengembalian)}</div>` : ""}

  ${materialPhotoCells ? `
  <div class="section-heading">Foto Barang &amp; Nameplate per Material</div>
  <div class="photo-grid">${materialPhotoCells}</div>` : ""}
</div>` : ""}

</body></html>`;
}

export function downloadTUG10HTML(txn, katalogList, lokasiList, users, showToast) {
  const html = buildTUG10HTML(txn, katalogList, lokasiList, users);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `TUG10_${txn.docSeq}_${txn.namaPekerjaan.replace(/[^a-zA-Z0-9]/g,"_").slice(0,30)}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast && showToast("📄 File diunduh! Buka di browser HP/laptop, lalu Print > Save as PDF.", "success");
}

// ─── TUG-3 / TUG-4 DOCUMENT HTML BUILDER ───────────────────────────────
// Combines all 3 stages into one printable document: TUG-3 Karantina (page 1),
// TUG-4 Berita Acara Pemeriksaan (page 2), and Lampiran Foto Final (page 3+).
// ─── TUG-5 DOCUMENT BUILDER ─────────────────────────────────────────────
export function buildTUG5HTML(txn, katalogList, uitList, users, ultgList) {
  const docs = txn.docNumbers;
  const isUltg = txn.sourceType === "ULTG";

  if (isUltg) return buildTUG5ULTGHTML(txn, katalogList, users, ultgList);

  const managerUser = users.find(u=>u.role==="MANAGER")||{};
  const asmanUser = users.find(u=>u.role==="ASMAN")||{};
  const uit = (uitList||[]).find(u=>u.id===txn.uitId)||{};
  const tanggal = fmtDateOnly(txn.approvedAtManager||txn.createdAt);

  const itemRows = (txn.stockItems||[]).map((si,idx)=>{
    const kat = (katalogList||[]).find(k=>k.id===si.katalogId)||{};
    return `<tr>
      <td>${kat.name||"-"}</td>
      <td style="text-align:center">${kat.katalog||"-"}</td>
      <td style="text-align:center">${kat.satuan||"-"}</td>
      <td style="text-align:center">${fmtNum(si.pemakaianBulan||0)}</td>
      <td style="text-align:center">${fmtNum(si.sisaPersediaan||0)}</td>
      <td style="text-align:center">${fmtNum(si.permintaan||0)}</td>
      <td style="text-align:center"></td><td style="text-align:center"></td><td></td>
      <td>${si.keterangan||""}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TUG-5 ${txn.id}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:10px;color:#111;background:#e5e7eb}.page{padding:24px;background:white;max-width:1000px;margin:0 auto 16px;min-height:100vh}.topbar{height:5px;background:linear-gradient(90deg,#00377a,#0098da);margin-bottom:4px}.doctitle{text-align:center;margin-bottom:10px}.doctitle h2{font-size:13px;font-weight:800;text-decoration:underline}.doctitle .docno{font-size:10px;font-style:italic;color:#0098da}table.meta{width:100%;margin-bottom:10px}table.meta td{padding:2px 3px;font-size:10px}table.meta td.label{width:90px}table.meta td.colon{width:8px}table.items{width:100%;border-collapse:collapse;margin-bottom:10px}table.items th{background:#003087;color:white;padding:5px 5px;font-size:9px;text-align:center;border:1px solid #ccc}table.items td{padding:5px 5px;border:1px solid #ccc;font-size:9.5px}.sig-row{display:flex;justify-content:space-around;margin-top:20px;text-align:center}.sig-col{flex:1;font-size:10px}.sig-space{height:50px}.sig-name{font-weight:700;text-decoration:underline;margin-top:2px}.print-bar{position:sticky;top:0;background:#003087;color:white;padding:8px 14px;text-align:center;font-size:12px;font-weight:700;z-index:10}.print-bar button{background:#16a34a;color:white;border:none;border-radius:6px;padding:6px 16px;font-size:12px;cursor:pointer;margin-left:10px}@media print{.print-bar{display:none}body{background:white}}</style></head><body>
<div class="print-bar">📄 TUG-5 siap cetak <button onclick="window.print()">🖨️ Print / Save as PDF</button></div>
<div class="page">
<div class="topbar"></div>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
  <div><b>PT PLN (PERSERO)</b><br/>${UIT}</div>
  <div style="font-weight:800;font-size:14px">TUG - 5</div>
</div>
<div class="doctitle"><h2>DAFTAR PERMINTAAN BARANG - BARANG</h2><div class="docno">${docs?.tug5||txn.id}</div></div>
<table class="meta" style="border:1px solid #ccc;padding:6px;border-radius:4px;margin-bottom:10px">
  <tr>
    <td class="label">Kepada</td><td class="colon">:</td>
    <td colspan="3">${uit.nama||"-"}</td>
    <td style="width:60px"><b>PLN</b></td><td>: ${uit.kode||"UIT-JBM"}</td>
  </tr>
  <tr>
    <td class="label">Harap dikirim ke</td><td class="colon">:</td>
    <td colspan="3">PT PLN (PERSERO) ${UIT} - UPT SURABAYA</td>
    <td><b>UPT</b></td><td>: UPT SURABAYA</td>
  </tr>
  <tr>
    <td class="label">Alamat</td><td class="colon">:</td>
    <td colspan="5">JL. KETINTANG BARU NO. 9 SURABAYA KODE POS 60231</td>
  </tr>
</table>
<table class="items">
  <thead>
    <tr>
      <th rowspan="2" style="width:22%">Nama Barang<br/>(Ditulis Selengkap–lengkapnya)</th>
      <th rowspan="2">Nomor<br/>Normalisasi</th>
      <th rowspan="2">Satuan</th>
      <th rowspan="2">Pemakaian<br/>rata-rata<br/>per bulan</th>
      <th rowspan="2">Sisa<br/>Persediaan</th>
      <th rowspan="2">Permintaan</th>
      <th colspan="3">Diberikan</th>
      <th rowspan="2">Keterangan</th>
    </tr>
    <tr><th>Jumlah</th><th>DO Nomor</th><th>Tanggal</th></tr>
  </thead>
  <tbody>${itemRows}</tbody>
</table>
<table class="meta" style="border:1px solid #ccc;border-radius:4px;padding:6px;margin-bottom:10px">
  <tr><td class="label">Keterangan</td><td class="colon">:</td><td>${txn.keteranganUmum||"-"}</td></tr>
  <tr><td class="label">Perintah Kerja</td><td class="colon">:</td><td>${txn.perintahKerja||""}</td><td style="width:80px">Kode Perkiraan</td><td class="colon">:</td><td>${txn.kodePerkiraan||""}</td><td style="width:50px">Fungsi</td><td class="colon">:</td><td>${txn.fungsi||""}</td></tr>
</table>
<div style="text-align:right;font-size:10px;margin-bottom:14px">${tanggal}</div>
<div class="sig-row">
  <div class="sig-col"><b>MANAGER UPT SURABAYA</b><div class="sig-space"></div><div class="sig-name">${managerUser.name||"....................."}</div></div>
  <div class="sig-col"><b>ASMAN KONSTRUKSI</b><div class="sig-space"></div><div class="sig-name">${asmanUser.name||"....................."}</div></div>
</div>
</div></body></html>`;
}

// ─── TUG-5 (ULTG) DOCUMENT BUILDER — 1 penandatangan (Manager ULTG), tanda tangan
// digital otomatis terisi nama+waktu approve (bukan gambar, konsisten dengan
// seluruh dokumen TUG lain di app yang juga pakai nama teks, bukan gambar ttd).
export function buildTUG5ULTGHTML(txn, katalogList, users, ultgList) {
  const docs = txn.docNumbers;
  const ultg = (ultgList||[]).find(u=>u.id===txn.ultgId)||{};
  const mgrUltgUser = users.find(u=>u.id===txn.approvedByMgrUltg) || users.find(u=>u.role==="MGR_ULTG" && u.ultgId===txn.ultgId) || {};
  const isApproved = !!txn.approvedByMgrUltg;
  const tanggalApprove = txn.approvedAtMgrUltg ? fmtDate(txn.approvedAtMgrUltg) : "";

  const itemRows = (txn.stockItems||[]).map((si)=>{
    const kat = (katalogList||[]).find(k=>k.id===si.katalogId)||{};
    return `<tr>
      <td>${kat.name||"-"}</td>
      <td style="text-align:center">${kat.katalog||"-"}</td>
      <td style="text-align:center">${kat.satuan||"-"}</td>
      <td style="text-align:center">${fmtNum(si.sisaPersediaan||0)}</td>
      <td style="text-align:center">${fmtNum(si.permintaan||0)}</td>
      <td>${si.keterangan||""}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TUG-5 ULTG ${txn.id}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:10px;color:#111;background:#e5e7eb}.page{padding:24px;background:white;max-width:1000px;margin:0 auto 16px;min-height:100vh}.topbar{height:5px;background:linear-gradient(90deg,#00377a,#0098da);margin-bottom:4px}.doctitle{text-align:center;margin-bottom:10px}.doctitle h2{font-size:13px;font-weight:800;text-decoration:underline}.doctitle .docno{font-size:10px;font-style:italic;color:#0098da}table.meta{width:100%;margin-bottom:10px}table.meta td{padding:3px 4px;font-size:10px}table.meta td.label{width:110px}table.meta td.colon{width:8px}table.items{width:100%;border-collapse:collapse;margin-bottom:10px}table.items th{background:#003087;color:white;padding:6px 6px;font-size:9.5px;text-align:center;border:1px solid #ccc}table.items td{padding:6px 6px;border:1px solid #ccc;font-size:10px}.sig-row{display:flex;justify-content:center;margin-top:24px;text-align:center}.sig-col{width:280px;font-size:10px}.sig-space{height:40px;display:flex;align-items:center;justify-content:center}.sig-name{font-weight:700;text-decoration:underline;margin-top:2px}.digital-stamp{border:2px solid #16a34a;color:#16a34a;border-radius:6px;padding:6px 10px;font-size:9px;font-weight:700;display:inline-block;transform:rotate(-4deg)}.print-bar{position:sticky;top:0;background:#003087;color:white;padding:8px 14px;text-align:center;font-size:12px;font-weight:700;z-index:10}.print-bar button{background:#16a34a;color:white;border:none;border-radius:6px;padding:6px 16px;font-size:12px;cursor:pointer;margin-left:10px}@media print{.print-bar{display:none}body{background:white}}</style></head><body>
<div class="print-bar">📄 TUG-5 ULTG siap cetak <button onclick="window.print()">🖨️ Print / Save as PDF</button></div>
<div class="page">
<div class="topbar"></div>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
  <div><b>PT PLN (PERSERO)</b><br/>${ultg.nama||"ULTG"}</div>
  <div style="font-weight:800;font-size:14px">TUG - 5</div>
</div>
<div class="doctitle"><h2>DAFTAR PERMINTAAN BARANG - BARANG (ULTG)</h2><div class="docno">${docs?.tug5||txn.id}</div></div>
<table class="meta" style="border:1px solid #ccc;padding:6px;border-radius:4px;margin-bottom:10px">
  <tr><td class="label">Diajukan oleh</td><td class="colon">:</td><td>${ultg.nama||"-"} (${ultg.kode||"-"})</td></tr>
  <tr><td class="label">Nama Pekerjaan</td><td class="colon">:</td><td>${txn.namaPekerjaan||"-"}</td></tr>
  <tr><td class="label">Lokasi Pekerjaan</td><td class="colon">:</td><td>${txn.lokasiPekerjaan||"-"}</td></tr>
</table>
<table class="items">
  <thead><tr>
    <th style="width:26%">Nama Barang</th>
    <th>Nomor Normalisasi</th>
    <th>Satuan</th>
    <th>Sisa Persediaan<br/>(Stok Aktual UPT)</th>
    <th>Jumlah Permintaan</th>
    <th>Keterangan</th>
  </tr></thead>
  <tbody>${itemRows}</tbody>
</table>
<div style="text-align:right;font-size:10px;margin-bottom:14px">${tanggalApprove||fmtDate(txn.createdAt)}</div>
<div class="sig-row">
  <div class="sig-col">
    <b>MANAGER ULTG${ultg.nama?" — "+ultg.nama.toUpperCase().replace(/^ULTG\s+/,""):""}</b>
    <div class="sig-space">${isApproved?`<div class="digital-stamp">✓ DISETUJUI SECARA DIGITAL<br/>${tanggalApprove}</div>`:""}</div>
    <div class="sig-name">${mgrUltgUser.name||"....................."}</div>
  </div>
</div>
</div></body></html>`;
}

// ─── TUG-7 DOCUMENT BUILDER ─────────────────────────────────────────────
export function buildTUG7HTML(txn, katalogList, uitList, uptList, users) {
  const docs = txn.docNumbers;
  const mgrLogistikUser = users.find(u=>u.role==="MGR_LOGISTIK_UIT")||{};
  const uit = (uitList||[]).find(u=>u.id===txn.uitId)||{};
  const uptPengirim = (uptList||[]).find(u=>u.id===txn.uptPengirimId)||{};
  const tanggal = fmtDateOnly(txn.approvedAtMgrLogistik||txn.createdAt);

  const itemRows = (txn.stockItems||[]).map((si,idx)=>{
    const kat = (katalogList||[]).find(k=>k.id===si.katalogId)||{};
    return `<tr>
      <td style="text-align:center">${idx+1}</td>
      <td>${kat.name||"-"}</td>
      <td style="text-align:center">${kat.katalog||"-"}</td>
      <td style="text-align:center">${kat.satuan||"-"}</td>
      <td style="text-align:center">${fmtNum(si.qty||si.permintaan||0)}</td>
      <td style="text-align:right"></td>
      <td style="text-align:right"></td>
      <td>${si.keterangan||""}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TUG-7 ${txn.id}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:10.5px;color:#111;background:#e5e7eb}.page{padding:28px;background:white;max-width:850px;margin:0 auto 16px;min-height:100vh}table.meta{width:100%;margin-bottom:10px}table.meta td{padding:3px 4px;font-size:10.5px}table.meta td.label{width:100px}table.meta td.colon{width:10px}table.items{width:100%;border-collapse:collapse;margin-bottom:10px}table.items th{background:#003087;color:white;padding:6px 6px;font-size:10px;text-align:center;border:1px solid #ccc}table.items td{padding:6px 6px;border:1px solid #ccc;font-size:10px}.sig-row{display:flex;justify-content:flex-end;margin-top:20px;text-align:center}.sig-col{width:250px;font-size:10px}.sig-space{height:55px}.sig-name{font-weight:700;text-decoration:underline;margin-top:2px}.print-bar{position:sticky;top:0;background:#003087;color:white;padding:8px 14px;text-align:center;font-size:12px;font-weight:700;z-index:10}.print-bar button{background:#16a34a;color:white;border:none;border-radius:6px;padding:6px 16px;font-size:12px;cursor:pointer;margin-left:10px}@media print{.print-bar{display:none}body{background:white}}</style></head><body>
<div class="print-bar">📄 TUG-7 siap cetak <button onclick="window.print()">🖨️ Print / Save as PDF</button></div>
<div class="page">
<div style="display:flex;justify-content:space-between;margin-bottom:14px">
  <div><b>PT PLN (PERSERO)</b><br/>${uit.nama||UIT}</div>
  <div style="font-weight:800;font-size:14px">TUG 7</div>
</div>
<div style="text-align:right;margin-bottom:8px">${uptPengirim.alamat?uptPengirim.alamat+", ":""} ${tanggal}</div>
<div style="text-align:center;margin-bottom:12px">
  <div style="font-weight:800;font-size:13px;text-decoration:underline">PERINTAH PENYERAHAN BARANG</div>
  <div style="font-size:11px;color:#555">DELIVERY ORDER</div>
  <div style="font-size:10px;font-style:italic;color:#0098da;margin-top:2px">No. : ${docs?.tug7||txn.id}</div>
</div>
<table class="meta" style="border:1px solid #ccc;border-radius:4px;padding:8px;margin-bottom:14px">
  <tr><td class="label">Kepada</td><td class="colon">:</td><td>Gudang PLTD PT PLN (Persero) ${uptPengirim.nama||"-"}</td></tr>
  <tr><td class="label">Untuk</td><td class="colon">:</td><td>PT PLN (Persero) ${uit.kode||"UIT-JBM"} UPT ${txn.unitPenerima||"Surabaya"}</td></tr>
  <tr><td class="label">Berdasarkan</td><td class="colon">:</td><td>${txn.tug5DocNo||"-"}</td></tr>
  <tr><td class="label">Atas beban rekening</td><td class="colon">:</td><td>${txn.atasBebanRekening||"-"}</td></tr>
</table>
<p style="font-size:10px;margin-bottom:10px">Dengan penyerahan lembar asli dari pada Perintah penyerahan ini harap menyerahkan/mengirimkan dari persediaan gudang ke alamat tersebut diatas, barang-barang/Spare parts sbb :</p>
<table class="items">
  <thead><tr><th>No.<br/>Urut</th><th style="width:30%">Nama barang/Spare part</th><th>Nomor Norm./part</th><th>Stn.</th><th>Banyaknya</th><th colspan="2">Harga</th><th>Keterangan</th></tr>
  <tr style="background:#1a3a6b"><th></th><th></th><th></th><th></th><th></th><th style="color:white;font-size:9px">Stn.</th><th style="color:white;font-size:9px">Jumlah</th><th></th></tr></thead>
  <tbody>${itemRows}</tbody>
</table>
<table class="meta">
  <tr><td class="label">Perintah Kerja</td><td class="colon">:</td><td>${txn.perintahKerja||""}</td><td style="width:60px">Kode Akun</td><td class="colon">:</td><td>${txn.kodeAkun||""}</td><td style="width:50px">Fungsi</td><td class="colon">:</td><td>${txn.fungsi||""}</td></tr>
</table>
<div class="sig-row">
  <div class="sig-col">
    <b>MANAJER MANAJEMEN MATERIAL &amp; LOGISTIK</b>
    <div class="sig-space"></div>
    <div class="sig-name">${mgrLogistikUser.name||"....................."}</div>
  </div>
</div>
</div></body></html>`;
}

export function downloadTUG5HTML(txn, katalogList, uitList, users, showToast, ultgList) {
  const html = buildTUG5HTML(txn, katalogList, uitList, users, ultgList);
  const blob = new Blob([html], {type:"text/html"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `TUG5_${txn.docSeq}_${(txn.keteranganUmum||"").replace(/[^a-zA-Z0-9]/g,"_").slice(0,25)}.html`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  showToast && showToast("📄 File diunduh! Buka di browser lalu Print → Save as PDF.", "success");
}

// ─── PEMINJAMAN ALAT BERAT DOCUMENT BUILDER ─────────────────────────────
export function buildHeavyEquipmentLoanHTML(loan, equipment, users) {
  const ownerUpt = getHeavyEquipmentLoanOwnerUpt(loan);
  const requesterUpt = getHeavyEquipmentLoanRequesterUpt(loan);
  const pemohon = (users||[]).find(u=>u.id===loan.requestedBy) || {};
  const asmanUser = (users||[]).find(u=>u.id===loan.approvedBy) || {};
  const isApproved = !!loan.approvedBy;
  const tanggalApprove = loan.approvedAt ? fmtDate(loan.approvedAt) : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Peminjaman Alat Berat ${loan.id}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:10.5px;color:#111;background:#e5e7eb}.page{padding:28px;background:white;max-width:850px;margin:0 auto 16px;min-height:100vh}.topbar{height:5px;background:linear-gradient(90deg,#00377a,#0098da);margin-bottom:4px}.doctitle{text-align:center;margin-bottom:14px}.doctitle h2{font-size:14px;font-weight:800;text-decoration:underline}.doctitle .docno{font-size:10px;font-style:italic;color:#0098da;margin-top:2px}table.meta{width:100%;margin-bottom:14px;border:1px solid #ccc;border-radius:4px;padding:8px}table.meta td{padding:4px 6px;font-size:10.5px}table.meta td.label{width:150px}table.meta td.colon{width:10px}.sig-row{display:flex;justify-content:space-around;margin-top:30px;text-align:center}.sig-col{width:250px;font-size:10px}.sig-space{height:50px;display:flex;align-items:center;justify-content:center}.sig-name{font-weight:700;text-decoration:underline;margin-top:2px}.digital-stamp{border:2px solid #16a34a;color:#16a34a;border-radius:6px;padding:6px 10px;font-size:9px;font-weight:700;display:inline-block;transform:rotate(-4deg)}.print-bar{position:sticky;top:0;background:#003087;color:white;padding:8px 14px;text-align:center;font-size:12px;font-weight:700;z-index:10}.print-bar button{background:#16a34a;color:white;border:none;border-radius:6px;padding:6px 16px;font-size:12px;cursor:pointer;margin-left:10px}@media print{.print-bar{display:none}body{background:white}}</style></head><body>
<div class="print-bar">📄 Dokumen Peminjaman Alat Berat siap cetak <button onclick="window.print()">🖨️ Print / Save as PDF</button></div>
<div class="page">
<div class="topbar"></div>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
  <div><b>PT PLN (PERSERO)</b><br/>UPT ${ownerUpt||"-"}</div>
  <div style="font-weight:800;font-size:13px">SURAT PEMINJAMAN<br/>ALAT BERAT</div>
</div>
<div class="doctitle"><h2>BERITA ACARA PEMINJAMAN ALAT BERAT / ANGKAT-ANGKUT</h2><div class="docno">${loan.id}</div></div>
<table class="meta">
  <tr><td class="label">Nama Alat</td><td class="colon">:</td><td>${equipment?.nama||"-"} (${equipment?.merkType||"-"}, ${equipment?.kapasitas||"-"})</td></tr>
  <tr><td class="label">Nomor Seri / Aset</td><td class="colon">:</td><td>${equipment?.nomorSeri||loan.equipmentId||"-"}</td></tr>
  <tr><td class="label">UPT Pemilik Alat</td><td class="colon">:</td><td>UPT ${ownerUpt||"-"} — ${equipment?.lokasi||"-"}</td></tr>
  <tr><td class="label">UPT Peminjam</td><td class="colon">:</td><td>UPT ${requesterUpt||"-"}</td></tr>
  <tr><td class="label">Nama Pekerjaan</td><td class="colon">:</td><td>${loan.namaPekerjaan||"-"}</td></tr>
  <tr><td class="label">Keperluan</td><td class="colon">:</td><td>${loan.keperluan||"-"}</td></tr>
  <tr><td class="label">Tanggal Peminjaman</td><td class="colon">:</td><td>${loan.tanggalAmbil||"-"} s/d ${loan.tanggalKembali||"-"}</td></tr>
  <tr><td class="label">Diajukan oleh</td><td class="colon">:</td><td>${pemohon.name||"-"}${loan.catatan?` • Catatan: ${loan.catatan}`:""}</td></tr>
</table>
<p style="font-size:10px;margin-bottom:20px">Dokumen ini menjadi bukti persetujuan peminjaman alat berat/angkat-angkut antar UPT sebagaimana rincian di atas. Alat wajib dikembalikan dalam kondisi baik selambat-lambatnya pada tanggal yang tercantum.</p>
<div class="sig-row">
  <div class="sig-col">
    <b>ASMAN KONSTRUKSI<br/>UPT ${ownerUpt||"-"} (Pemilik Alat)</b>
    <div class="sig-space">${isApproved?`<div class="digital-stamp">✓ DISETUJUI SECARA DIGITAL<br/>${tanggalApprove}</div>`:""}</div>
    <div class="sig-name">${asmanUser.name||"....................."}</div>
  </div>
  <div class="sig-col">
    <b>PEMOHON<br/>UPT ${requesterUpt||"-"}</b>
    <div class="sig-space"></div>
    <div class="sig-name">${pemohon.name||"....................."}</div>
  </div>
</div>
</div></body></html>`;
}

export function downloadHeavyEquipmentLoanHTML(loan, equipment, users, showToast) {
  const html = buildHeavyEquipmentLoanHTML(loan, equipment, users);
  const blob = new Blob([html], {type:"text/html"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `PeminjamanAlat_${loan.id}.html`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  showToast && showToast("📄 File diunduh! Buka di browser lalu Print → Save as PDF.", "success");
}

// ─── BERITA ACARA STOCK OPNAME DOCUMENT BUILDER ──────────────────────────
// Dipanggil downloadBeritaAcara() di StockOpnameTab. Sebelumnya tombol "Download
// Berita Acara" pasti crash karena fungsi ini belum pernah dibuat (bug lama).
export function buildBeritaAcaraHTML(opn, katalogList, users) {
  const items = opn.items || [];
  const creator = (users||[]).find(u=>u.id===opn.dibuatOleh) || {};
  const asmanUser = (users||[]).find(u=>u.id===opn.approvedByAsman) || {};
  const mgrUser = (users||[]).find(u=>u.id===opn.approvedByManager) || {};
  const fmt = (v) => (v===null||v===undefined||v==="") ? "-" : v;

  const statusLabel = (s) => ({
    SESUAI: "Sesuai",
    TIDAK_ADA_DI_SAP: "Tidak ada di SAP",
    TIDAK_ADA_DI_SISTEM: "Tidak terdaftar",
  }[s] || s || "-");

  const itemRows = items.map((it, idx) => `
    <tr>
      <td style="text-align:center">${idx+1}</td>
      <td>${fmt(it.namaBarang)}</td>
      <td style="text-align:center">${fmt(it.noKatalog)}</td>
      <td style="text-align:center">${fmt(it.satuan)}</td>
      <td style="text-align:center">${fmt(it.qtySistem)}</td>
      <td style="text-align:center">${it.qtySAP===null||it.qtySAP===undefined?"-":it.qtySAP}</td>
      <td style="text-align:center">${fmt(it.qtsFisik)}</td>
      <td style="text-align:center">${fmt(it.selisih)}</td>
      <td style="text-align:center">${statusLabel(it.statusItem)}</td>
      <td>${fmt(it.keterangan)}</td>
    </tr>`).join("");

  const total = items.length;
  const akurat = items.filter(i=>Number(i.selisih)===0).length;
  const selisihCount = items.filter(i=>Number(i.selisih)!==0).length;
  const belumTerdaftar = items.filter(i=>i.statusItem==="TIDAK_ADA_DI_SISTEM").length;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Berita Acara Opname ${opn.id}</title>
<style>@page{size:A4 landscape;margin:8mm}*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:9.5px;color:#111;background:#e5e7eb}.page{padding:20px;background:white;max-width:1120px;margin:0 auto 16px}.topbar{height:5px;background:linear-gradient(90deg,#00377a,#0098da);margin-bottom:4px}.doctitle{text-align:center;margin-bottom:12px}.doctitle h2{font-size:14px;font-weight:800;text-decoration:underline}.doctitle .docno{font-size:10px;font-style:italic;color:#0098da;margin-top:2px}table.meta{width:100%;margin-bottom:12px;border:1px solid #ccc;border-radius:4px;padding:8px}table.meta td{padding:3px 6px;font-size:9.5px}table.meta td.label{width:150px}table.meta td.colon{width:10px}.kpi{display:flex;gap:8px;margin-bottom:10px}.kpi .box{flex:1;border:1px solid #ccc;border-radius:4px;padding:6px;text-align:center}.kpi .box .n{font-size:15px;font-weight:800;color:#00377a}.kpi .box .l{font-size:8.5px;color:#555;margin-top:2px}table.items{width:100%;border-collapse:collapse;margin-bottom:12px;table-layout:fixed}table.items th{background:#003087;color:white;padding:5px 4px;font-size:9px;text-align:center;border:1px solid #ccc}table.items td{padding:4px 4px;border:1px solid #ccc;font-size:9px;word-wrap:break-word}table.items col.c-no{width:32px}table.items col.c-nama{width:auto}table.items col.c-kat{width:90px}table.items col.c-stn{width:42px}table.items col.c-num{width:56px}table.items col.c-status{width:90px}.sig-row{display:flex;justify-content:space-around;margin-top:24px;text-align:center}.sig-col{width:200px;font-size:9.5px}.sig-space{height:50px}.sig-name{font-weight:700;text-decoration:underline;margin-top:2px}.print-bar{position:sticky;top:0;background:#003087;color:white;padding:8px 14px;text-align:center;font-size:12px;font-weight:700;z-index:10}.print-bar button{background:#16a34a;color:white;border:none;border-radius:6px;padding:6px 16px;font-size:12px;cursor:pointer;margin-left:10px}@media print{.print-bar{display:none}body{background:white}.page{max-width:none;margin:0;padding:0}table.items thead{display:table-header-group}table.items tr{page-break-inside:avoid}.sig-row{page-break-inside:avoid}}</style></head><body>
<div class="print-bar">📄 Berita Acara Stock Opname — A4 Landscape &nbsp; <button onclick="window.print()">🖨️ Print / Save as PDF</button></div>
<div class="page">
<div class="topbar"></div>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
  <div><b>PT PLN (PERSERO)</b><br/>UPT ${(creator.upt||"Surabaya")}</div>
  <div style="font-weight:800;font-size:13px">BERITA ACARA<br/>STOCK OPNAME</div>
</div>
<div class="doctitle"><h2>BERITA ACARA STOCK OPNAME (${opn.jenisAlur})</h2><div class="docno">No. : ${opn.id}</div></div>
<table class="meta">
  <tr><td class="label">Semester</td><td class="colon">:</td><td>${fmt(opn.semester)}</td></tr>
  <tr><td class="label">Jenis Opname</td><td class="colon">:</td><td>${fmt(opn.jenisAlur)} (${fmt(opn.kategori)})</td></tr>
  <tr><td class="label">Tanggal Pelaksanaan</td><td class="colon">:</td><td>${fmtDate(opn.dibuatAt)}</td></tr>
  <tr><td class="label">Tanggal Submit</td><td class="colon">:</td><td>${fmtDate(opn.submittedAt)}</td></tr>
  <tr><td class="label">Approval Asman</td><td class="colon">:</td><td>${fmtDate(opn.approvedAtAsman)}${opn.catatanAsman?` • ${opn.catatanAsman}`:""}</td></tr>
  <tr><td class="label">Approval Manager</td><td class="colon">:</td><td>${fmtDate(opn.approvedAtManager)}${opn.catatanManager?` • ${opn.catatanManager}`:""}</td></tr>
</table>
<div class="kpi">
  <div class="box"><div class="n">${total}</div><div class="l">Total Item</div></div>
  <div class="box"><div class="n">${akurat}</div><div class="l">Sesuai</div></div>
  <div class="box"><div class="n">${selisihCount}</div><div class="l">Selisih</div></div>
  <div class="box"><div class="n">${belumTerdaftar}</div><div class="l">Belum Terdaftar</div></div>
</div>
<p style="font-size:10px;margin-bottom:8px">Pada hari/tanggal tersebut di atas telah dilakukan pencatatan persediaan material ${opn.jenisAlur} secara fisik, dengan rincian sebagai berikut:</p>
<table class="items">
  <colgroup><col class="c-no"><col class="c-nama"><col class="c-kat"><col class="c-stn"><col class="c-num"><col class="c-num"><col class="c-num"><col class="c-num"><col class="c-status"><col class="c-nama"></colgroup>
  <thead><tr><th>No.</th><th>Nama Barang</th><th>No. Katalog</th><th>Stn.</th><th>Qty Sistem</th><th>Qty SAP</th><th>Qty Fisik</th><th>Selisih</th><th>Status</th><th>Keterangan</th></tr></thead>
  <tbody>${itemRows}</tbody>
</table>
<p style="font-size:10px;margin-bottom:20px">Demikian berita acara ini dibuat dengan sebenar-benarnya, menjadi bukti hasil pencatatan fisik yang telah disetujui pada tingkat Asman dan Manager.</p>
<div class="sig-row">
  <div class="sig-col">
    <b>PELAKSANA OPNAME</b>
    <div class="sig-space"></div>
    <div class="sig-name">${creator.name||"....................."}</div>
  </div>
  <div class="sig-col">
    <b>ASMAN KONSTRUKSI</b>
    <div class="sig-space"></div>
    <div class="sig-name">${asmanUser.name||"....................."}</div>
  </div>
  <div class="sig-col">
    <b>MANAGER</b>
    <div class="sig-space"></div>
    <div class="sig-name">${mgrUser.name||"....................."}</div>
  </div>
</div>
</div></body></html>`;
}

export function downloadTUG7HTML(txn, katalogList, uitList, uptList, users, showToast) {
  const html = buildTUG7HTML(txn, katalogList, uitList, uptList, users);
  const blob = new Blob([html], {type:"text/html"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `TUG7_${txn.docSeq}_${txn.id}.html`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  showToast && showToast("📄 File diunduh! Buka di browser lalu Print → Save as PDF.", "success");
}

export function buildTUG3HTML(txn, katalogList, lokasiList, timMutuList, users) {
  const docs = txn.docNumbers;
  const tlUser = users.find(u=>u.id===txn.approvedByTL) || {};
  const mgrUser = users.find(u=>u.id===txn.approvedByManager) || {};
  const asmanUser = users.find(u => u.role === "ASMAN") || {};
  const tm = (timMutuList||[]).find(t=>t.id===txn.timMutuId) || {};

  function itemRow(si, withHarga) {
    const namaBarang = si.katalogMode==="existing" ? ((katalogList||[]).find(k=>k.id===si.katalogId)?.name||"-") : si.namaBaru;
    const katKode = si.katalogMode==="existing" ? ((katalogList||[]).find(k=>k.id===si.katalogId)?.katalog||"-") : (si.katalogBaru||"-");
    const satuan = si.katalogMode==="existing" ? ((katalogList||[]).find(k=>k.id===si.katalogId)?.satuan||"-") : (si.satuanBaru||"-");
    if (withHarga) {
      const jumlahHarga = (si.qty||0)*(si.harga||0);
      return `<tr><td>${namaBarang}</td><td style="text-align:center">${katKode}</td><td style="text-align:center">${satuan}</td><td style="text-align:center">${fmtNum(si.qty)}</td><td>Pengadaan ${txn.dariSupplier||""}</td><td style="text-align:right">Rp ${fmtNum(si.harga||0)}</td><td style="text-align:right">Rp ${fmtNum(jumlahHarga)}</td></tr>`;
    }
    return `<tr><td>${namaBarang}</td><td style="text-align:center">${katKode}</td><td style="text-align:center">${fmtNum(si.qty)}</td><td style="text-align:center">${satuan}</td><td>Pengadaan ${txn.dariSupplier||""}</td></tr>`;
  }
  const totalHarga = txn.stockItems.reduce((a,si)=>a+(si.qty||0)*(si.harga||0),0);

  function photoCell(label, src) {
    return `<div class="photo-cell"><div class="photo-label">${label}</div>${src ? `<img src="${src}" alt="${label}"/>` : `<div class="photo-empty">Tidak ada foto</div>`}</div>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TUG-3 ${txn.id}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:10.5px;color:#111;background:#e5e7eb}
.page{padding:28px;page-break-after:always;min-height:100vh;background:white;max-width:794px;margin:0 auto 16px}
.page:last-child{page-break-after:auto;margin-bottom:0}
.topbar{height:6px;background:linear-gradient(90deg,#00377a,#0098da);margin-bottom:4px}
.doctitle{text-align:center;margin-bottom:4px}
.doctitle h2{font-size:14px;font-weight:800;letter-spacing:.5px}
.doctitle .docno{font-size:10px;font-style:italic;color:#0098da;font-weight:700}
table.meta{width:100%;margin-bottom:10px;font-size:10.5px}
table.meta td{padding:2px 4px;vertical-align:top}
table.meta td.label{width:150px;color:#333}
table.meta td.colon{width:10px}
table.items{width:100%;border-collapse:collapse;margin-bottom:10px}
table.items th{background:#003087;color:white;padding:6px 6px;font-size:9.5px;text-align:left}
table.items td{padding:6px 6px;border-bottom:1px solid #ddd;font-size:10px}
.sig-row{display:flex;justify-content:space-around;margin-top:18px;text-align:center}
.sig-col{flex:1;font-size:10px}
.sig-space{height:50px}
.sig-name{font-weight:700;text-decoration:underline;margin-top:2px}
.status-stamp{display:inline-block;border:2px solid #16a34a;color:#16a34a;font-weight:800;padding:4px 14px;border-radius:6px;font-size:11px;transform:rotate(-8deg);margin-bottom:8px}
.print-bar{position:sticky;top:0;background:#003087;color:white;padding:10px 16px;text-align:center;font-size:13px;font-weight:700;z-index:10}
.print-bar button{background:#16a34a;color:white;border:none;border-radius:6px;padding:8px 18px;font-size:13px;font-weight:700;cursor:pointer;margin-left:10px}
.photo-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
.photo-cell{border:1px solid #ccc;border-radius:6px;overflow:hidden}
.photo-label{background:#f1f5f9;padding:6px 10px;font-size:10px;font-weight:700;border-bottom:1px solid #ccc}
.photo-cell img{width:100%;height:160px;object-fit:cover;display:block}
.photo-empty{height:160px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:10px;font-style:italic;background:#fafafa}
.section-heading{font-weight:800;font-size:11.5px;margin:14px 0 8px;color:#003087}
.tim-table{width:100%;border-collapse:collapse;margin-bottom:14px}
.tim-table th,.tim-table td{border:1px solid #ccc;padding:6px 8px;font-size:10px}
.tim-table th{background:#f1f5f9}
@media print{.print-bar{display:none}.page{box-shadow:none;margin:0;max-width:none}body{background:white}}
</style></head><body>

<div class="print-bar">📄 Dokumen TUG-3/TUG-4 siap dicetak &nbsp; <button onclick="window.print()">🖨️ Print / Save as PDF</button></div>

<!-- ════════ PAGE 1: TUG-3 KARANTINA ════════ -->
<div class="page">
  <div class="topbar"></div>
  <div style="text-align:right;font-weight:800;font-size:13px;margin-bottom:6px">TUG.3<br/><span style="font-size:9px;font-weight:400">Lembar 3: GUDANG — TUG-3 KARANTINA</span></div>
  <div class="doctitle"><h2>BON PENERIMAAN BARANG-BARANG / SPARE PARTS</h2><div class="docno">${docs.tug3}</div></div>
  ${txn.approvedByTL ? `<div style="text-align:center"><span class="status-stamp">✓ KARANTINA DISETUJUI TL</span></div>` : ""}
  <table class="meta" style="border:1px solid #ccc;border-radius:4px;padding:6px;margin-bottom:10px">
    <tr><td class="label">Diterima Tanggal</td><td class="colon">:</td><td>${txn.tanggalDiterima||"-"}</td><td class="label" style="width:130px">No. Surat Jalan</td><td>: ${txn.noSuratJalan||"-"} Tgl. ${txn.tglSuratJalan||"-"}</td></tr>
    <tr><td class="label">Dari</td><td class="colon">:</td><td>${txn.dariSupplier||"-"}</td><td class="label">No. SPK</td><td>: ${txn.noSpk||"-"} Tgl. ${txn.tglSpk||"-"}</td></tr>
    <tr><td class="label">Dengan</td><td class="colon">:</td><td>${txn.denganKirim||"-"}</td><td class="label">Amandemen/Kontrak</td><td>: ${txn.noAmandemen||"-"}</td></tr>
    <tr><td class="label">Biaya Angkutan</td><td class="colon">:</td><td>Rp ${fmtNum(txn.biayaAngkutan||0)}</td><td class="label">No. Faktur</td><td>: ${txn.noFaktur||"-"} Tgl. ${txn.tglFaktur||"-"}</td></tr>
  </table>
  <table class="items">
    <thead><tr><th>Nama Barang/Spare Part</th><th>Kode Katalog</th><th>Sat</th><th>Jumlah</th><th>Keterangan</th><th>Harga Satuan</th><th>Jumlah</th></tr></thead>
    <tbody>${txn.stockItems.map(si=>itemRow(si,true)).join("")}</tbody>
  </table>
  <table class="meta" style="border:1px solid #ccc;border-radius:4px;padding:6px;margin-bottom:10px">
    <tr><td class="label">Nota No.</td><td class="colon">:</td><td>${txn.notaNo||"-"}</td><td class="label">Kode Perkiraan</td><td>: ${txn.kodePerkiraan||"-"}</td></tr>
    <tr><td class="label">Perintah Kerja</td><td class="colon">:</td><td>${txn.perintahKerja||"-"}</td><td class="label">Fungsi</td><td>: ${txn.fungsi||"-"}</td></tr>
    <tr><td class="label">Jumlah</td><td class="colon">:</td><td colspan="3">Rp ${fmtNum(totalHarga)}</td></tr>
  </table>
  <div style="margin-bottom:10px"><b>Keterangan:</b> ${txn.keteranganTug3||"-"}</div>
  <div class="sig-row">
    <div class="sig-col">Diperiksa oleh,<br>Asisten Manager Konstruksi<div class="sig-space"></div><div class="sig-name">${asmanUser.name||"....................."}</div></div>
    <div class="sig-col">TL Logistik<div class="sig-space"></div><div class="sig-name">${tlUser.name||"....................."}</div></div>
  </div>
</div>

<!-- ════════ PAGE 2: TUG-4 BERITA ACARA PEMERIKSAAN ════════ -->
<div class="page">
  <div class="topbar"></div>
  <div style="text-align:right;font-weight:800;font-size:13px;margin-bottom:6px">TUG.4</div>
  <div class="doctitle"><h2>BERITA ACARA PEMERIKSAAN BARANG/SPARE PARTS</h2><div class="docno">${docs.tug4}</div></div>
  ${txn.approvedByManager ? `<div style="text-align:center"><span class="status-stamp">✓ DISETUJUI MANAGER</span></div>` : ""}
  <p style="margin-bottom:10px">Para pemeriksa terdiri dari (${tm.label||"-"}):</p>
  <table class="tim-table">
    <thead><tr><th>NO</th><th>NAMA</th><th>SATUAN ADMINISTRASI</th><th>TANDA TANGAN</th></tr></thead>
    <tbody>
      <tr><td>1</td><td>${tm.ketua||"-"}</td><td>KETUA</td><td></td></tr>
      <tr><td>2</td><td>${tm.sekretaris||"-"}</td><td>SEKRETARIS</td><td></td></tr>
      <tr><td>3</td><td>${tm.anggota1||"-"}</td><td>ANGGOTA</td><td></td></tr>
      <tr><td>4</td><td>${tm.anggota2||"-"}</td><td>ANGGOTA</td><td></td></tr>
      <tr><td>5</td><td>${tm.anggota3||"-"}</td><td>ANGGOTA</td><td></td></tr>
    </tbody>
  </table>
  <table class="meta" style="border:1px solid #ccc;border-radius:4px;padding:6px;margin-bottom:10px">
    <tr><td class="label">Lokasi Penyerahan</td><td class="colon">:</td><td>${txn.lokasiPenyerahan||"-"}</td><td class="label">No SPK</td><td>: ${txn.noSpk||"-"}</td></tr>
    <tr><td class="label">Diterima Dari</td><td class="colon">:</td><td>${txn.dariSupplier||"-"}</td><td class="label">Tanggal</td><td>: ${txn.tglSpk||"-"}</td></tr>
    <tr><td class="label">Tanggal Penerimaan</td><td class="colon">:</td><td>${txn.tanggalDiterima||"-"}</td><td class="label">No Surat Jalan</td><td>: ${txn.noSuratJalan||"-"}</td></tr>
  </table>
  <div style="margin-bottom:10px"><b>Dan menyatakan bahwa:</b> ${txn.hasilPemeriksaan||"-"}</div>
  <table class="items">
    <thead><tr><th>Nama Barang/Spare Part</th><th>Kode Katalog</th><th>Banyaknya</th><th>Satuan</th><th>Catatan</th></tr></thead>
    <tbody>${txn.stockItems.map(si=>itemRow(si,false)).join("")}</tbody>
  </table>
  <table class="meta" style="margin-bottom:14px">
    <tr><td class="label">Kode Perkiraan</td><td class="colon">:</td><td>${txn.kodePerkiraan||"-"}</td><td class="label">Perintah Kerja</td><td>: ${txn.perintahKerja||"-"}</td><td class="label">Fungsi</td><td>: ${txn.fungsi||"-"}</td></tr>
  </table>
  <p style="margin-bottom:20px">Spesifikasi, hasil uji dan jumlah sesuai klausul kontrak dan dapat diterima oleh PENGGUNA BARANG</p>
  <div style="text-align:center">
    <div>PT PLN (PERSERO) UIT - JBM</div>
    <div>Unit Pelaksana Transmisi Surabaya</div>
    <div style="font-weight:700;margin-top:4px">MANAGER</div>
    <div class="sig-space"></div>
    <div class="sig-name">${mgrUser.name||"....................."}</div>
  </div>
</div>

<!-- ════════ PAGE 3: LAMPIRAN FOTO FINAL ════════ -->
<div class="page">
  <div class="topbar"></div>
  <div class="doctitle"><h2>LAMPIRAN FOTO — TUG-3 FINAL</h2><div class="docno">${docs.tug3}</div></div>
  ${txn.approvedByAsman ? `<div style="text-align:center"><span class="status-stamp">✓ DISETUJUI ASMAN — STOK MASUK</span></div>` : ""}
  <div class="section-heading">Foto Kendaraan &amp; SIM/KTP</div>
  <div class="photo-grid">${photoCell("Foto Kendaraan", txn.fotoKendaraan)}${photoCell("SIM / KTP", txn.fotoSimKtp)}</div>
  <div class="section-heading">Surat Jalan &amp; Kontrak</div>
  <div class="photo-grid">${photoCell("Surat Jalan", txn.fotoSuratJalanImg)}${photoCell("Foto Kontrak", txn.fotoKontrak)}</div>
</div>

</body></html>`;
}

export function downloadTUG3HTML(txn, katalogList, lokasiList, timMutuList, users, showToast) {
  const html = buildTUG3HTML(txn, katalogList, lokasiList, timMutuList, users);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `TUG3_${txn.docSeq}_${(txn.dariSupplier||"").replace(/[^a-zA-Z0-9]/g,"_").slice(0,30)}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast && showToast("📄 File diunduh! Buka di browser HP/laptop, lalu Print > Save as PDF.", "success");
}

export function downloadTUG9HTML(txn, stocks, users, satpamList, showToast) {
  const html = buildTUG9HTML(txn, stocks, users, satpamList);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${txn.docType}_${txn.docSeq}_${txn.namaPekerjaan.replace(/[^a-zA-Z0-9]/g,"_").slice(0,30)}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast && showToast("📄 File diunduh! Buka di browser HP/laptop, lalu Print > Save as PDF.", "success");
}
