// Model laporan TUG-15 yang bebas DOM. Dipakai PDF dan Excel agar angka,
// filter, dan caveat konsisten di dua jenis unduhan.

export const MONITORING_HEADERS = [
  "No", "PERIODE", "UNIT", "LOKASI GUDANG", "KODE KATALOG", "DATA KONTRAK", "DESKRIPSI MATERIAL", "MERK", "TYPE", "SATUAN", "STOK AWAL",
  "PERIODE MASUK", "VOLUME", "NOMOR TUG", "TANGGAL TERBIT TUG", "SCAN FILE",
  "PERIODE KELUAR", "VOLUME", "NOMOR TUG & RENCANA PASANG", "TANGGAL TERBIT TUG", "SCAN FILE",
  "STOK AKHIR", "STOK SAP", "STATUS", "JENIS PERGERAKAN (1.Slow Moving/2.Fast Moving/3.Dead Moving)", "UMUR LAMA PENYIMPANAN (<1th/1-3th/>3th)", "KETERANGAN", "WBS", "ANGGARAN", "HARGA SATUAN", "TOTAL NILAI", "NAMA PROYEK", "MERK/TIPE/SERIAL NUMBER", "TANGGAL REALISASI PEMASANGAN", "BA PEMASANGAN", "LOKASI PASANG",
];

const EMPTY_MANUAL_FIELDS = ["stokAwal", "stokAkhir", "stokSap", "status", "jenisPergerakan", "umurPenyimpanan", "wbs", "anggaran", "totalNilai", "serialNumber", "tanggalRealisasi", "baPemasangan"];
const dash = value => (value === undefined || value === null || value === "-" ? "" : String(value).trim());
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;

// Excel menjalankan cell yang diawali = + - @ sebagai formula. Prefix apostrof
// memastikan data transaksi tetap literal tanpa mengubah nilai yang terlihat.
export function sanitizeExcelText(value) {
  if (typeof value === "number" || typeof value === "boolean") return value;
  const text = dash(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function periodOf(row) {
  const date = dash(row.tanggalMutasi || row.eventDate);
  const match = date.match(/^(\d{4})-(\d{2})/);
  if (match) return `${match[1]}${match[2]}`;
  const indonesianDate = date.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (indonesianDate) return `${indonesianDate[3]}${indonesianDate[2]}`;
  const longIndonesianDate = date.match(/^\d{1,2}\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+(\d{4})$/i);
  const month = { januari:"01", februari:"02", maret:"03", april:"04", mei:"05", juni:"06", juli:"07", agustus:"08", september:"09", oktober:"10", november:"11", desember:"12" }[longIndonesianDate?.[1]?.toLowerCase()];
  return month ? `${longIndonesianDate[2]}${month}` : "TANPA_PERIODE";
}

function unique(values) {
  return [...new Set(values.map(dash).filter(Boolean))];
}

function scanReference(row) {
  const refs = unique([row.documentRefs, row.documentNo, row.tugBaDoc]);
  // sync_key/id hanya identitas arsip, bukan bukti ada berkas yang bisa diunduh.
  const hasFile = Boolean(row.fotoBarangUrl || row.attachmentUrl || row.documentFileUrl);
  if (hasFile) return refs.length ? `Tersedia — referensi ${refs.join(" | ")}` : "Tersedia — referensi dokumen";
  return refs.length ? `Referensi dokumen: ${refs.join(" | ")}` : "";
}

function unitTotals(map) {
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, "id")).map(([unit, quantity]) => ({ unit, quantity }));
}

export function formatUnitTotals(totals) {
  return totals.length ? totals.map(({ unit, quantity }) => `${quantity.toLocaleString("id-ID")} ${unit || "satuan"}`).join(" · ") : "—";
}

