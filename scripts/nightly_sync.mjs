// WARNOTO — Sinkron Knowledge Base bot WA/Telegram, jalan tiap malam via GitHub Actions
// (jaminan cadangan tanpa perlu browser Admin terbuka sama sekali).
//
// ARSITEKTUR (revisi 2026-07-12):
//   Sumber data dibaca LANGSUNG dari tabel jsonb hidup di Supabase — sama seperti yang
//   dipakai App.jsx (syncRagChunks / buildKatalogRagContent). Sebelumnya script ini membaca
//   tabel datar `stocks_snapshot` yang diisi oleh browser (fungsi syncStocksSnapshot). Tabel
//   itu ternyata cuma "jembatan" yang baru terisi kalau ada Admin membuka web & mengedit
//   stok (debounce 90 detik). Setelah migrasi skema ke model jsonb (katalog/stocks), jembatan
//   itu sering kosong, sehingga nightly membaca 0 baris LALU menghapus chunk bagus (bug
//   "hapus-basi"). Kejadian nyata 2026-07-12: 212 chunk katalog/faq terhapus. Sekarang nightly
//   mandiri (tidak bergantung stocks_snapshot) + ADA GUARD: kalau sumber (katalog/stocks)
//   kosong, script ABORT sebelum menghapus apa pun.
//
// Cakupan (dari tabel Supabase, tanpa browser):
//   - katalog + stocks (jsonb) -> chunk RAG "katalog" (nama, qty, harga Rupiah, status SAP,
//     lokasi fisik gudang+blok). Isi chunk dibuat PERSIS seperti buildKatalogRagContent di
//     App.jsx supaya nightly & sinkron browser tidak saling menimpa dengan teks berbeda.
//   - ai_faq_curated (jawaban resmi kurasi Admin) -> chunk RAG "faq"
//   - tug15_history 6 bulan terakhir -> chunk RAG ringkas "mutasi"
//   - warnoto_state: top-20 by value + stok kritis (versi "v1-nightly", tanpa TUG pending /
//     rencana kedatangan yang hanya ada di state browser)
//
// Nightly ini SENGAJA hanya menghapus chunk source_type katalog/faq/mutasi (bukan 'txn' —
// itu domain sinkron client-side App.jsx, punya siklus hidup sendiri).
//
// Env vars (GitHub Secrets, sama seperti ml/train_forecast.py):
//   SUPABASE_URL, SUPABASE_SECRET_KEY (service_role), COHERE_API_KEY

