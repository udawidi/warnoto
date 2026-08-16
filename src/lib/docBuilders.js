// Doc builders HTML (TUG-3/4/5/5ULTG/7/9/10 + Berita Acara Opname + Peminjaman
// Alat Berat) — dipindah dari App.jsx (refactor Fase 3b). Pure: terima data,
// kembalikan string HTML / buka window cetak. Tanpa React/state.
import { PLN_LOGO_DATA_URI } from "../assets/plnLogoBase64.js";
import QRCode from "qrcode";
import { fmtNum } from "./ragShared.mjs";
import { katalogSapLabel } from "./sap.js";
import { fmtDate, fmtDateOnly, fmtRp, generateDocNumbers, terbilangHari, scanUrlFor } from "./utils.js";
import { COMPANY, UIT, UPT, WAREHOUSE, DOC_CODE } from "../constants.js";
import { getHeavyEquipmentLoanOwnerUpt, getHeavyEquipmentLoanRequesterUpt } from "./heavyEquipment.js";
import { buildKartuGantungHistory, resolveLokasiLengkap } from "./sap.js";
import { resolveStockPhotoUrl } from "./stockCache.js";

// Resolver id->nama UPT penerbit dokumen (mis. "UPT-SBY" -> "UPT Surabaya").
// Dipakai di seluruh kop/PIC/sig-role dokumen supaya UPT selain Surabaya
// tidak lagi mencetak "UPT Surabaya" hardcoded.
function resolveUptNama(uptId, uptList, fallback) {
  return (uptList || []).find(u => u.id === uptId)?.nama || fallback || UPT;
}