export function buildTUG15ReportModel(rows, filter = {}, { unitName = "UPT Surabaya" } = {}) {
  const groups = new Map();
  const monthly = new Map();
  const materialTotals = new Map();
  const incomingByUnit = new Map();
  const outgoingByUnit = new Map();
  const requestByUnit = new Map();

  rows.forEach(row => {
    const period = periodOf(row);
    const unit = dash(row.upt) || unitName;
    const location = dash(row.warehouseName) || "Tidak tercatat";
    const materialKey = dash(row.materialKey) || `${dash(row.katalog)}|${dash(row.deskripsi)}`;
    const satuan = dash(row.satuan) || "SATUAN TIDAK TERCATAT";
    const key = [period, materialKey, location].join("\u0001");
    if (!groups.has(key)) {
      groups.set(key, {
        period, materialKey, unit, location, katalog:dash(row.katalog), contract:[], deskripsi:dash(row.deskripsi), merk:dash(row.merk), type:dash(row.type), satuan,
        masuk:0, keluar:0, permintaan:0, masukPeriods:[], masukDocs:[], masukDates:[], masukScans:[], keluarPeriods:[], keluarDocs:[], keluarDates:[], keluarScans:[], notes:[], namaProyek:[], lokasiPasang:[], hargaSatuan:[],
      });
    }
    const group = groups.get(key);
    group.contract.push(row.contractRefs);
    group.notes.push(row.keterangan, row.notes);
    group.namaProyek.push(row.jobName);
    group.lokasiPasang.push(row.workLocation);
    if (num(row.valuasi) > 0) group.hargaSatuan.push(num(row.valuasi));
    const masuk = num(row.masuk);
    const keluar = num(row.keluar);
    const requested = num(row.requestedQty);
    if (masuk > 0) {
      group.masuk += masuk;
      group.masukPeriods.push(period); group.masukDocs.push(row.tugBaDoc || row.documentNo); group.masukDates.push(row.tanggalMutasi); group.masukScans.push(scanReference(row));
      incomingByUnit.set(satuan, (incomingByUnit.get(satuan) || 0) + masuk);
    }
    if (keluar > 0) {
      group.keluar += keluar;
      group.keluarPeriods.push(period); group.keluarDocs.push(row.tugBaDoc || row.documentNo); group.keluarDates.push(row.tanggalMutasi); group.keluarScans.push(scanReference(row));
      outgoingByUnit.set(satuan, (outgoingByUnit.get(satuan) || 0) + keluar);
    }
    if (row.eventKind === "PERMINTAAN" || requested > 0) {
      group.permintaan += requested;
      requestByUnit.set(satuan, (requestByUnit.get(satuan) || 0) + requested);
    }

    const monthKey = `${period}\u0001${satuan}`;
    if (!monthly.has(monthKey)) monthly.set(monthKey, { period, unit:satuan, masuk:0, keluar:0 });
    monthly.get(monthKey).masuk += masuk;
    monthly.get(monthKey).keluar += keluar;
    const materialTotalKey = `${materialKey}\u0001${satuan}`;
    if (!materialTotals.has(materialTotalKey)) materialTotals.set(materialTotalKey, { katalog:dash(row.katalog), deskripsi:dash(row.deskripsi), satuan, masuk:0, keluar:0 });
    materialTotals.get(materialTotalKey).masuk += masuk;
    materialTotals.get(materialTotalKey).keluar += keluar;
  });

  const monitoring = [...groups.values()]
    .sort((a,b) => a.period.localeCompare(b.period) || a.deskripsi.localeCompare(b.deskripsi, "id") || a.location.localeCompare(b.location, "id"))
    .map((group, index) => ({
      no:index + 1, ...group,
      // Jangan mengarang historis/current balance maupun finance/aset yang belum ada sumbernya.
      ...Object.fromEntries(EMPTY_MANUAL_FIELDS.map(field => [field, ""])),
      dataKontrak:unique(group.contract).join(" | "),
      periodeMasuk:unique(group.masukPeriods).join(" | "), nomorMasuk:unique(group.masukDocs).join(" | "), tanggalMasuk:unique(group.masukDates).join(" | "), scanMasuk:unique(group.masukScans).join(" | "),
      periodeKeluar:unique(group.keluarPeriods).join(" | "), nomorKeluar:unique(group.keluarDocs).join(" | "), tanggalKeluar:unique(group.keluarDates).join(" | "), scanKeluar:unique(group.keluarScans).join(" | "),
      keterangan:unique([...group.notes, group.permintaan > 0 ? `Permintaan TUG-5: ${group.permintaan} ${group.satuan} (tidak mengubah saldo)` : ""]).join(" | "),
      namaProyek:unique(group.namaProyek).join(" | "), lokasiPasang:unique(group.lokasiPasang).join(" | "),
      hargaSatuan:[...new Set(group.hargaSatuan)].length === 1 ? [...new Set(group.hargaSatuan)][0] : "",
    }));

  const allMaterialTotals = [...materialTotals.values()].sort((a,b) => a.satuan.localeCompare(b.satuan, "id") || b.keluar-a.keluar || a.deskripsi.localeCompare(b.deskripsi, "id"));
  const topMaterials = [...new Set(allMaterialTotals.map(item => item.satuan))].flatMap(satuan => allMaterialTotals
    .filter(item => item.satuan === satuan)
    .slice(0, 5)
    .map((item, index) => ({ ...item, rankInUnit:index + 1 })));

  return {
    generatedAt:new Date().toISOString(), filter, monitoring, rawRows:rows,
    kpi:{ transactionRows:rows.length, materialGroups:materialTotals.size, masuk:unitTotals(incomingByUnit), keluar:unitTotals(outgoingByUnit), permintaan:unitTotals(requestByUnit) },
    monthly:[...monthly.values()].sort((a,b) => a.period.localeCompare(b.period) || a.unit.localeCompare(b.unit, "id")),
    allMaterialTotals,
    topMaterials,
    hasUndatedRows:rows.some(row => periodOf(row) === "TANPA_PERIODE"),
  };
}

