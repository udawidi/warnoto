#!/usr/bin/env node
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import XLSX from "xlsx";
import { parseMtuKhsWorkbook } from "../src/features/mtu-khs/mtuKhsImport.js";
import { normalizeMtuText } from "../src/features/mtu-khs/mtuKhsModel.js";

const sourcePath = process.env.MTU_KHS_SOURCE || "C:/Users/PLN/AppData/Local/Temp/warnoto-mtu-khs-source.xlsx";
const compact = value => normalizeMtuText(value).replace(/(\d+)\s*K\s*V\b/g, "$1 KV").replace(/\bNEW\s+/g, "NEW").replace(/\s*#\s*/g, "#").replace(/\s+/g, " ").trim();
const orgKey = (value, prefix) => compact(value).replace(new RegExp(`^${prefix}\\s+`), "");
const siteKeys = value => [...new Set([compact(value), compact(value).replace(/\b(\d+)\s+KV\b/g, "$1")])].filter(Boolean);
const bayKeys = value => {
  const base = siteKeys(value).flatMap(item => [item, item.replace(/\s+PHASA\s+[RST]+$/g, ""), item.replace(/\s+PHASE\s+[RST]+$/g, "")]);
  return [...new Set(base.flatMap(item => [item, item.replace(/\s+\d+\/\d+\s*KV\b/g, ""), item.replace(/^PHT\s+\d+\s*(?:KV\s+)?/g, "PHT ")]).map(compact))].filter(Boolean);
};
const matchesAnyKey = (value, keys) => siteKeys(value).some(candidate => keys.includes(candidate));

const sql = `select json_build_object(
  'upt',(select coalesce(json_agg(row_to_json(x)), '[]'::json) from (select id,uit_id,data->>'nama' nama from public.upt) x),
  'ultg',(select coalesce(json_agg(row_to_json(x)), '[]'::json) from (select id,upt_id,data->>'nama' nama from public.ultg) x),
  'gi',(select coalesce(json_agg(row_to_json(x)), '[]'::json) from (select id,upt_id,ultg_id,normalized_name nama from public.mtu_khs_gardu_induk where active) x),
  'bay',(select coalesce(json_agg(row_to_json(x)), '[]'::json) from (select id,gardu_induk_id,normalized_name nama from public.mtu_khs_gardu_induk_bay where active) x),
  'gudang',(select coalesce(json_agg(row_to_json(x)), '[]'::json) from (select id,upt_id,data->>'nama' nama from public.gudang) x),
  'supplier',(select coalesce(json_agg(row_to_json(x)), '[]'::json) from (select id,data->>'nama' nama from public.supplier) x),
  'spec',(select coalesce(json_agg(row_to_json(x)), '[]'::json) from (select id,procurement_year,mtu_code,vendor from public.mtu_khs_specs) x),
  'catalog_count',(select count(*) from public.katalog)
)::text;`;
const encodedSql = Buffer.from(sql, "utf8").toString("base64");
const remote = `echo ${encodedSql} | base64 -d | docker exec -i supabase-db psql -U postgres -d postgres -At`;
const masters = JSON.parse(execFileSync("ssh", ["-o", "ConnectTimeout=15", "minipc-gudang-home", remote], { encoding: "utf8" }).trim());

function one(list, predicate) {
  const found = list.filter(predicate);
  return { status: found.length === 1 ? "resolved" : found.length ? "ambiguous" : "unresolved", row: found.length === 1 ? found[0] : null, candidates: found.map(item => item.id) };
}
function supplierMatch(provider) {
  const wanted = compact(provider);
  if (!wanted) return { status: "unresolved", row: null, candidates: [] };
  return one(masters.supplier, item => {
    const name = compact(item.nama);
    if (!name) return false;
    return name === wanted || name.includes(`(${wanted})`) || name.split(/[^A-Z0-9]+/).includes(wanted);
  });
}
function add(result, entity, match, sourceRow, value) {
  result[entity][match.status] += 1;
  if (match.status !== "resolved" && result.examples[entity].length < 10) result.examples[entity].push({ sourceRow, value, status: match.status, candidates: match.candidates });
}

const workbook = XLSX.read(fs.readFileSync(sourcePath), { type: "buffer", cellDates: false, raw: false });
const report = { sourcePath, catalogCount: masters.catalog_count, years: {} };
for (const [year, sheetName] of [[2024, "Input KHS 2024"], [2026, "Input KHS 2026"]]) {
  const parsed = parseMtuKhsWorkbook({ SheetNames: [sheetName], Sheets: { [sheetName]: workbook.Sheets[sheetName] } }, { procurementYear: year });
  const blank = () => ({ resolved: 0, unresolved: 0, ambiguous: 0 });
  const entities = ["upt", "ultg", "gi", "bay", "gudang", "supplier", "spec"];
  const result = { parsed: parsed.rows.length, parserBlockers: parsed.rows.filter(item => !item.validation.valid).length, ...Object.fromEntries(entities.map(entity => [entity, blank()])), examples: Object.fromEntries(entities.map(entity => [entity, []])) };
  for (const item of parsed.rows) {
    const source = item.source;
    const upt = one(masters.upt, row => orgKey(row.nama, "UPT") === orgKey(source.uptName, "UPT"));
    add(result, "upt", upt, item.rowNumber, source.uptName);
    add(result, "supplier", supplierMatch(source.provider), item.rowNumber, source.provider);
    const spec = source.mtuCode ? one(masters.spec, row => Number(row.procurement_year) === year && compact(row.mtu_code) === compact(source.mtuCode) && (!row.vendor || compact(row.vendor) === compact(source.vendor))) : { status: "unresolved", row: null, candidates: [] };
    add(result, "spec", spec, item.rowNumber, source.mtuCode);
    if (upt.status !== "resolved") continue;

    const warehouseName = compact(source.giName).replace(/^GUDANG\s+/, "");
    const isWarehouse = /^GUDANG\b/.test(compact(source.giName));
    if (isWarehouse) {
      add(result, "gudang", one(masters.gudang, row => row.upt_id === upt.row.id && compact(row.nama) === warehouseName), item.rowNumber, source.giName);
      continue;
    }

    const ultg = one(masters.ultg, row => row.upt_id === upt.row.id && orgKey(row.nama, "ULTG") === orgKey(source.ultgName, "ULTG"));
    add(result, "ultg", ultg, item.rowNumber, source.ultgName);
    if (ultg.status !== "resolved") continue;
    const giSourceKeys = siteKeys(source.giName);
    const gi = one(masters.gi, row => row.upt_id === upt.row.id && row.ultg_id === ultg.row.id && matchesAnyKey(row.nama, giSourceKeys));
    add(result, "gi", gi, item.rowNumber, source.giName);
    if (gi.status !== "resolved") continue;
    const baySourceKeys = bayKeys(source.bayName);
    add(result, "bay", one(masters.bay, row => row.gardu_induk_id === gi.row.id && bayKeys(row.nama).some(candidate => baySourceKeys.includes(candidate))), item.rowNumber, source.bayName);
  }
  report.years[year] = result;
}
const output = process.argv.includes("--summary")
  ? { catalogCount: report.catalogCount, years: Object.fromEntries(Object.entries(report.years).map(([year, value]) => [year, Object.fromEntries(Object.entries(value).filter(([key]) => key !== "examples"))])) }
  : report;
console.log(JSON.stringify(output, null, 2));
