// ponytail: pure helpers shared between push-kapasitas EF (Deno) and the Node
// self-check script (scripts/check-push-kapasitas-map.mjs). No Deno/Node-only
// APIs here — must run unmodified in both runtimes.

export function clean(s) {
  return String(s ?? "").replace(/\r/g, " ").replace(/\s+/g, " ").trim();
}

// Kunci normalisasi IDENTIK dengan sync-kapasitas: UPT/GUDANG/SUB_GUDANG di-clean()
// lalu uppercase, supaya baris sheet dan payload app (upt mentah "SURABAYA", dst) selalu
// ketemu walau beda kapitalisasi/spasi kecil.
export function buildKey(upt, gudang, subGudang) {
  return [clean(upt).toUpperCase(), clean(gudang).toUpperCase(), clean(subGudang).toUpperCase()].join("|");
}

// gridRows: hasil values API `{title}!A:C` (rows[i] = baris ke i+1 di sheet, 1-based).
// Return Map key -> rowIndex asli di sheet.
export function buildRowMap(gridRows) {
  const map = new Map();
  (gridRows || []).forEach((r, i) => {
    const upt = (r?.[0] || "").trim();
    const gudang = clean(r?.[1]);
    const sub = clean(r?.[2]);
    if (!upt || upt.toUpperCase() === "UPT" || !gudang || !sub) return; // skip header/baris kosong
    map.set(buildKey(upt, gudang, sub), i + 1);
  });
  return map;
}

// Pisah rows payload jadi yang MATCH (update baris existing) vs TIDAK MATCH
// (insert baris baru) — key tak ketemu di rowMap = TL menambah area/gudang baru di app.
export function classifyRows(rows, rowMap) {
  const updates = []; // { item, rowIndex }
  const inserts = []; // { item }
  for (const item of rows || []) {
    const rowIndex = rowMap.get(buildKey(item.upt, item.gudang, item.sub_gudang));
    if (rowIndex) updates.push({ item, rowIndex });
    else inserts.push({ item });
  }
  return { updates, inserts };
}

// Baris EXISTING: update HANYA kolom yang app kelola — H..P (kapasitas) + S (waktu update).
// JANGAN sentuh D/E/F/G/R/T/X (type/alamat/lat/lng/CP/keterangan/link) — itu hasil edit
// manual tim yang tak boleh ketimpa. Angka RAW (bukan string ter-format, locale-safe);
// pct sebagai fraksi 0..1 — sama persis cara sync-kapasitas (`numId`/`pct`) membaca balik.
export function buildUpdateOps(title, rowIndex, item, waktuUpdateLabel) {
  const range = `${title}!H${rowIndex}:P${rowIndex}`;
  const values = [[
    Number(item.luas_lahan_m2) || 0,
    Number(item.luas_terpakai_m2) || 0,
    Number(item.sisa_luas_m2) || 0,
    Number(item.persentase_terpakai) || 0,
    Number(item.persediaan_pct) || 0,
    Number(item.cadang_pct) || 0,
    Number(item.pre_memory_pct) || 0,
    Number(item.attb_pct) || 0,
    Number(item.lainnya_pct) || 0,
  ]];
  return [
    { range, values },
    { range: `${title}!S${rowIndex}`, values: [[waktuUpdateLabel]] },
  ];
}

// Baris BARU (append): isi SEMUA kolom A..X sesuai layout sync-kapasitas
// (r0..r19, r23 — lihat sync-kapasitas/index.ts baris ~92-125 sebagai satu-satunya
// sumber indeks kolom). Kolom yang app tak punya nilainya (Q,U,V,W = r16,r20,r21,r22,
// belum dipakai skema saat ini) dikosongkan "" — jangan diisi sampah.
export function buildInsertRow(item, waktuUpdateLabel) {
  return [
    clean(item.upt),                          // A r0  UPT
    clean(item.gudang),                       // B r1  GUDANG
    clean(item.sub_gudang),                   // C r2  SUB GUDANG
    clean(item.type_gudang ?? ""),            // D r3  type_gudang
    clean(item.alamat ?? ""),                 // E r4  alamat
    item.latitude ?? "",                      // F r5  lat
    item.longitude ?? "",                     // G r6  lng
    Number(item.luas_lahan_m2) || 0,          // H r7
    Number(item.luas_terpakai_m2) || 0,       // I r8
    Number(item.sisa_luas_m2) || 0,           // J r9
    Number(item.persentase_terpakai) || 0,    // K r10
    Number(item.persediaan_pct) || 0,         // L r11
    Number(item.cadang_pct) || 0,             // M r12
    Number(item.pre_memory_pct) || 0,         // N r13
    Number(item.attb_pct) || 0,               // O r14
    Number(item.lainnya_pct) || 0,            // P r15
    "",                                       // Q r16 (belum dipakai skema)
    clean(item.contact_person ?? ""),         // R r17
    waktuUpdateLabel,                         // S r18
    clean(item.keterangan ?? ""),             // T r19
    "", "", "",                               // U,V,W r20-22 (belum dipakai skema)
    clean(item.link_gudang ?? ""),            // X r23
  ];
}