import { createClient } from "@supabase/supabase-js";
import { fmtNum, getSAPLabel, buildKatalogRagContent, getKritisAgg } from "../src/lib/ragShared.mjs";
import { cohereEmbed } from "./lib/cohere.mjs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const COHERE_API_KEY = process.env.COHERE_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !COHERE_API_KEY) {
  console.error("Env var SUPABASE_URL / SUPABASE_SECRET_KEY / COHERE_API_KEY belum di-set.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

async function main() {
  console.log("=== WARNOTO nightly_sync mulai ===", new Date().toISOString());

  const [
    { data: katalogRows, error: eKat },
    { data: stockRows, error: eStock },
    { data: lokasiRows, error: eLok },
    { data: gudangRows, error: eGdg },
    { data: faqRows, error: eFaq },
    { data: mutasi, error: eMut },
  ] = await Promise.all([
    supabase.from("katalog").select("id, data"),
    supabase.from("stocks").select("id, katalog_id, lokasi_id, data"),
    supabase.from("lokasi").select("id, data"),
    supabase.from("gudang").select("id, data"),
    supabase.from("ai_faq_curated").select("id, pertanyaan, jawaban").eq("is_active", true),
    supabase.from("tug15_history").select("*").gte("tanggal", new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)).limit(500),
  ]);
  if (eKat) throw eKat;
  if (eStock) throw eStock;
  if (eLok) throw eLok;
  if (eGdg) throw eGdg;
  if (eFaq) throw eFaq;
  if (eMut) throw eMut;

  // GUARD KRITIS: kalau sumber utama (katalog + stocks) kosong, JANGAN lanjut — kalau lanjut,
  // langkah "hapus-basi" di bawah akan menghapus semua chunk katalog/faq/mutasi yang bagus
  // (persis bug 2026-07-12). Lempar error supaya tercatat sebagai ERROR di wa_sync_status,
  // bukan sukses palsu yang mengosongkan knowledge base bot.
  if ((katalogRows || []).length === 0 && (stockRows || []).length === 0) {
    throw new Error("Sumber kosong: tabel katalog & stocks 0 baris. Abort sebelum hapus chunk (guard anti-wipe).");
  }

  // Peta lokasi/gudang untuk resolusi blok + nama gudang (mirror lokasiList/gudangList App.jsx).
  const gudangById = {};
  (gudangRows || []).forEach((r) => { gudangById[r.id] = { id: r.id, nama: r.data?.nama || "" }; });
  const lokasiById = {};
  (lokasiRows || []).forEach((r) => { lokasiById[r.id] = { id: r.id, kode: r.data?.kode || "", gudangId: r.data?.gudangId || "" }; });

  // katalog: ratakan jsonb `data` jadi objek {id, name, katalog, category, jenisBarang, satuan, keterangan}.
  const katalogList = (katalogRows || []).map((r) => {
    const d = r.data || {};
    return { id: r.id, name: d.name || "", katalog: d.katalog || "", category: d.category || "", jenisBarang: d.jenisBarang || "", satuan: d.satuan || "", keterangan: d.keterangan || "" };
  });

  // stocks: ratakan jsonb `data` (kolom katalog_id/lokasi_id dipakai lebih dulu, fallback ke data).
  const stocks = (stockRows || []).map((r) => {
    const d = r.data || {};
    return {
      id: r.id,
      katalogId: r.katalog_id || d.katalogId || null,
      lokasiId: r.lokasi_id || d.lokasiId || null,
      qty: Number(d.qty) || 0,
      price: Number(d.price) || 0,
      name: d.name || "",
      unit: d.unit || "",
      minQty: Number(d.minQty) || 0,
      katalog: d.katalog || "",
      jenisBarang: d.jenisBarang || "",
      lokasi: d.lokasi || "",
    };
  });

  // Agregasi qty+harga per katalogId (jumlah semua lokasi/blok) — mirror App.jsx syncRagChunks.
  const stockByKatalog = {};
  stocks.forEach((s) => {
    if (!s.katalogId) return;
    if (!stockByKatalog[s.katalogId]) stockByKatalog[s.katalogId] = { qty: 0, price: s.price || 0, locations: [] };
    stockByKatalog[s.katalogId].qty += s.qty || 0;
    if (s.qty > 0) {
      const lok = lokasiById[s.lokasiId];
      const gdg = lok?.gudangId ? gudangById[lok.gudangId] : null;
      stockByKatalog[s.katalogId].locations.push({ gudang: gdg?.nama || "", blok: lok?.kode || s.lokasi || "", qty: s.qty || 0 });
    }
  });

  const katalogChunks = katalogList.map((k) => ({
    id: `katalog_${k.id}`,
    source_type: "katalog",
    source_id: k.id,
    content: buildKatalogRagContent(k, stockByKatalog[k.id]),
  }));

  const faqChunks = (faqRows || []).map((f) => ({
    id: `faq_${f.id}`,
    source_type: "faq",
    source_id: String(f.id),
    content: `Pertanyaan: ${f.pertanyaan}\nJawaban resmi (kurasi Admin): ${f.jawaban}`,
  }));

  // Ringkas mutasi per katalog dari tug15_history (tetap valid — tabel ini tidak ikut migrasi).
  const mutasiByKatalog = {};
  (mutasi || []).forEach((m) => {
    if (!mutasiByKatalog[m.katalog_id]) mutasiByKatalog[m.katalog_id] = { masuk: 0, keluar: 0, count: 0 };
    if (m.jenis_transaksi === "MASUK") mutasiByKatalog[m.katalog_id].masuk += Number(m.qty) || 0;
    else mutasiByKatalog[m.katalog_id].keluar += Number(m.qty) || 0;
    mutasiByKatalog[m.katalog_id].count += 1;
  });
  const namaByKatalogId = {};
  katalogList.forEach((k) => { namaByKatalogId[k.id] = k.name; });
  const mutasiChunks = Object.entries(mutasiByKatalog).map(([katalogId, d]) => ({
    id: `mutasi_${katalogId}`,
    source_type: "mutasi",
    source_id: katalogId,
    content: `Ringkasan mutasi 6 bulan terakhir untuk ${namaByKatalogId[katalogId] || katalogId}: Masuk ${fmtNum(d.masuk)}, Keluar ${fmtNum(d.keluar)}, dari ${d.count} transaksi.`,
  }));

  const allChunks = [...katalogChunks, ...faqChunks, ...mutasiChunks];
  console.log(`Total chunk: ${allChunks.length} (${katalogChunks.length} katalog, ${faqChunks.length} faq, ${mutasiChunks.length} mutasi)`);

  const BATCH = 90;
  for (let i = 0; i < allChunks.length; i += BATCH) {
    const batch = allChunks.slice(i, i + BATCH);
    const vectors = await cohereEmbed(batch.map((c) => c.content), "search_document", COHERE_API_KEY);
    const rows = batch.map((c, idx) => ({ ...c, embedding: vectors[idx], updated_at: new Date().toISOString() }));
    const { error } = await supabase.from("rag_chunks").upsert(rows, { onConflict: "id" });
    if (error) throw error;
    console.log(`  embed batch ${i}-${i + batch.length} OK`);
  }

  // Hapus chunk katalog/faq/mutasi lama yang sumbernya sudah tidak ada — TIDAK menyentuh
  // source_type='txn' (domain sinkron client-side App.jsx).
  const currentIds = new Set(allChunks.map((c) => c.id));
  const { data: existing } = await supabase.from("rag_chunks").select("id").in("source_type", ["katalog", "faq", "mutasi"]);
  const toDelete = (existing || []).filter((r) => !currentIds.has(r.id)).map((r) => r.id);
  if (toDelete.length) {
    await supabase.from("rag_chunks").delete().in("id", toDelete);
    console.log(`  hapus ${toDelete.length} chunk basi`);
  }

  // warnoto_state (v1-nightly): top-20 by value + stok kritis — mirror buildWarnotoStateSnapshot
  // App.jsx, subset yang bisa dihitung server-side (tanpa TUG pending / rencana kedatangan).
  const withLokasi = (s) => {
    const lok = lokasiById[s.lokasiId];
    const gdg = lok?.gudangId ? gudangById[lok.gudangId] : null;
    return { gudang: gdg?.nama || "", blok: lok?.kode || s.lokasi || "-" };
  };
  const enriched = stocks.map((s) => ({ ...s, nilai: (s.qty || 0) * (s.price || 0) }));
  const top20 = [...enriched].sort((a, b) => b.nilai - a.nilai).slice(0, 20);
  const kritis = getKritisAgg(enriched); // agregat per katalog — konsisten dgn dashboard App.jsx
  const state_data = {
    generatedAt: new Date().toISOString(),
    generatedBy: "nightly_sync.mjs (cron)",
    totalItem: enriched.length,
    totalNilaiRp: Math.round(enriched.reduce((a, s) => a + s.nilai, 0)),
    top20ByValue: top20.map((s) => ({ nama: s.name, katalog: s.katalog, qty: s.qty, satuan: s.unit, hargaSatuan: s.price, nilaiRp: Math.round(s.nilai), status: getSAPLabel(s.katalog), ...withLokasi(s) })),
    materialKritis: kritis.map((s) => ({ nama: s.name, katalog: s.katalog, qty: s.qty, satuan: s.unit, minQty: s.minQty, ...withLokasi(s) })),
  };
  await supabase.from("warnoto_state").insert({ state_data, version: "v1-nightly" });

  await supabase.from("wa_sync_status").upsert(
    { sync_type: "rag_knowledge_base", last_synced_at: new Date().toISOString(), synced_by: "nightly_sync.mjs", record_count: allChunks.length, status: "OK" },
    { onConflict: "sync_type" }
  );

  console.log("=== WARNOTO nightly_sync selesai ===");
}

main().catch(async (err) => {
  console.error("nightly_sync GAGAL:", err);
  try {
    await supabase.from("wa_sync_status").upsert(
      { sync_type: "rag_knowledge_base", last_synced_at: new Date().toISOString(), synced_by: "nightly_sync.mjs", status: "ERROR", error_message: String(err.message || err) },
      { onConflict: "sync_type" }
    );
  } catch {}
  process.exit(1);
});
