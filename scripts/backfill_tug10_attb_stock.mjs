// Backfill TUG-10 Bongkaran ATTB yang sudah approved tetapi belum masuk stocks.
// DRY-RUN default. Tambahkan --apply untuk menulis dengan service_role.
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import { sourceLotKey } from "../src/lib/sap.js";
import { canonicalKatalogCode } from "../src/lib/normalizeKatalogCode.js";

const APPLY = process.argv.includes("--apply");
const url = process.env.SUPABASE_URL || process.env.NEW_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.NEW_SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("Butuh SUPABASE_URL dan SUPABASE_SECRET_KEY (service_role).");
const sb = createClient(url, key, { auth: { persistSession:false, autoRefreshToken:false } });
const hash = value => crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
const pages = async table => {
  const rows = [];
  for (let from = 0;; from += 1000) {
    const { data, error } = await sb.from(table).select("*").order("id", { ascending:true }).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
};
const rowData = row => row?.data && typeof row.data === "object" ? row.data : row;

const [txnRows, stockRows, katalogRows] = await Promise.all([
  pages("tug10_transactions"), pages("stocks"), pages("katalog"),
]);
const txns = txnRows.map(row => ({ ...rowData(row), id: row.id, status: row.status || rowData(row).status, stage: row.stage || rowData(row).stage, uptId: row.upt_id || rowData(row).uptId }));
const stocks = stockRows.map(row => ({ ...rowData(row), id: row.id, katalogId: row.katalog_id || rowData(row).katalogId, lokasiId: row.lokasi_id || rowData(row).lokasiId }));
const katalog = katalogRows.map(row => ({ ...rowData(row), id: row.id }));
const affected = txns.filter(t => t.docType === "TUG10" && (t.status === "APPROVED" || t.stage === "APPROVED") && (t.stockItems || []).some(si => si.statusMaterial === "Bongkaran ATTB (MTU)"));
const plannedStocks = [];
const plannedKatalog = [];
const skipped = [];
const changes = [];

for (const txn of affected) for (const [idx, si] of txn.stockItems.entries()) {
  if (si.statusMaterial !== "Bongkaran ATTB (MTU)") continue;
  const qty = Number(si.qty) || 0;
  if (qty <= 0 || !txn.lokasiTujuanId || !txn.uptId) { skipped.push({ txn:txn.id, idx, reason:"qty/lokasi/UPT tidak lengkap" }); continue; }
  const effect = `${txn.id}:${idx}`;
  const sourceLot = { key:sourceLotKey({ kind:"TUG10_RETURN", transactionId:txn.id, itemIndex:idx }), kind:"TUG10_RETURN", supplier:txn.menyerahkanUnit || "", sourceTransactionId:txn.id, sourceItemIndex:idx, sourceDocumentNo:txn.docNumbers?.tug10 || txn.id, sourceDate:txn.approvedAt || txn.updatedAt || txn.createdAt || Date.now(), status:"ACTIVE" };
  let kat = si.katalogMode === "existing" ? katalog.find(k => k.id === si.katalogId) : null;
  if (si.katalogMode === "existing" && !kat) { skipped.push({ txn:txn.id, idx, reason:"katalog existing tidak ditemukan" }); continue; }
  if (!kat && si.katalogMode !== "existing" && si.katalogBaru) kat = katalog.find(k => canonicalKatalogCode(k.katalog) === canonicalKatalogCode(si.katalogBaru));
  if (!kat) {
    const id = `KAT-BF-${hash(`${txn.id}:${idx}:kat`)}`;
    kat = { id, katalog:si.katalogBaru || "", name:si.namaBaru || "", category:si.categoryBaru || "Lainnya", satuan:si.satuanBaru || "unit", sapStatus:"Non-SAP", createdAt:Date.now() };
    plannedKatalog.push({ id:kat.id, data:kat, created_at:kat.createdAt || Date.now() });
    katalog.push(kat);
  }
  const matches = stocks.filter(s => s.sourceLot?.key === sourceLot.key);
  const marked = matches.find(s => Number(s._tug10Applied?.[effect]) >= qty);
  if (marked) continue;
  if (matches.some(s => s.sourceLot?.key === sourceLot.key && s.katalogId !== kat.id)) { skipped.push({ txn:txn.id, idx, reason:"sourceLot cocok tetapi katalog berbeda" }); continue; }
  if (matches.length) {
    if (matches.length > 1) { skipped.push({ txn:txn.id, idx, reason:"lebih dari satu sourceLot cocok", stockIds:matches.map(s=>s.id) }); continue; }
    const row = matches[0];
    const already = Number(row._tug10Applied?.[effect]) || 0;
    if (!already) { skipped.push({ txn:txn.id, idx, reason:"sourceLot cocok tanpa marker; perlu review", stockIds:[row.id] }); continue; }
    const next = { ...row, qty:(Number(row.qty)||0) + Math.max(0, qty - already), jenisBarang:"ATTB", sapStatus:"Non-SAP", sourceLot, _tug10Applied:{ ...(row._tug10Applied||{}), [effect]:qty } };
    plannedStocks.push({ id:next.id, katalog_id:next.katalogId, lokasi_id:next.lokasiId, data:next, created_at:next.createdAt || Date.now() });
    changes.push({ txn:txn.id, doc:txn.docNumbers?.tug10 || txn.id, idx, qty:next.qty, upt:txn.uptId, lokasi:txn.lokasiTujuanId, katalogId:kat.id, stockId:next.id, action:"update" });
  } else {
    const ambiguous = stocks.filter(s => s.katalogId === kat.id && s.lokasiId === txn.lokasiTujuanId && s.jenisBarang === "ATTB" && !s.sourceLot?.key);
    if (ambiguous.length) { skipped.push({ txn:txn.id, idx, reason:"stok ATTB manual kandidat cocok; perlu review", stockIds:ambiguous.map(s=>s.id) }); continue; }
    const id = `STK-BF-${hash(`${txn.id}:${idx}`)}`;
    const duplicate = stocks.find(s => s.id === id);
    if (duplicate && duplicate.sourceLot?.key !== sourceLot.key) { skipped.push({ txn:txn.id, idx, reason:"ID deterministic sudah dipakai" }); continue; }
    const next = { id, katalogId:kat.id, lokasiId:txn.lokasiTujuanId, uptId:txn.uptId, qty, minQty:0, price:0, jenisBarang:"ATTB", sapStatus:"Non-SAP", name:kat.name||"", katalog:kat.katalog||"", unit:kat.satuan||"unit", keteranganBarang:si.keteranganBaru||si.keterangan||"", source:"TUG10", sourceLot, img:si.fotoBarangRetur||null, fotoKeseluruhan:si.fotoBarangRetur||null, _tug10Applied:{ [effect]:qty }, createdAt:Date.now() };
    plannedStocks.push({ id, katalog_id:kat.id, lokasi_id:txn.lokasiTujuanId, data:next, created_at:next.createdAt });
    changes.push({ txn:txn.id, doc:txn.docNumbers?.tug10 || txn.id, idx, qty, upt:txn.uptId, lokasi:txn.lokasiTujuanId, katalogId:kat.id, stockId:id, action:"create" });
  }
}

console.log(JSON.stringify({ mode:APPLY ? "APPLY" : "DRY-RUN", approvedTransactions:affected.length, newKatalog:plannedKatalog.length, stockChanges:plannedStocks.length, changes, skipped }, null, 2));
if (!APPLY) { console.log("[DRY-RUN] Tidak menulis. Tambahkan --apply setelah hasil diperiksa."); process.exit(0); }
for (const rows of [plannedKatalog, plannedStocks]) for (let i=0; i<rows.length; i+=200) {
  const table = rows === plannedKatalog ? "katalog" : "stocks";
  const { error } = await sb.from(table).upsert(rows.slice(i, i+200), { onConflict:"id" });
  if (error) throw new Error(`${table}: ${error.message}`);
}
console.log("Backfill selesai.");
