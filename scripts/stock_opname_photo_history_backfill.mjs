// Backfill final Stock Opname photos into stock primary photos + photoHistory.
// Dry-run is the default. --write is explicit and must follow a reviewed report.
import { createClient } from "@supabase/supabase-js";
import { archiveAndPromoteOpnamePhoto, resolveOpnamePhotoTarget } from "../src/lib/stockOpnamePhotoHistory.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY; no secret is stored in this repository.");
const write = process.argv.includes("--write");
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const report = { sessions: 0, exact: 0, fallback: 0, mismatch: 0, ambiguous: 0, missing: 0, promoted: 0, skipped: 0, written: 0 };

const rowStock = row => ({ ...(row?.data || {}), id: row?.id, uptId: row?.upt_id || row?.data?.uptId });

async function main() {
  const [{ data: opnameRows, error: opnameError }, { data: stockRows, error: stockError }] = await Promise.all([
    supabase.from("stock_opname").select("id,upt_id,data").eq("status", "SELESAI"),
    supabase.from("stocks").select("id,upt_id,data"),
  ]);
  if (opnameError) throw opnameError;
  if (stockError) throw stockError;
  const workingStocks = new Map((stockRows || []).map(row => {
    const stock = rowStock(row);
    return [`${stock.uptId}\u0000${stock.id}`, stock];
  }));
  const finalUpdates = new Map();
  const sortedOpnameRows = [...(opnameRows || [])].sort((a, b) => {
    const time = row => {
      const raw = row.data?.approvedAtAsman || row.data?.updatedAt || row.data?.tanggal || row.data?.dibuatAt;
      const numeric = Number(raw);
      return Number.isFinite(numeric) && numeric > 0 ? numeric : (Date.parse(raw || "") || 0);
    };
    return time(a) - time(b) || String(a.id).localeCompare(String(b.id));
  });
  for (const row of sortedOpnameRows) {
    const opname = { ...(row.data || {}), id: row.id, uptId: row.upt_id || row.data?.uptId };
    if (!opname.uptId) { report.missing++; continue; }
    report.sessions++;
    for (const item of opname.items || []) {
      if (!(Number(item.qtsFisik) > 0)) continue;
      const target = resolveOpnamePhotoTarget(item, [...workingStocks.values()], opname);
      if (!target.stock) {
        report[target.reason === "upt_mismatch" ? "mismatch" : target.reason === "ambiguous" ? "ambiguous" : "missing"]++;
        continue;
      }
      if (target.reason === "exact") report.exact++;
      else report.fallback++;
      const currentKey = `${target.stock.uptId}\u0000${target.stock.id}`;
      const current = workingStocks.get(currentKey) || target.stock;
      const result = archiveAndPromoteOpnamePhoto(current, item, opname, Number(opname.approvedAtAsman || opname.updatedAt || Date.now()));
      if (!result.changed) { report.skipped++; continue; }
      workingStocks.set(currentKey, result.stock);
      finalUpdates.set(currentKey, result.stock);
      if (!write) console.log(`[dry-run] ${row.id} → ${target.stock.id}`);
    }
  }
  for (const [key, next] of finalUpdates) {
    const id = next.id;
    report.promoted++;
    if (!write) continue;
    const originalRow = (stockRows || []).find(candidate => candidate.id === id && candidate.upt_id === next.uptId);
    if (!originalRow) { report.mismatch++; continue; }
    const originalData = originalRow.data || {};
    const mergedData = { ...originalData };
    for (const field of ["fotoKeseluruhan", "fotoNameplate", "fotoNameplateOcr", "photoHistory"]) {
      if (Object.prototype.hasOwnProperty.call(next, field)) mergedData[field] = next[field];
    }
    const { error } = await supabase.from("stocks").update({ data: mergedData }).eq("id", id).eq("upt_id", next.uptId);
    if (error) throw error;
    report.written++;
  }
  console.log(JSON.stringify({ write, ...report }));
}

await main();