function monitoringValues(row) {
  return [row.no, row.period, row.unit, row.location, row.katalog, row.dataKontrak, row.deskripsi, row.merk, row.type, row.satuan, row.stokAwal,
    row.periodeMasuk, row.masuk || "", row.nomorMasuk, row.tanggalMasuk, row.scanMasuk,
    row.periodeKeluar, row.keluar || "", row.nomorKeluar, row.tanggalKeluar, row.scanKeluar,
    row.stokAkhir, row.stokSap, row.status, row.jenisPergerakan, row.umurPenyimpanan, row.keterangan, row.wbs, row.anggaran, row.hargaSatuan, row.totalNilai, row.namaProyek, row.serialNumber, row.tanggalRealisasi, row.baPemasangan, row.lokasiPasang].map(sanitizeExcelText);
}

export function buildMonitoringWorkbook(XLSX, report) {
  const topHeaders = MONITORING_HEADERS.map((header, index) => (index >= 11 && index <= 20 ? "" : header));
  topHeaders[11] = "MUTASI PENAMBAHAN";
  topHeaders[16] = "MUTASI PENGURANGAN";
  const subHeaders = MONITORING_HEADERS.map((header, index) => (index >= 11 && index <= 20 ? header : ""));
  const ws = XLSX.utils.aoa_to_sheet([
    ["UNIT INDUK TRANSMISI JAWA BAGIAN TIMUR DAN BALI UNIT PELAKSANA TRANSMISI SURABAYA"],
    ["DAFTAR MATERIAL PERSEDIAAN"],
    [`Periode laporan: ${report.filter.dateFrom || "Semua"} s/d ${report.filter.dateTo || "Semua"}`],
    [],
    topHeaders,
    subHeaders,
    ...report.monitoring.map(monitoringValues),
  ]);
  ws["!merges"] = ["A1:AJ1", "A2:AJ2", "A3:AJ3", "A5:A6", "B5:B6", "C5:C6", "D5:D6", "E5:E6", "F5:F6", "G5:G6", "H5:H6", "I5:I6", "J5:J6", "K5:K6", "L5:P5", "Q5:U5", "V5:V6", "W5:W6", "X5:X6", "Y5:Y6", "Z5:Z6", "AA5:AA6", "AB5:AB6", "AC5:AC6", "AD5:AD6", "AE5:AE6", "AF5:AF6", "AG5:AG6", "AH5:AH6", "AI5:AI6", "AJ5:AJ6"].map(XLSX.utils.decode_range);
  ws["!cols"] = [6,10,24,18,16,24,34,14,14,10,13,12,12,20,16,30,12,12,28,16,30,13,12,14,34,25,36,18,18,15,16,28,28,20,20,24].map(wch => ({ wch }));
  ws["!freeze"] = { xSplit:0, ySplit:6 };

  const detailHeaders = ["No", "Sumber", "Jenis Kejadian", "Tanggal", "Periode", "No Katalog", "Deskripsi", "Merk", "Type", "Satuan", "Qty Masuk", "Qty Keluar", "Qty Diminta", "No Dokumen", "Referensi Dokumen", "Data Kontrak", "Lokasi Gudang", "Nama Proyek", "Lokasi Pasang", "Keterangan"];
  const detail = XLSX.utils.aoa_to_sheet([detailHeaders, ...report.rawRows.map((r,index) => [index+1, r.sourceLabel || r.source, r.eventKind, r.tanggalMutasi, periodOf(r), r.katalog, r.deskripsi, r.merk, r.type, r.satuan, num(r.masuk) || "", num(r.keluar) || "", num(r.requestedQty) || "", r.tugBaDoc || r.documentNo, r.documentRefs, r.contractRefs, r.warehouseName || "Tidak tercatat", r.jobName, r.workLocation, r.keterangan || r.notes].map(sanitizeExcelText))]);
  detail["!cols"] = detailHeaders.map((_, index) => ({ wch:[6,10,14,14,10,16,34,12,12,10,12,12,13,24,28,24,18,26,24,34][index] }));

  const info = XLSX.utils.aoa_to_sheet([
    ["INFO LAPORAN TUG-15"], ["Periode", `${report.filter.dateFrom || "Semua"} s/d ${report.filter.dateTo || "Semua"}`], ["Total baris transaksi", report.kpi.transactionRows], ["Grup material/lokasi/bulan", report.monitoring.length], ["Total masuk (dipisah satuan)", formatUnitTotals(report.kpi.masuk)], ["Total keluar (dipisah satuan)", formatUnitTotals(report.kpi.keluar)], ["Permintaan TUG-5 (tidak mengubah saldo)", formatUnitTotals(report.kpi.permintaan)], ["Catatan", "Stok awal/akhir historis, Stok SAP, status/moving/umur, WBS, anggaran, total nilai, serial, tanggal realisasi, dan BA pemasangan dikosongkan untuk pengisian manual karena tidak ada sumber data yang sah."], ["Dibuat", new Date(report.generatedAt).toLocaleString("id-ID")],
  ].map(row => row.map(sanitizeExcelText)));
  info["!cols"] = [{ wch:38 }, { wch:120 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Monitoring Persediaan");
  XLSX.utils.book_append_sheet(wb, detail, "Detail Mutasi");
  XLSX.utils.book_append_sheet(wb, info, "Info Laporan");
  return wb;
}