// ─── TUG-9 DOCUMENT HTML BUILDER (Surat Jalan + Bon TUG-9 + Lampiran Foto) ────
// Returns a full standalone HTML string. Used for both in-app preview
// (rendered in an iframe inside a modal) and for downloading as a
// .html file the user can open in any browser and Print > Save as PDF.
export function buildTUG9HTML(txn, stocks, users, satpamList, uptList) {
  const docs = txn.docNumbers || {};
  const uptNama = resolveUptNama(txn.uptId, uptList);
  const isTUG8 = txn.docType === "TUG8";
  const docKey = isTUG8 ? "tug8" : "tug9";
  const creator = users.find(u=>u.id===txn.createdBy) || {};
  const actualApprover = users.find(u=>u.id===txn.approvedBy) || {};
  const asmanUser = txn.canonical
    ? (txn.status === "APPROVED" ? (users.find(u => u.id === txn.approvedBy && u.role === "ASMAN") || {}) : {})
    : (users.find(u => u.role === "ASMAN") || {});
  const snapshotTl = txn.identitySnapshot?.tl_name ? { name:txn.identitySnapshot.tl_name, officialPhone:txn.identitySnapshot.tl_phone, jabatan:txn.identitySnapshot.tl_jabatan } : null;
  const scopedTl = users.find(u => u.role === "TL" && (!txn.uptId || u.uptId === txn.uptId)) || {};
  const menyerahkanUser = snapshotTl || (actualApprover.role === "TL" ? actualApprover : scopedTl);
  const satpamUser = (satpamList||[]).find(sp => sp.id === txn.satpamId) || {};
  const itemRows = (txn.stockItems || []).map(si => {
    const stock = stocks.find(s=>s.id===si.stockId) || {};
    return { stock, qty: si.qty };
  });

  const dateInfo = (() => {
    const d = txn.createdAt ? new Date(txn.createdAt) : new Date();
    const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
    const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    return {
      hari: days[d.getDay()],
      tanggal: d.getDate(),
      bulan: months[d.getMonth()],
      tahun: d.getFullYear(),
      tanggalLengkap: fmtDateOnly(d.getTime())
    };
  })();

  const uptKode = (uptList || []).find(u => u.id === txn.uptId)?.kode || "UPT-SBY";
  const docNoSJ = docs.sj || `${txn.docSeq || "1"}.SJ/LOG.00.02/${uptKode}/VII/2026`;
  const docNoBA = docs.ba || docNoSJ.replace(".SJ/", ".BA/");

  const materialRowsTable = itemRows.map(({stock,qty}) => `
    <tr>
      <td>${stock.name || "-"}</td>
      <td style="text-align:center">${stock.lokasi || "GUDANG"}</td>
      <td style="text-align:center">${fmtNum(qty)}</td>
      <td style="text-align:center">${stock.unit || "-"}</td>
      <td>${stock.jenisBarang ? `(${stock.jenisBarang}) ` : ""}${txn.keteranganBarang || ""}</td>
    </tr>`).join("");

  const materialPhotoRowsTable = itemRows.map(({stock}) => {
    const photo = (txn.fotoMaterial||[]).find(fm => fm.stockId === stock.id);
    return `
      <tr>
        <td style="padding:10px;vertical-align:top;font-weight:bold;width:35%">${stock.name || "-"}</td>
        <td style="padding:10px;text-align:center">
          ${photo?.img ? `<img src="${photo.img}" style="max-height:220px;max-width:100%;object-fit:contain;border:1px solid #ccc;border-radius:4px" alt="Foto Barang"/>` : `<div style="color:#9ca3af;font-style:italic;padding:20px">&lt;&lt;[Foto Barang]&gt;&gt;</div>`}
        </td>
      </tr>`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${isTUG8?"TUG-8":"TUG-9"} ${txn.id}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#000;background:#e5e7eb}
.page{padding:20px;page-break-after:always;min-height:100vh;background:white;max-width:794px;margin:0 auto 16px;position:relative}
.page:last-child{page-break-after:auto;margin-bottom:0}
.top-accent{height:6px;background:linear-gradient(90deg,#007d9c 0%,#0098da 70%,#facc15 100%);margin-bottom:6px}
.bottom-accent{height:6px;background:linear-gradient(90deg,#007d9c 0%,#0098da 70%,#facc15 100%);margin-top:16px}
.header-kop{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px}
.pln-info{text-align:right}
.pln-logo{height:28px;width:auto;display:block;margin-left:auto;margin-bottom:2px}
.kop-text{font-size:8.5px;font-weight:bold;line-height:1.2;color:#000}
.kop-sub{font-size:8px;font-weight:bold;line-height:1.2;color:#333}

.section-box{border:1.5px solid #000;padding:12px;margin-bottom:14px;background:#fff}
.doctitle{text-align:center;font-size:13px;font-weight:bold;letter-spacing:0.5px;margin-bottom:2px;text-transform:uppercase}
.docno{text-align:center;font-size:10px;font-weight:bold;margin-bottom:10px}
.docno a{color:#003087;text-decoration:underline}

table.meta-tbl{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:9.5px}
table.meta-tbl td{padding:2px 4px;vertical-align:top}
table.meta-tbl td.lbl{width:140px;color:#111}

table.items-tbl{width:100%;border-collapse:collapse;margin-top:6px;margin-bottom:8px;border:1px solid #000}
table.items-tbl th{background:#d1d5db;color:#000;border:1px solid #000;padding:5px 4px;font-size:9.5px;font-weight:bold;text-align:center}
table.items-tbl td{border:1px solid #000;padding:5px 6px;font-size:9px}

.closing-note{font-size:9px;margin-top:6px;margin-bottom:10px;font-style:italic}
.bast-intro{font-size:9.5px;line-height:1.4;margin-bottom:6px}

.sig-row-3{display:flex;justify-content:space-between;margin-top:10px;text-align:center}
.sig-row-2{display:flex;justify-content:space-around;margin-top:10px;text-align:center}
.sig-col{flex:1;font-size:9.5px;padding:0 8px}
.sig-role{font-weight:bold;margin-top:2px}
.sig-space{height:45px}
.sig-name{font-weight:bold;text-transform:uppercase}

.print-bar{position:sticky;top:0;background:#003087;color:white;padding:10px 16px;text-align:center;font-size:13px;font-weight:700;z-index:100}
.print-bar button{background:#16a34a;color:white;border:none;border-radius:6px;padding:8px 18px;font-size:13px;font-weight:700;cursor:pointer;margin-left:10px}

.page-title-center{text-align:center;font-size:12px;font-weight:bold;margin-bottom:10px;margin-top:6px}
.photo-box-2col{border:1.5px solid #000;display:grid;grid-template-columns:1fr 1fr;min-height:500px}
.photo-col-cell{border-right:1px solid #000;padding:8px;display:flex;flex-direction:column;align-items:center}
.photo-col-cell:last-child{border-right:none}
.cell-title{font-size:11px;font-weight:bold;margin-bottom:8px;text-align:center}
.cell-img-wrap{flex:1;width:100%;display:flex;align-items:center;justify-content:center}
.cell-img-wrap img{max-width:100%;max-height:440px;object-fit:contain}
.photo-empty{color:#9ca3af;font-style:italic;font-size:10px;text-align:center}

.photo-box-full{border:1.5px solid #000;padding:12px;min-height:550px;display:flex;flex-direction:column;align-items:center}
.cell-img-wrap-large{flex:1;width:100%;display:flex;align-items:center;justify-content:center}
.cell-img-wrap-large img{max-width:100%;max-height:500px;object-fit:contain}

table.photo-items-tbl{width:100%;border-collapse:collapse;border:1.5px solid #000;margin-top:10px}
table.photo-items-tbl th{background:#d1d5db;border:1px solid #000;padding:6px;font-size:10px;font-weight:bold;text-align:center}
table.photo-items-tbl td{border:1px solid #000;padding:6px}

@media print{.print-bar{display:none}.page{box-shadow:none;margin:0;max-width:none;padding:15px}body{background:white}}
</style></head><body>

<div class="print-bar">📄 Dokumen TUG-9 / BAST-B siap dicetak &nbsp; <button onclick="window.print()">🖨️ Print / Save as PDF</button></div>

<!-- ════════ PAGE 1: SURAT JALAN & BAST-B ════════ -->
<div class="page">
  <div class="top-accent"></div>
  <div class="header-kop">
    <div></div>
    <div class="pln-info">
      <img class="pln-logo" src="${PLN_LOGO_DATA_URI}" alt="Logo PLN"/>
      <div class="kop-text">UNIT INDUK JAWA BAGIAN TIMUR &amp; BALI</div>
      <div class="kop-sub">UNIT PELAKSANA TRANSMISI ${uptNama.toUpperCase()}</div>
    </div>
  </div>

  <!-- BOX 1: SURAT JALAN PENGAMBILAN MATERIAL -->
  <div class="section-box">
    <div class="doctitle">SURAT JALAN PENGAMBILAN MATERIAL</div>
    <div class="docno">${docNoSJ}</div>

    <table class="meta-tbl">
      <tr>
        <td class="lbl">Dibawa Ke</td><td style="width:10px">:</td><td>${txn.lokasiPekerjaan || "-"}</td>
        <td class="lbl" style="width:140px">Kendaraan / Nopol</td><td style="width:10px">:</td><td>${txn.nopol || "-"}</td>
      </tr>
      <tr>
        <td class="lbl">Tanggal Pengambilan</td><td>:</td><td>${fmtDateOnly(txn.createdAt)}</td>
        <td class="lbl">No SIM / KTP Pengemudi</td><td>:</td><td>${txn.simKtp || "-"}</td>
      </tr>
      <tr>
        <td class="lbl">PIC Gudang ${uptNama}</td><td>:</td><td colspan="4">${creator.name || "-"}${creator.officialPhone ? ` (${creator.officialPhone})` : ""}</td>
      </tr>
    </table>

    <table class="items-tbl">
      <thead>
        <tr>
          <th style="width:30%">MATERIAL</th>
          <th style="width:15%">GUDANG</th>
          <th style="width:10%">JUMLAH</th>
          <th style="width:10%">SATUAN</th>
          <th style="width:35%">KETERANGAN</th>
        </tr>
      </thead>
      <tbody>${materialRowsTable}</tbody>
    </table>

    <div class="closing-note">Demikian Surat Jalan ini kami buat agar dipergunakan sebagaimana mestinya</div>

    <div class="sig-row-3">
      <div class="sig-col">
        <div><i>Transporter,</i></div>
        <div class="sig-role">PENGEMUDI</div>
        <div class="sig-space"></div>
        <div class="sig-name">${txn.namaPengemudi || "....................."}</div>
      </div>
      <div class="sig-col">
        <div><i>Mengetahui,</i></div>
        <div class="sig-role">SATPAM GUDANG ${(satpamUser.gudangNama || WAREHOUSE).toUpperCase()}</div>
        <div class="sig-space"></div>
        <div class="sig-name">${satpamUser.name || "....................."}</div>
      </div>
      <div class="sig-col">
        <div><i>Yang menyerahkan,</i></div>
        <div class="sig-role">ADMINISTRASI GUDANG</div>
        <div class="sig-space"></div>
        <div class="sig-name">${creator.name || "....................."}</div>
      </div>
    </div>
  </div>

  <!-- BOX 2: BERITA ACARA SERAH TERIMA BARANG (BAST-B) -->
  <div class="section-box">
    <div class="doctitle">BERITA ACARA SERAH TERIMA BARANG (BAST-B)</div>
    <div class="docno">${docNoBA}</div>

    <div class="bast-intro">
      Pada hari ini <b>${dateInfo.hari}</b> tanggal <b>${dateInfo.tanggal}</b> bulan <b>${dateInfo.bulan}</b> tahun <b>${dateInfo.tahun}</b> (${dateInfo.tanggalLengkap}), Kami yang bertanda di bawah ini :
    </div>

    <table class="meta-tbl" style="margin-bottom:4px">
      <tr><td class="lbl" style="width:70px">Nama</td><td style="width:10px">:</td><td>${menyerahkanUser.name || creator.name || "-"}</td></tr>
      <tr><td class="lbl">Jabatan</td><td>:</td><td>${menyerahkanUser.jabatan || `TL LOG ${uptNama.toUpperCase()}`}</td></tr>
      <tr><td class="lbl">Unit</td><td>:</td><td>${uptNama.toUpperCase()}</td></tr>
      <tr><td colspan="3" style="font-weight:bold;padding-top:2px;padding-bottom:4px">Untuk selanjutnya disebut <u>PIHAK YANG MENYERAHKAN</u></td></tr>
      <tr><td class="lbl">Nama</td><td>:</td><td>${txn.penerimaNama || "-"}</td></tr>
      <tr><td class="lbl">Jabatan</td><td>:</td><td>${txn.penerimaJabatan || "-"}</td></tr>
      <tr><td class="lbl">Unit</td><td>:</td><td>${txn.penerimaUnit || "-"}</td></tr>
      <tr><td colspan="3" style="font-weight:bold;padding-top:2px;padding-bottom:4px">Untuk selanjutnya disebut <u>PIHAK YANG MENERIMA</u></td></tr>
    </table>

    <div class="bast-intro" style="margin-bottom:4px">Telah melaksanakan serah terima barang, sesuai dengan data sebagai berikut :</div>

    <table class="items-tbl">
      <thead>
        <tr>
          <th style="width:30%">MATERIAL</th>
          <th style="width:15%">GUDANG</th>
          <th style="width:10%">JUMLAH</th>
          <th style="width:10%">SATUAN</th>
          <th style="width:35%">KETERANGAN</th>
        </tr>
      </thead>
      <tbody>${materialRowsTable}</tbody>
    </table>

    <table class="meta-tbl" style="margin-top:6px;margin-bottom:6px">
      <tr><td class="lbl" style="width:190px">Sesuai Nodin / Surat Permintaan No</td><td style="width:10px">:</td><td>${txn.noNodin || "-"}</td></tr>
      <tr><td class="lbl">Sesuai Surat Persetujuan No</td><td>:</td><td>${txn.noPersetujuan || "-"}</td></tr>
      <tr><td class="lbl">Untuk Pekerjaan</td><td>:</td><td>${txn.namaPekerjaan || txn.pekerjaan || "-"}</td></tr>
    </table>

    <div class="closing-note">Demikian Berita Acara ini kami buat agar dipergunakan sebagaimana mestinya</div>

    <div class="sig-row-2">
      <div class="sig-col">
        <div><i>Yang menerima,</i></div>
        <div class="sig-role">${(txn.penerimaUnit || "PIHAK YANG MENERIMA").toUpperCase()}</div>
        <div class="sig-space"></div>
        <div class="sig-name">${txn.penerimaNama || "....................."}</div>
      </div>
      <div class="sig-col">
        <div><i>Yang menyerahkan,</i></div>
        <div class="sig-role">${(menyerahkanUser.jabatan || `TL LOG ${uptNama.toUpperCase()}`).toUpperCase()}</div>
        <div class="sig-space"></div>
        <div class="sig-name">${menyerahkanUser.name || "....................."}</div>
      </div>
    </div>
  </div>

  <div class="bottom-accent"></div>
</div>

<!-- ════════ PAGE 2: LAMPIRAN FOTO KENDARAAN & SIM/KTP ════════ -->
<div class="page">
  <div class="top-accent"></div>
  <div class="header-kop">
    <div></div>
    <div class="pln-info">
      <img class="pln-logo" src="${PLN_LOGO_DATA_URI}" alt="Logo PLN"/>
      <div class="kop-text">UNIT INDUK JAWA BAGIAN TIMUR &amp; BALI</div>
      <div class="kop-sub">UNIT PELAKSANA TRANSMISI ${uptNama.toUpperCase()}</div>
    </div>
  </div>

  <div class="page-title-center">Lampiran Foto</div>

  <div class="photo-box-2col">
    <div class="photo-col-cell">
      <div class="cell-title">Foto Kendaraan</div>
      <div class="cell-img-wrap">
        ${txn.fotoKendaraan ? `<img src="${txn.fotoKendaraan}" alt="Foto Kendaraan"/>` : `<div class="photo-empty">&lt;&lt;[Foto Kendaraan pengangkut]&gt;&gt;</div>`}
      </div>
    </div>
    <div class="photo-col-cell">
      <div class="cell-title">SIM / KTP</div>
      <div class="cell-img-wrap">
        ${txn.fotoSimKtp ? `<img src="${txn.fotoSimKtp}" alt="Foto SIM/KTP"/>` : `<div class="photo-empty">&lt;&lt;[Foto SIM / KTP sopir]&gt;&gt;</div>`}
      </div>
    </div>
  </div>

  <div class="bottom-accent"></div>
</div>

<!-- ════════ PAGE 3: LAMPIRAN FOTO SURAT PENGEMBALIAN / PERMINTAAN ════════ -->
<div class="page">
  <div class="top-accent"></div>
  <div class="header-kop">
    <div></div>
    <div class="pln-info">
      <img class="pln-logo" src="${PLN_LOGO_DATA_URI}" alt="Logo PLN"/>
      <div class="kop-text">UNIT INDUK JAWA BAGIAN TIMUR &amp; BALI</div>
      <div class="kop-sub">UNIT PELAKSANA TRANSMISI ${uptNama.toUpperCase()}</div>
    </div>
  </div>

  <div class="page-title-center">Lampiran Foto</div>

  <div class="photo-box-full">
    <div class="cell-title">Surat Pengembalian / Permintaan</div>
    <div class="cell-img-wrap-large">
      ${txn.fotoSuratPengembalian ? `<img src="${txn.fotoSuratPengembalian}" alt="Foto Surat"/>` : `<div class="photo-empty">&lt;&lt;[Foto surat permintaan]&gt;&gt;</div>`}
    </div>
  </div>

  <div class="bottom-accent"></div>
</div>

<!-- ════════ PAGE 4: LAMPIRAN FOTO BARANG ════════ -->
<div class="page">
  <div class="top-accent"></div>
  <div class="header-kop">
    <div></div>
    <div class="pln-info">
      <img class="pln-logo" src="${PLN_LOGO_DATA_URI}" alt="Logo PLN"/>
      <div class="kop-text">UNIT INDUK JAWA BAGIAN TIMUR &amp; BALI</div>
      <div class="kop-sub">UNIT PELAKSANA TRANSMISI ${uptNama.toUpperCase()}</div>
    </div>
  </div>

  <div class="page-title-center">Lampiran Foto Barang</div>

  <table class="photo-items-tbl">
    <thead>
      <tr>
        <th>Nama Material</th>
        <th>Foto Barang</th>
      </tr>
    </thead>
    <tbody>${materialPhotoRowsTable}</tbody>
  </table>

  <div class="bottom-accent"></div>
</div>

</body></html>`;
}

// Triggers a real browser download of the HTML document (works without
// any external CDN and without window.open — uses a Blob + <a download>).
// ─── TUG-10 DOCUMENT HTML BUILDER (Bon Pengembalian) ──────────────────
// Single-page document matching the uploaded format_TUG_10.pdf layout.
// Signature roles are reversed vs TUG-9: external party hands material
// back, internal SPV/TL Log receives it, Asman still signs "Mengetahui".
export function buildTUG10HTML(txn, katalogList, lokasiList, users, satpamList, gudangList, subGudangList, uptList) {
  const docs = txn?.docNumbers || {};
  const uptNama = resolveUptNama(txn.uptId, uptList);
  const uptKode = (uptList || []).find(u => u.id === txn.uptId)?.kode || "UPT-SBY";
  const asmanUser = users.find(u => u.role === "ASMAN") || {};
  const actualApprover = users.find(u=>u.id===txn.approvedBy) || {};
  const penerimaUser = txn.requiredApprover === "TL" ? actualApprover : (users.find(u=>u.role==="TL")||{});
  const satpamUser = (satpamList||[]).find(sp => sp.id === txn.satpamId) || {};

  const docNoTUG10 = docs.tug10 || (txn.docSeq ? `${txn.docSeq}.TUG-10/LOG.00.01/${uptKode}/VII/2026` : `TUG10-${(txn.id||"").slice(-6)}`);

  const items = txn?.stockItems || [];
  const itemRows = items.map(si => {
    const namaBarang = si.katalogMode==="existing" ? ((katalogList||[]).find(k=>k.id===si.katalogId)?.name||"-") : (si.namaBaru||"-");
    const satuan = si.katalogMode==="existing" ? ((katalogList||[]).find(k=>k.id===si.katalogId)?.satuan||"-") : (si.satuanBaru||"-");
    const ketStatus = si.statusMaterial==="Bongkaran ATTB (MTU)" ? `EKS BONGKARAN ATTB/MTU${si.noSeri?` — SN: ${si.noSeri}`:""}` : si.statusMaterial==="Bongkaran" ? "EKS BONGKARAN" : "MATERIAL SISA BARU";
    return `<tr><td>${namaBarang}</td><td style="text-align:center">${fmtNum(si.qty)}</td><td style="text-align:center">${satuan}</td><td style="text-align:center">${si.noAsset||"-"}</td><td>${ketStatus}</td></tr>`;
  }).join("");

  const materialPhotoCells = items.map(si => {
    const namaBarang = si.katalogMode==="existing" ? ((katalogList||[]).find(k=>k.id===si.katalogId)?.name||"-") : (si.namaBaru||"-");
    const photo = si.fotoBarangRetur || si.fotoNameplate;
    return `
      <div class="photo-col-cell">
        <div class="cell-title">${namaBarang} (${si.statusMaterial || "Retur"})</div>
        <div class="cell-img-wrap">
          ${photo ? `<img src="${photo}" alt="Foto Barang"/>` : `<div class="photo-empty">&lt;&lt;[Foto Barang]&gt;&gt;</div>`}
        </div>
      </div>`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TUG-10 ${txn.id}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#000;background:#e5e7eb}
.page{padding:20px;page-break-after:always;min-height:100vh;background:white;max-width:794px;margin:0 auto 16px;position:relative}
.page:last-child{page-break-after:auto;margin-bottom:0}
.top-accent{height:6px;background:linear-gradient(90deg,#007d9c 0%,#0098da 70%,#facc15 100%);margin-bottom:6px}
.bottom-accent{height:6px;background:linear-gradient(90deg,#007d9c 0%,#0098da 70%,#facc15 100%);margin-top:16px}
.header-kop{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px}
.pln-logo{height:28px;width:auto;display:block;margin-left:auto;margin-bottom:2px}
.kop-right{text-align:right}
.doc-tag-right{font-size:12px;font-weight:bold}
.doc-sub-right{font-size:8px;color:#555}

.section-box{border:1.5px solid #000;padding:12px;margin-bottom:14px;background:#fff}
.doctitle{text-align:center;font-size:14px;font-weight:bold;letter-spacing:0.5px;margin-bottom:2px}
.docno{text-align:center;font-size:10px;font-style:italic;font-weight:bold;margin-bottom:2px}
.company-subtitle{text-align:center;font-size:8.5px;font-weight:bold;margin-bottom:10px}

table.meta-tbl{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:9.5px;border:1px solid #000}
table.meta-tbl td{padding:3px 6px;vertical-align:top;border:1px solid #000}
table.meta-tbl td.lbl{width:120px;font-weight:bold}

table.items-tbl{width:100%;border-collapse:collapse;margin-top:6px;margin-bottom:8px;border:1.5px solid #000}
table.items-tbl th{background:#d1d5db;color:#000;border:1px solid #000;padding:5px 4px;font-size:9.5px;font-weight:bold;text-align:center}
table.items-tbl td{border:1px solid #000;padding:5px 6px;font-size:9px}

table.bottom-bar-tbl{width:100%;border-collapse:collapse;border:1px solid #000;margin-bottom:12px;font-size:9.5px}
table.bottom-bar-tbl th{background:#d1d5db;border:1px solid #000;padding:4px 6px;text-align:left;font-weight:bold}
table.bottom-bar-tbl td{border:1px solid #000;padding:4px 6px}

.sig-row-3{display:flex;justify-content:space-between;margin-top:10px;text-align:center}
.sig-col{flex:1;font-size:9.5px;padding:0 8px}
.sig-role{font-weight:bold;margin-top:2px}
.sig-space{height:45px}
.sig-name{font-weight:bold;text-transform:uppercase}

.print-bar{position:sticky;top:0;background:#003087;color:white;padding:10px 16px;text-align:center;font-size:13px;font-weight:700;z-index:100}
.print-bar button{background:#16a34a;color:white;border:none;border-radius:6px;padding:8px 18px;font-size:13px;font-weight:700;cursor:pointer;margin-left:10px}

.page-title-center{text-align:center;font-size:12px;font-weight:bold;margin-bottom:10px;margin-top:6px}
.photo-box-2col{border:1.5px solid #000;display:grid;grid-template-columns:1fr 1fr;min-height:500px}
.photo-col-cell{border-right:1px solid #000;border-bottom:1px solid #000;padding:8px;display:flex;flex-direction:column;align-items:center}
.cell-title{font-size:11px;font-weight:bold;margin-bottom:8px;text-align:center}
.cell-img-wrap{flex:1;width:100%;display:flex;align-items:center;justify-content:center}
.cell-img-wrap img{max-width:100%;max-height:440px;object-fit:contain}
.photo-empty{color:#9ca3af;font-style:italic;font-size:10px;text-align:center}

@media print{.print-bar{display:none}.page{box-shadow:none;margin:0;max-width:none;padding:15px}body{background:white}}
</style></head><body>

<div class="print-bar">📄 Dokumen TUG-10 siap dicetak &nbsp; <button onclick="window.print()">🖨️ Print / Save as PDF</button></div>

<!-- ════════ PAGE 1: BON PENGEMBALIAN ════════ -->
<div class="page">
  <div class="top-accent"></div>
  <div class="header-kop">
    <div></div>
    <div class="kop-right">
      <img class="pln-logo" src="${PLN_LOGO_DATA_URI}" alt="Logo PLN"/>
      <div class="doc-tag-right">TUG 10</div>
      <div class="doc-sub-right">2. Untuk Fungsi Gudang</div>
    </div>
  </div>

  <div class="section-box">
    <div class="doctitle">BON PENGEMBALIAN</div>
    <div class="docno">&lt;&lt;${docNoTUG10}&gt;&gt;</div>
    <div class="company-subtitle">PT. PLN (PERSERO) UNIT INDUK TRANSMISI JAWA BAGIAN TIMUR DAN BALI</div>

    <table class="meta-tbl">
      <tr>
        <td class="lbl">PEKERJAAN</td><td style="width:10px">:</td><td>${txn.pekerjaan || "-"}</td>
        <td class="lbl" style="width:130px">UNIT / SEKTOR</td><td style="width:10px">:</td><td>${uptNama.toUpperCase()}</td>
      </tr>
      <tr>
        <td class="lbl">NAMA PEKERJAAN</td><td>:</td><td>${txn.namaPekerjaan || "-"}</td>
        <td class="lbl">NO BA PENGGANTIAN</td><td>:</td><td>${txn.noBAPenggantian || "-"}</td>
      </tr>
      <tr>
        <td class="lbl">LOKASI PEKERJAAN</td><td>:</td><td>${txn.lokasiPekerjaan || "-"}</td>
        <td class="lbl">TANGGAL</td><td>:</td><td>${fmtDateOnly(txn.createdAt)}</td>
      </tr>
    </table>

    <table class="items-tbl">
      <thead>
        <tr>
          <th style="width:40%">Nama barang / Spare Parts</th>
          <th style="width:12%">Jumlah</th>
          <th style="width:10%">Satuan</th>
          <th style="width:18%">Nomor Asset</th>
          <th style="width:20%">Keterangan</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <table class="bottom-bar-tbl">
      <thead>
        <tr>
          <th style="width:25%">Perkiraan Pembebanan</th>
          <th style="width:50%">Kode perkiraan</th>
          <th style="width:25%;text-align:center">Tanggal</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${txn.perkiraanPembebanan || "-"}</td>
          <td>${txn.kodePerkiraan || "-"}</td>
          <td style="text-align:center">${fmtDateOnly(txn.createdAt)}</td>
        </tr>
      </tbody>
    </table>

    <div class="sig-row-3">
      <div class="sig-col">
        <div><i>Mengetahui,</i></div>
        <div class="sig-role">MAN II KONS ${uptNama.toUpperCase()}</div>
        <div class="sig-space"></div>
        <div class="sig-name">${asmanUser.name || "ASEP MOCH. YUSUP"}</div>
      </div>
      <div class="sig-col">
        <div><i>Yang Menerima,</i></div>
        <div class="sig-role">SPV LOG ${uptNama.toUpperCase()}</div>
        <div class="sig-space"></div>
        <div class="sig-name">${penerimaUser.name || "WIDI FERDIAN R"}</div>
      </div>
      <div class="sig-col">
        <div><i>Yang Menyerahkan,</i></div>
        <div class="sig-role">${(txn.menyerahkanUnit || "UNIT PENGIRIM").toUpperCase()}</div>
        <div class="sig-space"></div>
        <div class="sig-name">${txn.menyerahkanNama || "....................."}</div>
      </div>
    </div>
  </div>
  <div class="bottom-accent"></div>
</div>

<!-- ════════ PAGE 2: LAMPIRAN FOTO 4-FRAME ════════ -->
<div class="page">
  <div class="top-accent"></div>
  <div class="header-kop">
    <div></div>
    <div class="kop-right">
      <img class="pln-logo" src="${PLN_LOGO_DATA_URI}" alt="Logo PLN"/>
      <div class="kop-text">UNIT INDUK JAWA BAGIAN TIMUR &amp; BALI</div>
      <div class="kop-sub">UNIT PELAKSANA TRANSMISI ${uptNama.toUpperCase()}</div>
    </div>
  </div>

  <div class="page-title-center">Lampiran Foto</div>

  <div class="photo-box-2col">
    <div class="photo-col-cell">
      <div class="cell-title">Surat Pengembalian</div>
      <div class="cell-img-wrap">
        ${txn.fotoBAPengembalian ? `<img src="${txn.fotoBAPengembalian}" alt="Surat Pengembalian"/>` : `<div class="photo-empty">&lt;&lt;[Foto surat pengembalian]&gt;&gt;</div>`}
      </div>
    </div>
    <div class="photo-col-cell">
      <div class="cell-title">SIM / KTP</div>
      <div class="cell-img-wrap">
        ${txn.fotoSimKtp ? `<img src="${txn.fotoSimKtp}" alt="SIM/KTP"/>` : `<div class="photo-empty">&lt;&lt;[Foto SIM/ KTP sopir]&gt;&gt;</div>`}
      </div>
    </div>
    <div class="photo-col-cell">
      <div class="cell-title">Foto Kendaraan</div>
      <div class="cell-img-wrap">
        ${txn.fotoKendaraan ? `<img src="${txn.fotoKendaraan}" alt="Foto Kendaraan"/>` : `<div class="photo-empty">&lt;&lt;[Foto Kendaraan pengangkut]&gt;&gt;</div>`}
      </div>
    </div>
    <div class="photo-col-cell">
      <div class="cell-title">Lampiran Tambahan</div>
      <div class="cell-img-wrap">
        <div class="photo-empty">&lt;&lt;[Lampiran Tambahan]&gt;&gt;</div>
      </div>
    </div>
  </div>
  <div class="bottom-accent"></div>
</div>

<!-- ════════ PAGE 3: LAMPIRAN FOTO BARANG ════════ -->
<div class="page">
  <div class="top-accent"></div>
  <div class="header-kop">
    <div></div>
    <div class="kop-right">
      <img class="pln-logo" src="${PLN_LOGO_DATA_URI}" alt="Logo PLN"/>
      <div class="kop-text">UNIT INDUK JAWA BAGIAN TIMUR &amp; BALI</div>
      <div class="kop-sub">UNIT PELAKSANA TRANSMISI ${uptNama.toUpperCase()}</div>
    </div>
  </div>

  <div class="page-title-center">Lampiran Foto Barang</div>

  <div class="photo-box-2col">
    ${materialPhotoCells}
  </div>
  <div class="bottom-accent"></div>
</div>

</body></html>`;
}

export function downloadTUG10HTML(txn, katalogList, lokasiList, users, satpamList, gudangList, subGudangList, showToast, uptList) {
  const html = buildTUG10HTML(txn, katalogList, lokasiList, users, satpamList, gudangList, subGudangList, uptList);
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
export function buildTUG5HTML(txn, katalogList, uitList, users, ultgList, uptList) {
  const docs = txn?.docNumbers || {};
  const isUltg = txn?.sourceType === "ULTG";

  if (isUltg) return buildTUG5ULTGHTML(txn, katalogList, users, ultgList);

  const uptNama = resolveUptNama(txn.uptId, uptList);
  const uptKode = (uptList || []).find(u => u.id === txn.uptId)?.kode || "UPT-SBY";
  const managerUser = users.find(u=>u.role==="MANAGER")||{};
  const asmanUser = users.find(u=>u.role==="ASMAN")||{};
  const uit = (uitList||[]).find(u=>u.id===txn.uitId)||{};
  const dateInfo = (() => {
    const d = txn.createdAt ? new Date(txn.createdAt) : new Date();
    const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    return `${uptNama}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  })();

  const docNoTUG5 = docs.tug5 || (txn.docSeq ? `${txn.docSeq}.TUG-5/LOG-${uptKode}/VII/2026` : `TUG5-${(txn.id||"").slice(-6)}`);

  const itemRows = (txn.stockItems||[]).map((si)=>{
    const kat = (katalogList||[]).find(k=>k.id===si.katalogId)||{};
    return `<tr>
      <td>${kat.name||"-"}</td>
      <td style="text-align:center">${kat.katalog||"-"}</td>
      <td style="text-align:center">${kat.satuan||"-"}</td>
      <td style="text-align:center">${fmtNum(si.pemakaianBulan||0)}</td>
      <td style="text-align:center">${fmtNum(si.sisaPersediaan||0)}</td>
      <td style="text-align:center">${fmtNum(si.permintaan||0)}</td>
      <td style="text-align:center"></td><td style="text-align:center"></td><td style="text-align:center"></td>
      <td>${si.keterangan||""}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TUG-5 ${txn.id}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#000;background:#e5e7eb}
.page{padding:20px;page-break-after:always;min-height:100vh;background:white;max-width:900px;margin:0 auto 16px;position:relative}
.page:last-child{page-break-after:auto;margin-bottom:0}
.top-accent{height:6px;background:linear-gradient(90deg,#007d9c 0%,#0098da 70%,#facc15 100%);margin-bottom:8px}
.bottom-accent{height:6px;background:linear-gradient(90deg,#007d9c 0%,#0098da 70%,#facc15 100%);margin-top:20px}
.header-kop{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px}
.pln-logo{height:30px;width:auto;display:block;margin-left:auto;margin-bottom:4px}
.doc-tag-right{font-size:13px;font-weight:bold;text-align:right}

.doctitle{text-align:center;font-size:14px;font-weight:bold;letter-spacing:0.5px;margin-bottom:2px}
.docno{text-align:center;font-size:10px;font-style:italic;font-weight:bold;margin-bottom:12px;color:#333}

.meta-container{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;font-size:9.5px}
.meta-left{flex:1;padding-right:15px}
.meta-left table{width:100%;border-collapse:collapse}
.meta-left td{padding:2px 4px;vertical-align:top}
.meta-left td.lbl{width:110px}
.meta-right-box{border:1px solid #000;border-collapse:collapse;width:170px;font-size:9.5px}
.meta-right-box td{border:1px solid #000;padding:3px 6px;font-weight:bold}

table.items-tbl{width:100%;border-collapse:collapse;margin-top:6px;margin-bottom:8px;border:1.5px solid #000}
table.items-tbl th{background:#d1d5db;color:#000;border:1px solid #000;padding:5px 4px;font-size:9.5px;font-weight:bold;text-align:center}
table.items-tbl td{border:1px solid #000;padding:5px 6px;font-size:9px}

.bottom-meta-box{border:1.5px solid #000;margin-bottom:14px}
.meta-row-single{padding:6px 8px;border-bottom:1px solid #000;font-size:9.5px}
.meta-row-3col{display:flex;font-size:9.5px}
.meta-col{flex:1;padding:6px 8px;border-right:1px solid #000}
.meta-col:last-child{border-right:none}

.date-right{text-align:right;font-size:9.5px;font-weight:bold;margin-bottom:16px;margin-top:10px}
.sig-row-2{display:flex;justify-content:space-around;margin-top:10px;text-align:center}
.sig-col{flex:1;font-size:9.5px;padding:0 12px}
.sig-role{font-weight:bold;margin-top:2px}
.sig-space{height:50px}
.sig-name{font-weight:bold;text-transform:uppercase}

.print-bar{position:sticky;top:0;background:#003087;color:white;padding:10px 16px;text-align:center;font-size:13px;font-weight:700;z-index:100}
.print-bar button{background:#16a34a;color:white;border:none;border-radius:6px;padding:8px 18px;font-size:13px;font-weight:700;cursor:pointer;margin-left:10px}

@media print{.print-bar{display:none}.page{box-shadow:none;margin:0;max-width:none;padding:15px}body{background:white}}
</style></head><body>

<div class="print-bar">📄 Dokumen TUG-5 siap dicetak &nbsp; <button onclick="window.print()">🖨️ Print / Save as PDF</button></div>

<div class="page">
  <div class="top-accent"></div>
  <div class="header-kop">
    <div></div>
    <div>
      <img class="pln-logo" src="${PLN_LOGO_DATA_URI}" alt="Logo PLN"/>
      <div class="doc-tag-right">TUG - 5</div>
    </div>
  </div>

  <div class="doctitle">DAFTAR PERMINTAAN BARANG - BARANG</div>
  <div class="docno">&lt;&lt;${docNoTUG5}&gt;&gt;</div>

  <div class="meta-container">
    <div class="meta-left">
      <table>
        <tr><td class="lbl">Kepada</td><td style="width:10px">:</td><td>${uit.nama || "PT. PLN (PERSERO) UNIT INDUK TRANSMISI JAWA BAGIAN TIMUR DAN BALI"}</td></tr>
        <tr><td class="lbl">Harap dikirim ke</td><td>:</td><td>PT. PLN (PERSERO) UNIT INDUK TRANSMISI JAWA BAGIAN TIMUR &amp; BALI - ${uptNama.toUpperCase()}</td></tr>
        <tr><td class="lbl">Alamat</td><td>:</td><td>JL. KETINTANG BARU NO. 9 SURABAYA KODE POS 60231</td></tr>
      </table>
    </div>
    <table class="meta-right-box">
      <tr><td style="width:50px">PLN</td><td>: ${uit.kode || "UIT-JBM"}</td></tr>
      <tr><td>UPT</td><td>: ${uptNama.toUpperCase()}</td></tr>
    </table>
  </div>

  <table class="items-tbl">
    <thead>
      <tr>
        <th rowspan="2" style="width:24%">Nama Barang<br/>(Ditulis Selengkap – lengkapnya)</th>
        <th rowspan="2" style="width:12%">Nomor Normalisasi</th>
        <th rowspan="2" style="width:8%">Satuan</th>
        <th rowspan="2" style="width:10%">Pemakaian<br/>rata-rata per<br/>bulan</th>
        <th rowspan="2" style="width:9%">Sisa<br/>Persediaan</th>
        <th rowspan="2" style="width:9%">Permintaan</th>
        <th colspan="3" style="width:18%">Diberikan</th>
        <th rowspan="2" style="width:10%">Keterangan</th>
      </tr>
      <tr>
        <th style="width:6%">Jumlah</th>
        <th style="width:6%">DO Nomor</th>
        <th style="width:6%">Tanggal</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="bottom-meta-box">
    <div class="meta-row-single">
      <b>Keterangan :</b> ${txn.namaPekerjaan || txn.keteranganUmum || "-"}
    </div>
    <div class="meta-row-3col">
      <div class="meta-col"><b>Perintah kerja :</b> ${txn.perintahKerja || "-"}</div>
      <div class="meta-col"><b>Kode Perkiraan :</b> ${txn.kodePerkiraan || "-"}</div>
      <div class="meta-col"><b>Fungsi :</b> ${txn.fungsi || "-"}</div>
    </div>
  </div>

  <div class="date-right">${dateInfo}</div>

  <div class="sig-row-2">
    <div class="sig-col">
      <div class="sig-role">MANAGER ${uptNama.toUpperCase()}</div>
      <div class="sig-space"></div>
      <div class="sig-name">${managerUser.name || "IVAN NUR PRATAMA"}</div>
    </div>
    <div class="sig-col">
      <div class="sig-role">ASMAN KONSTRUKSI</div>
      <div class="sig-space"></div>
      <div class="sig-name">${asmanUser.name || "ASEP MOCH. YUSUP"}</div>
    </div>
  </div>

  <div class="bottom-accent"></div>
</div>

</body></html>`;
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

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Slip Reservasi ULTG ${txn.id}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:10px;color:#111;background:#e5e7eb}.page{padding:24px;background:white;max-width:1000px;margin:0 auto 16px;min-height:100vh}.topbar{height:5px;background:linear-gradient(90deg,#00377a,#0098da);margin-bottom:4px}.doctitle{text-align:center;margin-bottom:10px}.doctitle h2{font-size:13px;font-weight:800;text-decoration:underline}.doctitle .docno{font-size:10px;font-style:italic;color:#0098da}table.meta{width:100%;margin-bottom:10px}table.meta td{padding:3px 4px;font-size:10px}table.meta td.label{width:110px}table.meta td.colon{width:8px}table.items{width:100%;border-collapse:collapse;margin-bottom:10px}table.items th{background:#003087;color:white;padding:6px 6px;font-size:9.5px;text-align:center;border:1px solid #ccc}table.items td{padding:6px 6px;border:1px solid #ccc;font-size:10px}.sig-row{display:flex;justify-content:center;margin-top:24px;text-align:center}.sig-col{width:280px;font-size:10px}.sig-space{height:40px;display:flex;align-items:center;justify-content:center}.sig-name{font-weight:700;text-decoration:underline;margin-top:2px}.digital-stamp{border:2px solid #16a34a;color:#16a34a;border-radius:6px;padding:6px 10px;font-size:9px;font-weight:700;display:inline-block;transform:rotate(-4deg)}.print-bar{position:sticky;top:0;background:#003087;color:white;padding:8px 14px;text-align:center;font-size:12px;font-weight:700;z-index:10}.print-bar button{background:#16a34a;color:white;border:none;border-radius:6px;padding:6px 16px;font-size:12px;cursor:pointer;margin-left:10px}@media print{.print-bar{display:none}body{background:white}}</style></head><body>
<div class="print-bar">📄 Slip Reservasi siap cetak <button onclick="window.print()">🖨️ Print / Save as PDF</button></div>
<div class="page">
<div class="topbar"></div>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
  <div><b>PT PLN (PERSERO)</b><br/>${ultg.nama||"ULTG"}</div>
  <div style="font-weight:800;font-size:14px">RESERVASI</div>
</div>
<div class="doctitle"><h2>SLIP RESERVASI BARANG (ULTG)</h2><div class="docno">${docs?.tug5||txn.id}</div></div>
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

export function downloadTUG5HTML(txn, katalogList, uitList, users, showToast, ultgList, uptList) {
  const html = buildTUG5HTML(txn, katalogList, uitList, users, ultgList, uptList);
  const blob = new Blob([html], {type:"text/html"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const downloadPrefix = txn.sourceType === "ULTG" ? "Reservasi" : "TUG5";
  a.href = url; a.download = `${downloadPrefix}_${txn.docSeq}_${(txn.keteranganUmum||"").replace(/[^a-zA-Z0-9]/g,"_").slice(0,25)}.html`;
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
export function buildBeritaAcaraHTML(opn, katalogList, users, uptList) {
  const items = opn.items || [];
  const creator = (users||[]).find(u=>u.id===opn.dibuatOleh) || {};
  const uptNama = resolveUptNama(creator.uptId, uptList, creator.upt);
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
  <div><b>PT PLN (PERSERO)</b><br/>${uptNama}</div>
  <div style="font-weight:800;font-size:13px">BERITA ACARA<br/>STOCK OPNAME</div>
</div>
<div class="doctitle"><h2>BERITA ACARA STOCK OPNAME (${opn.jenisAlur})</h2><div class="docno">No. : ${opn.id}</div></div>
<table class="meta">
  <tr><td class="label">Semester</td><td class="colon">:</td><td>${fmt(opn.semester)}</td></tr>
  <tr><td class="label">Jenis Opname</td><td class="colon">:</td><td>${fmt(opn.jenisAlur)} (${fmt(opn.kategori)})</td></tr>
  ${opn.gudangId !== undefined ? `<tr><td class="label">Gudang</td><td class="colon">:</td><td>${fmt(opn.gudangKode || (opn.gudangId===null ? "Belum Beralamat" : "-"))}</td></tr>` : ""}
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

// ─── LEMBAR HITUNG (Fase 1f) — cadangan kertas untuk regu tanpa HP; meniru pola
// buildBeritaAcaraHTML di atas (@page A4, print-bar+window.print, thead sticky, no page-break
// di tengah baris). Dikelompokkan Gudang → Blok (grup "TANPA LOKASI" selalu di akhir), qty fisik
// & paraf dikosongkan untuk diisi tangan. Satu item bisa muncul di lebih dari 1 baris kalau
// stok-nya tersebar di beberapa blok (lokasiBreakdown, Fase 1b) — filterGudangId/filterLokasiId
// opsional mengikuti filter aktif di tabel (Fase 1f).
export function buildLembarHitungHTML(opn, { lokasiList, gudangList, filterGudangId, filterLokasiId } = {}) {
  const rows = [];
  (opn.items || []).forEach(it => {
    const bd = (it.lokasiBreakdown && it.lokasiBreakdown.length) ? it.lokasiBreakdown : [{ gudangId: null, gudangKode: null, lokasiId: null, lokasiKode: null, qty: it.qtySistem }];
    bd.forEach(b => {
      if (filterLokasiId && filterLokasiId !== "_TANPA_LOKASI" && b.lokasiId !== filterLokasiId) return;
      if (filterLokasiId === "_TANPA_LOKASI" && b.lokasiId) return;
      if (filterGudangId && b.gudangId !== filterGudangId) return;
      rows.push({ it, gudangKode: b.gudangKode || "TANPA LOKASI", lokasiKode: b.lokasiKode || "-", qty: b.qty });
    });
  });

  const groups = new Map();
  rows.forEach(r => {
    if (!groups.has(r.gudangKode)) groups.set(r.gudangKode, new Map());
    const lokMap = groups.get(r.gudangKode);
    if (!lokMap.has(r.lokasiKode)) lokMap.set(r.lokasiKode, []);
    lokMap.get(r.lokasiKode).push(r);
  });
  const gudangKeys = [...groups.keys()].sort((a, b) => (a === "TANPA LOKASI" ? 1 : 0) - (b === "TANPA LOKASI" ? 1 : 0));

  let no = 0;
  const sectionsHtml = gudangKeys.map(gk => {
    const lokMap = groups.get(gk);
    const blokHtml = [...lokMap.entries()].map(([lk, rs]) => {
      const rowsHtml = rs.map(r => { no++; return `
      <tr><td style="text-align:center">${no}</td><td style="text-align:center">${r.it.noKatalog || "-"}</td>
      <td>${r.it.namaBarang || "-"}</td><td style="text-align:center">${r.it.satuan || "-"}</td>
      <td style="text-align:center">${r.qty ?? 0}</td><td></td><td></td></tr>`; }).join("");
      return `<tr><td colspan="7" style="background:#f1f5f9;font-weight:700;padding:4px 6px">Blok: ${lk} (${rs.length} item)</td></tr>${rowsHtml}`;
    }).join("");
    return `<tr><td colspan="7" style="background:#003087;color:white;font-weight:800;padding:5px 6px">GUDANG: ${gk}</td></tr>${blokHtml}`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Lembar Hitung ${opn.id}</title>
<style>@page{size:A4;margin:10mm}*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:10px;color:#111}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 5px}thead{display:table-header-group}tr{page-break-inside:avoid}.print-bar{position:sticky;top:0;background:#003087;color:white;padding:8px 14px;text-align:center;font-size:12px;font-weight:700}.print-bar button{background:#16a34a;color:white;border:none;border-radius:6px;padding:6px 16px;font-size:12px;cursor:pointer;margin-left:10px}@media print{.print-bar{display:none}}</style></head><body>
<div class="print-bar">📄 Lembar Hitung Fisik — A4 &nbsp; <button onclick="window.print()">🖨️ Print</button></div>
<h2 style="margin:10px 0">Lembar Hitung Fisik — Opname ${opn.semester} (${opn.jenisAlur})${opn.gudangKode ? ` — Gudang ${opn.gudangKode}` : ""}</h2>
<table><thead><tr><th>No</th><th>No. Katalog</th><th>Nama Barang</th><th>Satuan</th><th>Qty Sistem</th><th>Qty Fisik</th><th>Paraf</th></tr></thead>
<tbody>${sectionsHtml}</tbody></table>
</body></html>`;
}

export function downloadLembarHitungHTML(opn, opts) {
  const html = buildLembarHitungHTML(opn, opts);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `LembarHitung_${opn.semester}_${opn.jenisAlur}_${opn.id}.html`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
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

export function buildTUG3HTML(txn, katalogList, lokasiList, timMutuList, users, satpamList, uptList) {
  const docs = txn?.docNumbers || {};
  const uptNama = resolveUptNama(txn.uptId, uptList);
  const uptKode = (uptList || []).find(u => u.id === txn.uptId)?.kode || "UPT-SBY";
  const creator = users.find(u=>u.id===txn.createdBy) || {};
  const actualApprover = users.find(u=>u.id===txn.approvedBy) || {};
  const scopedTl = users.find(u => u.role === "TL" && (!txn.uptId || u.uptId === txn.uptId)) || {};
  const menyerahkanUser = actualApprover.role === "TL" ? actualApprover : scopedTl;
  const satpamUser = (satpamList||[]).find(sp => sp.id === txn.satpamId) || {};

  const dateInfo = (() => {
    const d = txn.createdAt ? new Date(txn.createdAt) : new Date();
    const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
    const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    return {
      hari: days[d.getDay()],
      tanggal: d.getDate(),
      bulan: months[d.getMonth()],
      tahun: d.getFullYear(),
      tanggalLengkap: fmtDateOnly(d.getTime())
    };
  })();

  const docNoSJ = docs.sj || docs.tug3 || `${txn.docSeq || "1"}.SI/LOG.00.02/${uptKode}/VII/2026`;
  const docNoBA = docs.ba || docs.tug4 || docNoSJ.replace(".SI/", ".BA/").replace(".SJ/", ".BA/");

  const items = txn?.stockItems || [];
  const materialRowsTable = items.map(si => {
    const namaBarang = si.katalogMode==="existing" ? ((katalogList||[]).find(k=>k.id===si.katalogId)?.name||"-") : (si.namaBaru||"-");
    const satuan = si.katalogMode==="existing" ? ((katalogList||[]).find(k=>k.id===si.katalogId)?.satuan||"-") : (si.satuanBaru||"-");
    const lokasi = (lokasiList||[]).find(l=>l.id===si.lokasiId)?.kode || "GUDANG";
    return `
    <tr>
      <td>${namaBarang}</td>
      <td style="text-align:center">${lokasi}</td>
      <td style="text-align:center">${fmtNum(si.qty)}</td>
      <td style="text-align:center">${satuan}</td>
      <td>${txn.dariSupplier ? `(Pengadaan ${txn.dariSupplier}) ` : ""}${txn.keteranganTug3 || ""}</td>
    </tr>`;
  }).join("");

  const materialPhotoRowsTable = items.map(si => {
    const namaBarang = si.katalogMode==="existing" ? ((katalogList||[]).find(k=>k.id===si.katalogId)?.name||"-") : (si.namaBaru||"-");
    const photo = si.fotoBarangRetur || si.fotoNameplate || ((txn.fotoMaterial||[]).find(fm => fm.katalogId === si.katalogId || fm.stockId === si.stockId)?.img);
    return `
      <tr>
        <td style="padding:10px;vertical-align:top;font-weight:bold;width:35%">${namaBarang}</td>
        <td style="padding:10px;text-align:center">
          ${photo ? `<img src="${photo}" style="max-height:220px;max-width:100%;object-fit:contain;border:1px solid #ccc;border-radius:4px" alt="Foto Barang"/>` : `<div style="color:#9ca3af;font-style:italic;padding:20px">&lt;&lt;[Foto Barang]&gt;&gt;</div>`}
        </td>
      </tr>`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TUG-3/4 ${txn.id}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#000;background:#e5e7eb}
.page{padding:20px;page-break-after:always;min-height:100vh;background:white;max-width:794px;margin:0 auto 16px;position:relative}
.page:last-child{page-break-after:auto;margin-bottom:0}
.top-accent{height:6px;background:linear-gradient(90deg,#007d9c 0%,#0098da 70%,#facc15 100%);margin-bottom:6px}
.bottom-accent{height:6px;background:linear-gradient(90deg,#007d9c 0%,#0098da 70%,#facc15 100%);margin-top:16px}
.header-kop{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px}
.pln-info{text-align:right}
.pln-logo{height:28px;width:auto;display:block;margin-left:auto;margin-bottom:2px}
.kop-text{font-size:8.5px;font-weight:bold;line-height:1.2;color:#000}
.kop-sub{font-size:8px;font-weight:bold;line-height:1.2;color:#333}

.section-box{border:1.5px solid #000;padding:12px;margin-bottom:14px;background:#fff}
.doctitle{text-align:center;font-size:13px;font-weight:bold;letter-spacing:0.5px;margin-bottom:2px;text-transform:uppercase}
.docno{text-align:center;font-size:10px;font-weight:bold;margin-bottom:10px}
.docno a{color:#003087;text-decoration:underline}

table.meta-tbl{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:9.5px}
table.meta-tbl td{padding:2px 4px;vertical-align:top}
table.meta-tbl td.lbl{width:140px;color:#111}

table.items-tbl{width:100%;border-collapse:collapse;margin-top:6px;margin-bottom:8px;border:1px solid #000}
table.items-tbl th{background:#d1d5db;color:#000;border:1px solid #000;padding:5px 4px;font-size:9.5px;font-weight:bold;text-align:center}
table.items-tbl td{border:1px solid #000;padding:5px 6px;font-size:9px}

.closing-note{font-size:9px;margin-top:6px;margin-bottom:10px;font-style:italic}
.bast-intro{font-size:9.5px;line-height:1.4;margin-bottom:6px}

.sig-row-3{display:flex;justify-content:space-between;margin-top:10px;text-align:center}
.sig-row-2{display:flex;justify-content:space-around;margin-top:10px;text-align:center}
.sig-col{flex:1;font-size:9.5px;padding:0 8px}
.sig-role{font-weight:bold;margin-top:2px}
.sig-space{height:45px}
.sig-name{font-weight:bold;text-transform:uppercase}

.print-bar{position:sticky;top:0;background:#003087;color:white;padding:10px 16px;text-align:center;font-size:13px;font-weight:700;z-index:100}
.print-bar button{background:#16a34a;color:white;border:none;border-radius:6px;padding:8px 18px;font-size:13px;font-weight:700;cursor:pointer;margin-left:10px}

.page-title-center{text-align:center;font-size:12px;font-weight:bold;margin-bottom:10px;margin-top:6px}
.photo-box-2col{border:1.5px solid #000;display:grid;grid-template-columns:1fr 1fr;min-height:500px}
.photo-col-cell{border-right:1px solid #000;padding:8px;display:flex;flex-direction:column;align-items:center}
.photo-col-cell:last-child{border-right:none}
.cell-title{font-size:11px;font-weight:bold;margin-bottom:8px;text-align:center}
.cell-img-wrap{flex:1;width:100%;display:flex;align-items:center;justify-content:center}
.cell-img-wrap img{max-width:100%;max-height:440px;object-fit:contain}
.photo-empty{color:#9ca3af;font-style:italic;font-size:10px;text-align:center}

.photo-box-full{border:1.5px solid #000;padding:12px;min-height:550px;display:flex;flex-direction:column;align-items:center}
.cell-img-wrap-large{flex:1;width:100%;display:flex;align-items:center;justify-content:center}
.cell-img-wrap-large img{max-width:100%;max-height:500px;object-fit:contain}

table.photo-items-tbl{width:100%;border-collapse:collapse;border:1.5px solid #000;margin-top:10px}
table.photo-items-tbl th{background:#d1d5db;border:1px solid #000;padding:6px;font-size:10px;font-weight:bold;text-align:center}
table.photo-items-tbl td{border:1px solid #000;padding:6px}

@media print{.print-bar{display:none}.page{box-shadow:none;margin:0;max-width:none;padding:15px}body{background:white}}
</style></head><body>

<div class="print-bar">📄 Dokumen TUG-3 / TUG-4 / BAST-B siap dicetak &nbsp; <button onclick="window.print()">🖨️ Print / Save as PDF</button></div>

<!-- ════════ PAGE 1: SURAT JALAN & BAST-B ════════ -->
<div class="page">
  <div class="top-accent"></div>
  <div class="header-kop">
    <div></div>
    <div class="pln-info">
      <img class="pln-logo" src="${PLN_LOGO_DATA_URI}" alt="Logo PLN"/>
      <div class="kop-text">UNIT INDUK JAWA BAGIAN TIMUR &amp; BALI</div>
      <div class="kop-sub">UNIT PELAKSANA TRANSMISI ${uptNama.toUpperCase()}</div>
    </div>
  </div>

  <!-- BOX 1: SURAT JALAN PENGAMBILAN MATERIAL -->
  <div class="section-box">
    <div class="doctitle">SURAT JALAN PENGAMBILAN MATERIAL</div>
    <div class="docno">${docNoSJ}</div>

    <table class="meta-tbl">
      <tr>
        <td class="lbl">Dibawa Ke</td><td style="width:10px">:</td><td>${txn.lokasiPekerjaan || txn.lokasiPenyerahan || "-"}</td>
        <td class="lbl" style="width:140px">Kendaraan / Nopol</td><td style="width:10px">:</td><td>${txn.nopol || "-"}</td>
      </tr>
      <tr>
        <td class="lbl">Tanggal Pengambilan</td><td>:</td><td>${fmtDateOnly(txn.createdAt)}</td>
        <td class="lbl">No SIM / KTP Pengemudi</td><td>:</td><td>${txn.simKtp || "-"}</td>
      </tr>
      <tr>
        <td class="lbl">PIC Gudang ${uptNama}</td><td>:</td><td colspan="4">${creator.name || "-"}${creator.officialPhone ? ` (${creator.officialPhone})` : ""}</td>
      </tr>
    </table>

    <table class="items-tbl">
      <thead>
        <tr>
          <th style="width:30%">MATERIAL</th>
          <th style="width:15%">GUDANG</th>
          <th style="width:10%">JUMLAH</th>
          <th style="width:10%">SATUAN</th>
          <th style="width:35%">KETERANGAN</th>
        </tr>
      </thead>
      <tbody>${materialRowsTable}</tbody>
    </table>

    <div class="closing-note">Demikian Surat Jalan ini kami buat agar dipergunakan sebagaimana mestinya</div>

    <div class="sig-row-3">
      <div class="sig-col">
        <div><i>Transporter,</i></div>
        <div class="sig-role">PENGEMUDI</div>
        <div class="sig-space"></div>
        <div class="sig-name">${txn.namaPengemudi || "....................."}</div>
      </div>
      <div class="sig-col">
        <div><i>Mengetahui,</i></div>
        <div class="sig-role">SATPAM GUDANG ${(satpamUser.gudangNama || WAREHOUSE).toUpperCase()}</div>
        <div class="sig-space"></div>
        <div class="sig-name">${satpamUser.name || "....................."}</div>
      </div>
      <div class="sig-col">
        <div><i>Yang menyerahkan,</i></div>
        <div class="sig-role">ADMINISTRASI GUDANG</div>
        <div class="sig-space"></div>
        <div class="sig-name">${creator.name || "....................."}</div>
      </div>
    </div>
  </div>

  <!-- BOX 2: BERITA ACARA SERAH TERIMA BARANG (BAST-B) -->
  <div class="section-box">
    <div class="doctitle">BERITA ACARA SERAH TERIMA BARANG (BAST-B)</div>
    <div class="docno">${docNoBA}</div>

    <div class="bast-intro">
      Pada hari ini <b>${dateInfo.hari}</b> tanggal <b>${dateInfo.tanggal}</b> bulan <b>${dateInfo.bulan}</b> tahun <b>${dateInfo.tahun}</b> (${dateInfo.tanggalLengkap}), Kami yang bertanda di bawah ini :
    </div>

    <table class="meta-tbl" style="margin-bottom:4px">
      <tr><td class="lbl" style="width:70px">Nama</td><td style="width:10px">:</td><td>${menyerahkanUser.name || creator.name || "-"}</td></tr>
      <tr><td class="lbl">Jabatan</td><td>:</td><td>${menyerahkanUser.jabatan || `TL LOG ${uptNama.toUpperCase()}`}</td></tr>
      <tr><td class="lbl">Unit</td><td>:</td><td>${uptNama.toUpperCase()}</td></tr>
    </table>
    <div style="font-size:9.5px;font-style:italic;margin-bottom:6px">Untuk selanjutnya disebut <b>PIHAK YANG MENYERAHKAN</b></div>

    <table class="meta-tbl" style="margin-bottom:4px">
      <tr><td class="lbl" style="width:70px">Nama</td><td style="width:10px">:</td><td>${txn.penerimaNama || "-"}</td></tr>
      <tr><td class="lbl">Jabatan</td><td>:</td><td>${txn.penerimaJabatan || "-"}</td></tr>
      <tr><td class="lbl">Unit</td><td>:</td><td>${txn.penerimaUnit || "-"}</td></tr>
    </table>
    <div style="font-size:9.5px;font-style:italic;margin-bottom:6px">Untuk selanjutnya disebut <b>PIHAK YANG MENERIMA</b></div>

    <div style="font-size:9.5px;margin-bottom:6px">Telah melaksanakan serah terima barang, sesuai dengan data sebagai berikut :</div>

    <table class="items-tbl">
      <thead>
        <tr>
          <th style="width:30%">MATERIAL</th>
          <th style="width:15%">GUDANG</th>
          <th style="width:10%">JUMLAH</th>
          <th style="width:10%">SATUAN</th>
          <th style="width:35%">KETERANGAN</th>
        </tr>
      </thead>
      <tbody>${materialRowsTable}</tbody>
    </table>

    <table class="meta-tbl" style="margin-top:6px">
      <tr><td class="lbl">Sesuai Nodin / Surat Permintaan No</td><td style="width:10px">:</td><td>${txn.noNodin || "-"}</td></tr>
      <tr><td class="lbl">Sesuai Surat Persetujuan No</td><td>:</td><td>${txn.noPersetujuan || "-"}</td></tr>
      <tr><td class="lbl">Untuk Pekerjaan</td><td>:</td><td>${txn.namaPekerjaan || txn.pekerjaan || "-"}</td></tr>
    </table>

    <div class="closing-note">Demikian Berita Acara ini kami buat agar dipergunakan sebagaimana mestinya</div>

    <div class="sig-row-2">
      <div class="sig-col">
        <div><i>Yang menerima,</i></div>
        <div class="sig-role">${(txn.penerimaUnit || "PIHAK MENERIMA").toUpperCase()}</div>
        <div class="sig-space"></div>
        <div class="sig-name">${txn.penerimaNama || "....................."}</div>
      </div>
      <div class="sig-col">
        <div><i>Yang menyerahkan,</i></div>
        <div class="sig-role">TL LOG ${uptNama.toUpperCase()}</div>
        <div class="sig-space"></div>
        <div class="sig-name">${menyerahkanUser.name || creator.name || "....................."}</div>
      </div>
    </div>
  </div>
  <div class="bottom-accent"></div>
</div>

<!-- ════════ PAGE 2: LAMPIRAN FOTO 2-KOLOM ════════ -->
<div class="page">
  <div class="top-accent"></div>
  <div class="header-kop">
    <div></div>
    <div class="pln-info">
      <img class="pln-logo" src="${PLN_LOGO_DATA_URI}" alt="Logo PLN"/>
      <div class="kop-text">UNIT INDUK JAWA BAGIAN TIMUR &amp; BALI</div>
      <div class="kop-sub">UNIT PELAKSANA TRANSMISI ${uptNama.toUpperCase()}</div>
    </div>
  </div>

  <div class="page-title-center">Lampiran Foto</div>

  <div class="photo-box-2col">
    <div class="photo-col-cell">
      <div class="cell-title">Foto Kendaraan</div>
      <div class="cell-img-wrap">
        ${txn.fotoKendaraan ? `<img src="${txn.fotoKendaraan}" alt="Foto Kendaraan"/>` : `<div class="photo-empty">&lt;&lt;[Foto Kendaraan pengangkut]&gt;&gt;</div>`}
      </div>
    </div>
    <div class="photo-col-cell">
      <div class="cell-title">SIM / KTP</div>
      <div class="cell-img-wrap">
        ${txn.fotoSimKtp ? `<img src="${txn.fotoSimKtp}" alt="SIM/KTP"/>` : `<div class="photo-empty">&lt;&lt;[Foto SIM/ KTP sopir]&gt;&gt;</div>`}
      </div>
    </div>
  </div>
  <div class="bottom-accent"></div>
</div>

<!-- ════════ PAGE 3: LAMPIRAN FOTO FULL-WIDTH ════════ -->
<div class="page">
  <div class="top-accent"></div>
  <div class="header-kop">
    <div></div>
    <div class="pln-info">
      <img class="pln-logo" src="${PLN_LOGO_DATA_URI}" alt="Logo PLN"/>
      <div class="kop-text">UNIT INDUK JAWA BAGIAN TIMUR &amp; BALI</div>
      <div class="kop-sub">UNIT PELAKSANA TRANSMISI ${uptNama.toUpperCase()}</div>
    </div>
  </div>

  <div class="page-title-center">Lampiran Foto</div>

  <div class="photo-box-full">
    <div class="cell-title" style="margin-bottom:12px">Surat Permintaan / Pengadaan</div>
    <div class="cell-img-wrap-large">
      ${txn.fotoSuratJalanImg || txn.fotoKontrak ? `<img src="${txn.fotoSuratJalanImg || txn.fotoKontrak}" alt="Surat Permintaan"/>` : `<div class="photo-empty">&lt;&lt;[Foto surat jalan]&gt;&gt;</div>`}
    </div>
  </div>
  <div class="bottom-accent"></div>
</div>

<!-- ════════ PAGE 4: LAMPIRAN FOTO BARANG ════════ -->
<div class="page">
  <div class="top-accent"></div>
  <div class="header-kop">
    <div></div>
    <div class="pln-info">
      <img class="pln-logo" src="${PLN_LOGO_DATA_URI}" alt="Logo PLN"/>
      <div class="kop-text">UNIT INDUK JAWA BAGIAN TIMUR &amp; BALI</div>
      <div class="kop-sub">UNIT PELAKSANA TRANSMISI ${uptNama.toUpperCase()}</div>
    </div>
  </div>

  <div class="page-title-center">Lampiran Foto Barang</div>

  <table class="photo-items-tbl">
    <thead>
      <tr>
        <th style="width:35%">Nama Material</th>
        <th>Foto Barang</th>
      </tr>
    </thead>
    <tbody>${materialPhotoRowsTable}</tbody>
  </table>
  <div class="bottom-accent"></div>
</div>

</body></html>`;
}

export function downloadTUG3HTML(txn, katalogList, lokasiList, timMutuList, users, satpamList, showToast, uptList) {
  const html = buildTUG3HTML(txn, katalogList, lokasiList, timMutuList, users, satpamList, uptList);
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

export function downloadTUG9HTML(txn, stocks, users, satpamList, showToast, uptList) {
  const html = buildTUG9HTML(txn, stocks, users, satpamList, uptList);
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

// Lembar barcode/QR kartu gantung (cetak massal) — dipindah dari App.jsx Fase 5e.
// Lembar cetak barcode/QR kartu gantung (5×5 cm/label). QR di-generate LOKAL (library qrcode —
// offline & andal untuk cetak massal), encode katalog.id yang sama dgn label per-1 TUG-2.
export async function buildBarcodeSheetHTML(katalogItems, lokasiByKatalog) {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
  const labels = await Promise.all(katalogItems.map(async (k) => {
    const scanUrl = scanUrlFor(k.id);
    const qr = await QRCode.toDataURL(scanUrl, { margin: 1, width: 220 });
    const lok = (lokasiByKatalog[k.id] || []).join("; ") || "-";
    return `<div class="label"><img src="${qr}" alt="QR"/><div class="nm">${esc(k.name || "-")}</div><div class="kt">No. Kat: ${esc(k.katalog || "-")}</div><div class="meta">${esc(k.jenisBarang || "-")} · ${esc(katalogSapLabel(k))}</div><div class="lk">📍 ${esc(lok)}</div></div>`;
  }));
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"/><title>Cetak Barcode Kartu Gantung — ${labels.length} label</title>
<style>
  @page { size: A4; margin: 8mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; background: #e5e7eb; }
  .bar { position: sticky; top: 0; background: #0b2559; color: #fff; padding: 10px 16px; text-align: center; font-size: 13px; font-weight: 700; z-index: 10; }
  .bar button { background: #16a34a; color: #fff; border: none; border-radius: 6px; padding: 8px 18px; font-size: 13px; font-weight: 700; cursor: pointer; margin-left: 12px; }
  .sheet { display: flex; flex-wrap: wrap; gap: 3mm; padding: 8mm; }
  .label { width: 5cm; height: 5cm; border: 1px dashed #94a3b8; border-radius: 4px; padding: 2.5mm; display: flex; flex-direction: column; align-items: center; text-align: center; background: #fff; page-break-inside: avoid; overflow: hidden; }
  .label img { width: 26mm; height: 26mm; }
  .label .nm { font-size: 7.5px; font-weight: 700; line-height: 1.12; margin-top: 1mm; max-height: 2.3em; overflow: hidden; }
  .label .kt { font-size: 7px; color: #374151; margin-top: 0.5mm; }
  .label .meta { font-size: 6.5px; color: #111; font-weight: 700; margin-top: 0.5mm; }
  .label .lk { font-size: 6.5px; color: #374151; margin-top: auto; max-height: 2.2em; overflow: hidden; line-height: 1.1; }
  @media print { .bar { display: none; } body { background: #fff; } .sheet { padding: 0; } }
</style></head><body>
<div class="bar">🏷️ ${labels.length} label barcode 5×5 cm — potong per kotak, tempel di kartu gantung <button onclick="window.print()">🖨️ Print / Save PDF</button></div>
<div class="sheet">${labels.join("")}</div>
</body></html>`;
}

// ─── TUG-2 DOCUMENT HTML BUILDERS (Kartu Gantung Barang TUG. 2 - Depan & Belakang) ────

// Halaman 1 (Depan): Header + Metadata + Foto Barang + QR Code
export async function buildTUG2FrontHTML(katalog, stocks, lokasiList, subGudangList, gudangList, uptNama) {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
  const scanUrl = scanUrlFor(katalog.id);
  const qrDataUrl = await QRCode.toDataURL(scanUrl, { margin: 1, width: 280 });

  // "Lokasi :" di header kartu = gabungan Gudang + Sub Gudang + Blok Gudang.
  const lokasiStr = resolveLokasiLengkap(katalog, stocks, lokasiList, subGudangList, gudangList);
  const sampleStock = (stocks||[]).find(s=>s.katalogId===katalog.id && s.fotoKeseluruhan);
  const sampleFoto = sampleStock ? resolveStockPhotoUrl(sampleStock.fotoKeseluruhan) : null;
  const kategoriMaterial = (stocks||[]).find(s=>s.katalogId===katalog.id)?.jenisBarang || "-";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Kartu Gantung Depan TUG.2 - ${esc(katalog.katalog)}</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #111; background: #e5e7eb; }
  .bar { position: sticky; top: 0; background: #003087; color: #fff; padding: 8px 14px; text-align: center; font-size: 12px; font-weight: 700; z-index: 10; }
  .bar button { background: #16a34a; color: #fff; border: none; border-radius: 6px; padding: 6px 16px; font-size: 12px; cursor: pointer; margin-left: 10px; }
  .page { padding: 24px; background: white; max-width: 800px; margin: 0 auto 16px; min-height: 100vh; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
  .header-tbl { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  .header-tbl td { vertical-align: top; }
  .meta-tbl { width: 100%; border-collapse: collapse; margin-bottom: 16px; border: 1.5px solid #111; }
  .meta-tbl td { border: 1px solid #111; padding: 6px 8px; font-size: 11px; }
  .meta-tbl .lbl { font-weight: bold; width: 110px; background: #f8fafc; }
  .media-row { display: flex; gap: 16px; margin-bottom: 16px; justify-content: space-between; }
  .media-box { flex: 1; border: 1.5px solid #111; padding: 12px; text-align: center; background: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 220px; }
  .media-title { font-weight: 800; font-size: 12px; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #cbd5e1; width: 100%; padding-bottom: 4px; }
  @media print { .bar { display: none; } body { background: white; } .page { box-shadow: none; margin: 0; max-width: none; padding: 0; } }
</style></head><body>
<div class="bar">📄 Kartu Gantung (Halaman Depan / QR Code) siap dicetak <button onclick="window.print()">🖨️ Print / Save as PDF</button></div>
<div class="page">
  <table class="header-tbl">
    <tr>
      <td style="width:60px">
        <img src="${PLN_LOGO_DATA_URI}" style="height:44px;width:auto" alt="PLN Logo"/>
      </td>
      <td style="padding-left:10px">
        <div style="font-size:11px;font-weight:800;line-height:1.2">PT PLN (PERSERO)</div>
        <div style="font-size:10px;font-weight:700;line-height:1.2">TRANSMISI JAWA BAGIAN TIMUR DAN BALI</div>
        <div style="font-size:9.5px;font-weight:700;color:#334155;line-height:1.2">${(uptNama || UPT).toUpperCase()}</div>
      </td>
      <td style="text-align:right">
        <div style="font-size:14px;font-weight:900;letter-spacing:1px">TUG. 2</div>
      </td>
    </tr>
  </table>

  <div style="text-align:center;margin:12px 0 14px">
    <h2 style="font-size:16px;font-weight:900;text-decoration:underline;letter-spacing:0.5px;text-transform:uppercase">KARTU GANTUNG BARANG</h2>
  </div>

  <table class="meta-tbl">
    <tr>
      <td class="lbl">No. Katalog :</td>
      <td style="font-weight:bold;color:#0284c7">${esc(katalog.katalog || "-")}</td>
      <td class="lbl">Lokasi :</td>
      <td style="font-weight:bold;font-size:9.5px">${esc(lokasiStr)}</td>
    </tr>
    <tr>
      <td class="lbl">No. Aset :</td>
      <td style="font-weight:bold">${esc(katalog.noAset || "-")}</td>
      <td class="lbl">Kategori :</td>
      <td style="font-weight:bold">${esc(kategoriMaterial)}</td>
    </tr>
    <tr>
      <td class="lbl">NAMA BARANG :</td>
      <td colspan="2" style="font-weight:800;font-size:12px;color:#002b66">${esc(katalog.name || "-")}</td>
      <td style="font-weight:bold;text-align:center"><span style="font-size:9px;color:#64748b">SATUAN</span><br/>${esc(katalog.satuan || "BH")}</td>
    </tr>
  </table>

  <div class="media-row">
    <div class="media-box">
      <div class="media-title">FOTO BARANG</div>
      ${sampleFoto ? `<img src="${sampleFoto}" style="max-width:100%;max-height:180px;object-fit:contain;border-radius:4px" alt="Foto Barang"/>` : `<div style="color:#94a3b8;font-size:11px;font-style:italic;padding:40px 0">&lt;&lt; [Foto Barang] &gt;&gt;</div>`}
    </div>
    <div class="media-box">
      <div class="media-title">QR CODE</div>
      <img src="${qrDataUrl}" style="width:160px;height:160px;display:block" alt="QR Code"/>
    </div>
  </div>
</div>
</body></html>`;
}

// Halaman 2 (Belakang): Header + Metadata + Tabel Riwayat Keluar-Masuk (SISA PERSEDIAAN: RAK / PETI / JMLH)
export async function buildTUG2BackHTML(katalog, stocks, txns, lokasiList, subGudangList, gudangList, uptNama) {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
  const history = buildKartuGantungHistory(katalog, txns, stocks, lokasiList, subGudangList, gudangList);

  // "Lokasi :" di header kartu = gabungan Gudang + Sub Gudang + Blok Gudang.
  const lokasiStr = resolveLokasiLengkap(katalog, stocks, lokasiList, subGudangList, gudangList);
  const kategoriMaterial = (stocks||[]).find(s=>s.katalogId===katalog.id)?.jenisBarang || "-";

  const filledHistoryRows = history.map((h) => `
    <tr>
      <td style="border:1px solid #111;padding:6px 6px;text-align:center">${h.tgl ? fmtDateOnly(h.tgl) : "-"}</td>
      <td style="border:1px solid #111;padding:6px 6px">${esc(h.noBon || "-")}</td>
      <td style="border:1px solid #111;padding:6px 6px;text-align:center;font-weight:bold;color:#15803d">${h.masuk > 0 ? fmtNum(h.masuk) : ""}</td>
      <td style="border:1px solid #111;padding:6px 6px;text-align:center;font-weight:bold;color:#b91c1c">${h.keluar > 0 ? fmtNum(h.keluar) : ""}</td>
      <td style="border:1px solid #111;padding:6px 6px;text-align:center">${esc(h.rak || "-")}</td>
      <td style="border:1px solid #111;padding:6px 6px">${esc(h.subGudang || "-")}</td>
      <td style="border:1px solid #111;padding:6px 6px;text-align:center;font-weight:bold">${fmtNum(h.sisa)}</td>
      <td style="border:1px solid #111;padding:6px 6px;color:#475569">${esc(h.catatan || "-")}</td>
    </tr>
  `);

  const minRows = 14;
  for (let i = history.length; i < minRows; i++) {
    filledHistoryRows.push(`
      <tr>
        <td style="border:1px solid #111;height:26px">&nbsp;</td>
        <td style="border:1px solid #111">&nbsp;</td>
        <td style="border:1px solid #111">&nbsp;</td>
        <td style="border:1px solid #111">&nbsp;</td>
        <td style="border:1px solid #111">&nbsp;</td>
        <td style="border:1px solid #111">&nbsp;</td>
        <td style="border:1px solid #111">&nbsp;</td>
        <td style="border:1px solid #111">&nbsp;</td>
      </tr>
    `);
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Riwayat Keluar Masuk TUG.2 - ${esc(katalog.katalog)}</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #111; background: #e5e7eb; }
  .bar { position: sticky; top: 0; background: #003087; color: #fff; padding: 8px 14px; text-align: center; font-size: 12px; font-weight: 700; z-index: 10; }
  .bar button { background: #16a34a; color: #fff; border: none; border-radius: 6px; padding: 6px 16px; font-size: 12px; cursor: pointer; margin-left: 10px; }
  .page { padding: 24px; background: white; max-width: 800px; margin: 0 auto 16px; min-height: 100vh; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
  .header-tbl { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  .header-tbl td { vertical-align: top; }
  .meta-tbl { width: 100%; border-collapse: collapse; margin-bottom: 16px; border: 1.5px solid #111; }
  .meta-tbl td { border: 1px solid #111; padding: 6px 8px; font-size: 11px; }
  .meta-tbl .lbl { font-weight: bold; width: 110px; background: #f8fafc; }
  .items-tbl { width: 100%; border-collapse: collapse; margin-top: 10px; border: 1.5px solid #111; }
  .items-tbl th { background: #f1f5f9; border: 1px solid #111; padding: 6px 4px; font-size: 10px; font-weight: bold; text-align: center; }
  .items-tbl td { border: 1px solid #111; padding: 6px 6px; font-size: 9.5px; }
  @media print { .bar { display: none; } body { background: white; } .page { box-shadow: none; margin: 0; max-width: none; padding: 0; } }
</style></head><body>
<div class="bar">📄 Lembar Riwayat Keluar-Masuk (TUG.2 Belakang) siap dicetak <button onclick="window.print()">🖨️ Print / Save as PDF</button></div>
<div class="page">
  <table class="header-tbl">
    <tr>
      <td style="width:60px">
        <img src="${PLN_LOGO_DATA_URI}" style="height:44px;width:auto" alt="PLN Logo"/>
      </td>
      <td style="padding-left:10px">
        <div style="font-size:11px;font-weight:800;line-height:1.2">PT PLN (PERSERO)</div>
        <div style="font-size:10px;font-weight:700;line-height:1.2">TRANSMISI JAWA BAGIAN TIMUR DAN BALI</div>
        <div style="font-size:9.5px;font-weight:700;color:#334155;line-height:1.2">${(uptNama || UPT).toUpperCase()}</div>
      </td>
      <td style="text-align:right">
        <div style="font-size:14px;font-weight:900;letter-spacing:1px">TUG. 2</div>
      </td>
    </tr>
  </table>

  <div style="text-align:center;margin:12px 0 14px">
    <h2 style="font-size:16px;font-weight:900;text-decoration:underline;letter-spacing:0.5px;text-transform:uppercase">KARTU GANTUNG BARANG</h2>
  </div>

  <table class="meta-tbl">
    <tr>
      <td class="lbl">No. Katalog :</td>
      <td style="font-weight:bold;color:#0284c7">${esc(katalog.katalog || "-")}</td>
      <td class="lbl">Lokasi :</td>
      <td style="font-weight:bold;font-size:9.5px">${esc(lokasiStr)}</td>
    </tr>
    <tr>
      <td class="lbl">No. Aset :</td>
      <td style="font-weight:bold">${esc(katalog.noAset || "-")}</td>
      <td class="lbl">Kategori :</td>
      <td style="font-weight:bold">${esc(kategoriMaterial)}</td>
    </tr>
    <tr>
      <td class="lbl">NAMA BARANG :</td>
      <td colspan="2" style="font-weight:800;font-size:12px;color:#002b66">${esc(katalog.name || "-")}</td>
      <td style="font-weight:bold;text-align:center"><span style="font-size:9px;color:#64748b">SATUAN</span><br/>${esc(katalog.satuan || "BH")}</td>
    </tr>
  </table>

  <div style="font-weight:800;font-size:11px;margin-bottom:6px;color:#002b66">RIWAYAT KELUAR - MASUK BARANG</div>
  <table class="items-tbl">
    <thead>
      <tr>
        <th style="width:75px">TGL</th>
        <th style="width:120px">NO. BON</th>
        <th style="width:60px">MASUK</th>
        <th style="width:60px">KELUAR</th>
        <th style="width:55px">RAK</th>
        <th>LOKASI</th>
        <th style="width:60px">JUMLAH</th>
        <th>CATATAN</th>
      </tr>
    </thead>
    <tbody>
      ${filledHistoryRows.join("")}
    </tbody>
  </table>
</div>
</body></html>`;
}

export async function buildTUG2HTML(katalog, stocks, txns, lokasiList, subGudangList, gudangList) {
  return buildTUG2FrontHTML(katalog, stocks, lokasiList, subGudangList, gudangList);
}


