// Render MURNI (tanpa network/Deno) — bisa diimpor node (test) dan index.ts.
// Tiap baris meta OPSIONAL: field kosong/null -> baris tidak dicetak (tak ada "undefined").
// Blok dipisah SEP hanya kalau blok di atas & bawahnya sama-sama ada isi (lihat assemble()).

const SEP = "━━━━━━━━━━━━━━━━━━━━";
const LINK = "https://pln.warnoto.com";
const MAX_ITEMS = 8;

const DOC_LABELS = {
  TUG9: "TUG-9 Pengeluaran",
  TUG8: "TUG-8 Pengeluaran",
  TUG3: "TUG-3 Penerimaan",
  TUG10: "TUG-10 Penerimaan",
  TUG5: "TUG-5 Reservasi Material",
};

export function docLabelFor(docType) {
  return DOC_LABELS[docType] || docType || "Dokumen";
}

function header(data) {
  const label = data.docLabel || docLabelFor(data.docType);
  let title;
  if (data.eventType === "PENDING") {
    title = `⏳ *${label} — MENUNGGU PERSETUJUAN ASMAN*`;
  } else if (data.arah === "RESERVASI") {
    title = `📋 *${label}*`;
  } else if (data.arah === "MASUK") {
    title = `📥 *${label} — DISETUJUI FINAL*`;
  } else {
    title = `📦 *${label} — DISETUJUI FINAL*`;
  }
  const lines = [title];
  if (data.docNumber) lines.push(`No. Dokumen: *${data.docNumber}*`);
  return lines;
}

function join(parts) {
  return parts.filter(Boolean).join(" · ");
}

function metaLines(data) {
  const L = [];

  const lokasiParts = [];
  // Nama master upt SUDAH mengandung prefix "UPT " (mis. "UPT Surabaya") — jangan dobel.
  if (data.uptNama) lokasiParts.push(/^upt\b/i.test(data.uptNama) ? data.uptNama : `UPT ${data.uptNama}`);
  if (data.gudang) lokasiParts.push(`Gudang ${data.gudang}`);
  if (lokasiParts.length) L.push(`🏭 ${join(lokasiParts)}`);

  if (data.tanggal) L.push(`🗓️ ${data.tanggal}`);
  if (data.pekerjaan) L.push(`🔧 Pekerjaan: ${data.pekerjaan}`);
  if (data.lokasi) L.push(`📍 Lokasi: ${data.lokasi}`);

  if (data.arah === "MASUK") {
    const k = data.kontrak;
    if (k && (k.nama || k.noSP || k.pt)) {
      L.push(`📝 Kontrak: ${join([k.nama, k.noSP && `No.SP ${k.noSP}`, k.pt])}`);
    }
    const a = data.asal;
    if ((a && (a.vendor || a.pic)) || data.kendaraan) {
      L.push(`🚚 ${join([a?.vendor && `Asal/Vendor: ${a.vendor}`, a?.pic && `PIC ${a.pic}`, data.kendaraan && `Nopol ${data.kendaraan}`])}`);
    }
  } else if (data.arah !== "RESERVASI") {
    if (data.penerima) L.push(`📤 Tujuan: ${data.penerima}`);
    if (data.kendaraan || data.pengemudi) {
      L.push(`🚚 ${join([data.kendaraan && `Kendaraan: ${data.kendaraan}`, data.pengemudi && `Pengemudi: ${data.pengemudi}`])}`);
    }
  } else if (data.penerima) {
    L.push(`📤 Pemohon: ${data.penerima}`);
  }

  if (data.eventType === "COMPLETION") {
    if (data.approver || data.tl) {
      L.push(`✅ ${join([data.approver && `Disetujui: ${data.approver}`, data.tl && `TL: ${data.tl}`])}`);
    }
  } else if (data.eventType === "PENDING" && data.pengaju) {
    L.push(`🧾 Diajukan oleh: ${data.pengaju}`);
  }

  return L;
}

function materialBlock(data) {
  const items = data.items || [];
  if (!items.length) return [];
  const total = data.totalItem ?? items.length;
  const L = [`📋 *Material — ${total} item:*`];
  for (const i of items.slice(0, MAX_ITEMS)) {
    L.push(`• ${i.kode || "-"} ${i.nama || "-"} — ${i.qty ?? "-"} ${i.satuan || ""}`.trim());
  }
  if (items.length > MAX_ITEMS) L.push(`_+${items.length - MAX_ITEMS} material lagi_`);
  return L;
}

function footer(data) {
  let penutup;
  if (data.eventType === "PENDING") penutup = "Mohon segera diproses.";
  else if (data.arah === "RESERVASI") penutup = "Cek status reservasi di aplikasi.";
  else if (data.arah === "MASUK") penutup = "Barang telah masuk gudang.";
  else penutup = "Material siap dikeluarkan dari gudang.";
  return [penutup, `👉 Cek/proses di aplikasi: ${LINK}`];
}

export function renderWaMessage(data = {}) {
  const blocks = [header(data), metaLines(data), materialBlock(data), footer(data)].filter(b => b.length);
  return blocks.map(b => b.join("\n")).join(`\n${SEP}\n`);
}
