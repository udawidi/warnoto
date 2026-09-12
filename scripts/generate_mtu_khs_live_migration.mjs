#!/usr/bin/env node
/* Generate only.  Apply the emitted SQL after a human has reviewed the dry-run. */
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import XLSX from "xlsx";
import { parseMtuKhsWorkbook } from "../src/features/mtu-khs/mtuKhsImport.js";
import { normalizeMtuText, validateMtuRecord } from "../src/features/mtu-khs/mtuKhsModel.js";

const SOURCE = process.env.MTU_KHS_SOURCE || "C:/Users/PLN/AppData/Local/Temp/warnoto-mtu-khs-source.xlsx";
const ACTOR = "698b8c8e-be77-4fb2-b06f-d84d7e5b1ed0";
const NON_SITE_BAYS = new Set(["", "-", "SPARE", "PENGGANTIAN UNIT LAIN", "SF6 REGULATOR", "SF6 REGULATOR (GAS FILLING DEVICE) FOR CB"]);

const compact = value => normalizeMtuText(value)
  .replace(/[\r\n]+/g, " ")
  // GIS and GI are distinct assets. Only GITET/GISTET are aliases.
  .replace(/\b(GITET|GISTET)\b/g, "GISTET")
  .replace(/(\d+)\s*K\s*V\b/g, "$1KV")
  .replace(/\s*#\s*/g, "#")
  .replace(/\s*\/\s*/g, "/")
  .replace(/\s+/g, " ").trim();
const orgKey = (value, prefix) => compact(value).replace(new RegExp(`^${prefix}\\s+`), "");
const siteKeys = value => {
  const c = compact(value);
  const variants = [c, c.replace(/\bNEW\s+/g, "NEW"), c.replace(/^(GI|GISTET)\s*(?=\d)/, "$1 ")];
  return [...new Set(variants.map(item => item.replace(/\s+(?=KV\b)/g, "").replace(/\s+/g, " ").trim()))].filter(k => k && k !== "-");
};
const naturalGiKey = value => compact(value).replace(/\bGITET\b/g, "GISTET").replace(/[^A-Z0-9]/g, "");
const naturalBayKey = value => compact(value).replace(/[^A-Z0-9]/g, "");
const bayKeys = value => {
  const c = compact(value);
  const base = [c, c.replace(/\s+PHASA\s+[RST]+$/g, ""), c.replace(/\s+PHASE\s+[RST]+$/g, "")];
  return [...new Set(base.flatMap(item => [compact(item), compact(item).replace(/\s+/g, "")]))].filter(Boolean);
};
const esc = value => `'${String(value ?? "").replaceAll("'", "''")}'`;
const json = value => `${esc(JSON.stringify(value ?? {}))}::jsonb`;
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const stableId = (prefix, ...parts) => `${prefix}-${sha256(parts.map(item => compact(item)).join("|")).slice(0, 24)}`;

function readSpecificationSheet(workbook) {
  const sheet = workbook.Sheets.Spesifikasi;
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false }).slice(2)
    .filter(row => compact(row[0]))
    .map(row => ({
      mtu_code: compact(row[0]),
      data: {
        description: String(row[2] || "").trim(),
        noSapStok: catalogCode(row[5]),
        noSapCadang: catalogCode(row[6]),
      },
    }));
}

function readMasters() {
  if (process.env.MTU_KHS_MASTERS_JSON) return JSON.parse(fs.readFileSync(process.env.MTU_KHS_MASTERS_JSON, "utf8"));
  const sql = `select json_build_object(
    'upt',(select coalesce(json_agg(row_to_json(x)),'[]'::json) from (select id,uit_id,data->>'nama' nama from public.upt) x),
    'ultg',(select coalesce(json_agg(row_to_json(x)),'[]'::json) from (select id,upt_id,data->>'nama' nama from public.ultg) x),
    'gi',(select coalesce(json_agg(row_to_json(x)),'[]'::json) from (select id,upt_id,ultg_id,normalized_name nama,active from public.mtu_khs_gardu_induk) x),
    'bay',(select coalesce(json_agg(row_to_json(x)),'[]'::json) from (select id,gardu_induk_id,normalized_name nama,active from public.mtu_khs_gardu_induk_bay) x),
    'gudang',(select coalesce(json_agg(row_to_json(x)),'[]'::json) from (select id,upt_id,data->>'nama' nama from public.gudang) x),
    'supplier',(select coalesce(json_agg(row_to_json(x)),'[]'::json) from (select id,data->>'nama' nama from public.supplier) x),
    'spec',(select coalesce(json_agg(row_to_json(x)),'[]'::json) from (select id,procurement_year,mtu_code,vendor,data from public.mtu_khs_specs) x),
    'catalog',(select coalesce(json_agg(row_to_json(x)),'[]'::json) from (select id,data from public.katalog) x)
  )::text;`;
  const encoded = Buffer.from(sql, "utf8").toString("base64");
  const remote = `echo ${encoded} | base64 -d | docker exec -i supabase-db psql -U postgres -d postgres -At`;
  return JSON.parse(execFileSync("ssh", ["-o", "ConnectTimeout=15", "minipc-gudang-home", remote], { encoding: "utf8" }).trim());
}

function one(list, predicate) {
  const found = list.filter(predicate);
  return { row: found.length === 1 ? found[0] : null, candidates: found, status: found.length === 1 ? "resolved" : found.length ? "ambiguous" : "unresolved" };
}
function oneNatural(list, predicate, key) {
  const found = list.filter(predicate);
  if (found.length > 1 && new Set(found.map(item => key(item.nama))).size === 1) {
    return { row: [...found].sort((a, b) => Number(b.active === true) - Number(a.active === true) || String(a.id).localeCompare(String(b.id)))[0], candidates: found, status: "resolved" };
  }
  return { row: found.length === 1 ? found[0] : null, candidates: found, status: found.length === 1 ? "resolved" : found.length ? "ambiguous" : "unresolved" };
}
function resolveUpt(masters, source) { return one(masters.upt, item => orgKey(item.nama, "UPT") === orgKey(source, "UPT")); }
function resolveUltg(masters, uptId, source) { return one(masters.ultg.filter(item => item.upt_id === uptId), item => orgKey(item.nama, "ULTG") === orgKey(source, "ULTG")); }
function resolveGi(masters, uptId, ultgId, source) {
  const keys = siteKeys(source);
  return oneNatural(masters.gi.filter(item => item.upt_id === uptId && (!ultgId || item.ultg_id === ultgId)), item => siteKeys(item.nama).some(key => keys.includes(key)), naturalGiKey);
}
function resolveGiByUpt(masters, uptId, source) {
  const keys = siteKeys(source);
  return oneNatural(masters.gi.filter(item => item.upt_id === uptId), item => siteKeys(item.nama).some(key => keys.includes(key)), naturalGiKey);
}
function resolveBay(masters, giId, source) {
  const keys = bayKeys(source);
  return oneNatural(masters.bay.filter(item => item.gardu_induk_id === giId), item => bayKeys(item.nama).some(key => keys.includes(key)), naturalBayKey);
}
function supplierId(masters, provider) {
  const wanted = compact(provider);
  const found = one(masters.supplier, item => {
    const name = compact(item.nama);
    return name === wanted || name.includes(`(${wanted})`) || name.split(/[^A-Z0-9]+/).includes(wanted);
  });
  if (found.row) return { id: found.row.id, sourceOnly: false };
  if (wanted === "HITACHI") return { id: "MTU-SUPPLIER-HITACHI", sourceOnly: true };
  throw new Error(`MTU_SUPPLIER_UNRESOLVED:${provider}`);
}

const catalogCode = value => String(value ?? "").replace(/^0+(?=\d)/, "");
const catalogData = item => item?.data && typeof item.data === "object" ? { ...item, ...item.data } : item || {};
function specForRow(masters, source, year) {
  const code = compact(source.mtuCode);
  const vendor = compact(source.vendor || source.provider);
  const sheetSpec = (masters.specification || []).find(item => compact(item.mtu_code) === code);
  const dbSpec = (masters.spec || []).find(item => Number(item.procurement_year) === year && compact(item.mtu_code) === code && (!item.vendor || compact(item.vendor) === vendor));
  return dbSpec || sheetSpec ? { ...(sheetSpec || {}), ...(dbSpec || {}), data: { ...(sheetSpec?.data || {}), ...(dbSpec?.data || {}) } } : null;
}
function catalogForRow(masters, source, year) {
  if (year !== 2024) return { id: null, warning: null };
  const spec = specForRow(masters, source, year);
  const specData = catalogData(spec);
  const isSpare = compact(source.bayName) === "SPARE";
  const isSf6 = /SF6[-\s]+REGULATOR/.test(compact(source.materialName)) || /SF6[-\s]+REGULATOR/.test(compact(source.mtuCode)) || /SF6[-\s]+REGULATOR/.test(compact(source.bayName));
  const stockCode = isSf6 ? "4190948" : catalogCode(specData.noSapStok || specData.no_sap_stok || specData.noSapPersediaan || specData.no_sap_persediaan || specData.sapStok || specData.sapPersediaan);
  const spareCode = isSf6 ? "1004190948" : catalogCode(specData.noSapCadang || specData.no_sap_cadang || specData.sapCadang);
  const code = isSpare ? spareCode : stockCode;
  const specification = isSf6
    ? { description: "UNIV ACC;SF6 REGULATOR", noSapStok: "4190948", noSapCadang: "1004190948" }
    : { description: specData.description || specData.deskripsi || specData.name || source.materialName, noSapStok: stockCode, noSapCadang: spareCode };
  if (!code) return { id: null, warning: /^STR\b/.test(compact(source.mtuCode)) ? "KATALOG_UNMAPPED_STR" : "KATALOG_UNMAPPED", specification };
  const existing = (masters.catalog || []).find(item => catalogCode(catalogData(item).katalog || catalogData(item).kodeMaterial || item.id?.replace(/^KAT-/, "")) === code);
  return { id: existing?.id || `KAT-${code}`, code, existing, spec, specification, description: specification.description, jenisBarang: isSpare ? "Cadang" : "Persediaan" };
}

function inferRow272(rows) {
  const target = rows.find(row => row.rowNumber === 272);
  if (!target || target.source.mtuCode) return { applied: false, evidence: [] };
  const key = row => [row.source.provider, row.source.uptName, row.source.giName, row.source.materialName].map(compact).join("|");
  const siblings = rows.filter(row => row !== target && key(row) === key(target) && row.source.mtuCode);
  const codes = [...new Set(siblings.map(row => row.source.mtuCode))];
  if (codes.length !== 1 || codes[0] !== "CVT150-007") throw new Error(`MTU_ROW272_INFERENCE_ASSERTION_FAILED:${codes.join(",") || "none"}`);
  target.source.mtuCode = codes[0];
  target.inference = { field: "mtuCode", value: codes[0], evidenceRows: siblings.map(row => row.rowNumber), assertion: "unique provider+UPT+GI+material sibling code" };
  return { applied: true, evidence: siblings.map(row => row.rowNumber) };
}

function mapRows(masters, parsed, year) {
  const rows = parsed.rows.map(row => ({ ...row, source: { ...row.source } }));
  const inference = year === 2024 ? inferRow272(rows) : { applied: false, evidence: [] };
  const missingGi = new Map();
  const missingBay = new Map();
  const reactivatedGi = new Map();
  const reactivatedBay = new Map();
  const missingCatalog = new Map();
  const catalogWarnings = [];
  const mapped = rows.map(row => {
    const source = row.source;
    const upt = resolveUpt(masters, source.uptName);
    if (!upt.row) throw new Error(`MTU_UPT_UNRESOLVED:${year}:${row.rowNumber}:${source.uptName}`);
    const warehouse = /^GUDANG\b/i.test(compact(source.giName));
    const supplier = supplierId(masters, source.provider);
    const catalog = catalogForRow(masters, source, year);
    if (catalog.warning) catalogWarnings.push({ rowNumber: row.rowNumber, warning: catalog.warning });
    if (catalog.code && !catalog.existing) missingCatalog.set(catalog.id, { id: catalog.id, code: catalog.code, description: catalog.description, jenisBarang: catalog.jenisBarang });
    const mappingProvenance = { UPT: { source: source.uptName, targetId: upt.row.id, method: "exact" }, Supplier: { source: source.provider, targetId: supplier.id, method: supplier.sourceOnly ? "source-only" : "exact-or-token" }, Catalog: { source: catalog.code || "", targetId: catalog.id, method: catalog.existing ? "exact" : catalog.code ? "source-upsert" : "unresolved" } };
    const mappedSource = { ...source, uptId: upt.row.id, supplierId: supplier.id, katalogId: catalog.id, catalogNumber: catalog.code || null, materialDescription: catalog.description || null, catalogType: catalog.jenisBarang || null, catalogSpecification: catalog.specification || null, catalogWarning: catalog.warning || null, mappingProvenance };
    if (warehouse) {
      const wanted = compact(source.giName).replace(/^GUDANG\s+/, "");
      const gudang = one(masters.gudang, item => item.upt_id === upt.row.id && compact(item.nama) === wanted);
      if (!gudang.row) throw new Error(`MTU_GUDANG_UNRESOLVED:${year}:${row.rowNumber}:${source.giName}`);
      mappedSource.gudangId = gudang.row.id;
      mappedSource.ultgId = null; mappedSource.garduIndukId = null; mappedSource.bayId = null;
      mappingProvenance.Gudang = { source: source.giName, targetId: gudang.row.id, method: "exact" };
      mappingProvenance.ULTG = { source: source.ultgName, targetId: null, method: "non-site" };
      mappingProvenance.GI = { source: source.giName, targetId: null, method: "non-site" };
      mappingProvenance.Bay = { source: source.bayName, targetId: null, method: "non-site" };
      return { ...row, source: mappedSource };
    }
    let ultg = resolveUltg(masters, upt.row.id, source.ultgName);
    let gi = ultg.row ? resolveGi(masters, upt.row.id, ultg.row.id, source.giName) : resolveGiByUpt(masters, upt.row.id, source.giName);
    let sourceHierarchyConflict = null;
    // Rows 87/248 in the 2026 source have the wrong ULTG label. A unique GI parent is authoritative.
    if (!ultg.row || !gi.row) {
      const giAcrossUpt = resolveGiByUpt(masters, upt.row.id, source.giName);
      if (giAcrossUpt.row) {
        const parent = masters.ultg.find(item => item.id === giAcrossUpt.row.ultg_id);
        if (parent && (!ultg.row || parent.id !== ultg.row.id)) {
          sourceHierarchyConflict = { field: "ULTG", source: source.ultgName, sourceTargetId: ultg.row?.id || null, authoritativeTargetId: parent.id, reason: "unique GI parent" };
          ultg = { row: parent, candidates: [parent], status: "resolved" };
          gi = { row: giAcrossUpt.row, candidates: [giAcrossUpt.row], status: "resolved" };
        }
      }
    }
    if (!ultg.row) throw new Error(`MTU_ULTG_UNRESOLVED:${year}:${row.rowNumber}:${source.ultgName}`);
    if (!gi.row) {
      const name = compact(source.giName);
      if (!name || name === "-") {
        if (!NON_SITE_BAYS.has(compact(source.bayName))) throw new Error(`MTU_GI_REQUIRED:${year}:${row.rowNumber}`);
      } else {
        const id = stableId("MTU-GI-KHS", upt.row.id, ultg.row.id, name);
        const naturalConflict = masters.gi.find(item => item.upt_id === upt.row.id && item.ultg_id === ultg.row.id && naturalGiKey(item.nama) === naturalGiKey(name));
        if (naturalConflict) {
          if (naturalConflict.active === false) reactivatedGi.set(naturalConflict.id, { ...naturalConflict, sourceName: name });
          gi = { row: naturalConflict, candidates: [naturalConflict], status: "resolved" };
        } else {
          const item = { id, upt_id: upt.row.id, ultg_id: ultg.row.id, nama: name, active: true };
          missingGi.set(id, item); masters.gi.push(item); gi = { row: item, candidates: [item], status: "resolved" };
        }
      }
    }
    if (gi.row?.active === false) reactivatedGi.set(gi.row.id, { ...gi.row, sourceName: source.giName });
    mappedSource.ultgId = ultg.row.id;
    mappedSource.garduIndukId = gi.row?.id || null;
    mappedSource.gudangId = null;
    mappingProvenance.ULTG = { source: source.ultgName, targetId: ultg.row.id, method: sourceHierarchyConflict?.field === "ULTG" ? "gi-parent" : "exact" };
    mappingProvenance.GI = { source: source.giName, targetId: gi.row?.id || null, method: !gi.row ? "non-site" : gi.row.id.startsWith("MTU-GI-KHS-") ? "source-upsert" : "exact-or-alias" };
    if (sourceHierarchyConflict) mappedSource.sourceHierarchyConflict = sourceHierarchyConflict;
    const bayLabel = compact(source.bayName);
    if (gi.row && !NON_SITE_BAYS.has(bayLabel)) {
      let bay = resolveBay(masters, gi.row.id, source.bayName);
      if (bay.row?.active === false) reactivatedBay.set(bay.row.id, { ...bay.row, sourceName: source.bayName });
      if (!bay.row) {
        const name = compact(source.bayName);
        const id = stableId("MTU-BAY-KHS", gi.row.id, name);
        const naturalConflict = masters.bay.find(item => item.gardu_induk_id === gi.row.id && naturalBayKey(item.nama) === naturalBayKey(name));
        if (naturalConflict) {
          if (naturalConflict.active === false) reactivatedBay.set(naturalConflict.id, { ...naturalConflict, sourceName: name });
          bay = { row: naturalConflict, candidates: [naturalConflict], status: "resolved" };
        } else {
          const item = { id, gardu_induk_id: gi.row.id, nama: name, active: true };
          missingBay.set(id, item); masters.bay.push(item); bay = { row: item, candidates: [item], status: "resolved" };
        }
      }
      mappedSource.bayId = bay.row.id;
      mappingProvenance.Bay = { source: source.bayName, targetId: bay.row.id, method: bay.row.id.startsWith("MTU-BAY-KHS-") ? "source-upsert" : "exact-or-alias" };
    } else {
      mappedSource.bayId = null;
      mappingProvenance.Bay = { source: source.bayName, targetId: null, method: "non-site" };
    }
    mappingProvenance.Gudang = { source: source.location || "", targetId: null, method: "not-applicable" };
    return { ...row, source: mappedSource };
  });
  return { rows: mapped, missingGi: [...missingGi.values()], missingBay: [...missingBay.values()], missingCatalog: [...missingCatalog.values()], catalogWarnings, reactivatedGi: [...reactivatedGi.values()], reactivatedBay: [...reactivatedBay.values()], inference };
}

function buildSql(sourceSha, yearItems, missingGi, missingBay, missingCatalog, reactivatedGi, reactivatedBay, hitachiNeeded) {
  const all = yearItems.flatMap(item => item.rows);
  const statements = ["begin;", "set local lock_timeout = '15s';"];
  const migrationKey = `MTU-LIVE-${sourceSha.slice(0, 16)}`;
  for (const gi of reactivatedGi) statements.push(`do $migration$ begin if exists (select 1 from public.mtu_khs_gardu_induk where id=${esc(gi.id)} and active=false) then update public.mtu_khs_gardu_induk set active=true, data=coalesce(data,'{}'::jsonb)||${json({ mtuKhsReactivation: { batchKey: migrationKey, previousActive: false, sourceName: gi.sourceName } })}, updated_at=now() where id=${esc(gi.id)}; end if; end $migration$;`);
  for (const bay of reactivatedBay) statements.push(`do $migration$ begin if exists (select 1 from public.mtu_khs_gardu_induk_bay where id=${esc(bay.id)} and active=false) then update public.mtu_khs_gardu_induk_bay set active=true, data=coalesce(data,'{}'::jsonb)||${json({ mtuKhsReactivation: { batchKey: migrationKey, previousActive: false, sourceName: bay.sourceName } })}, updated_at=now() where id=${esc(bay.id)}; end if; end $migration$;`);
  for (const gi of missingGi) statements.push(`do $migration$ begin if exists (select 1 from public.mtu_khs_gardu_induk where id=${esc(gi.id)} and (upt_id is distinct from ${esc(gi.upt_id)} or ultg_id is distinct from ${esc(gi.ultg_id)} or normalized_name is distinct from ${esc(gi.nama)})) then raise exception 'MTU_GI_ID_CONFLICT:%', ${esc(gi.id)}; end if; end $migration$; insert into public.mtu_khs_gardu_induk(id,upt_id,ultg_id,normalized_name,active,data,created_by) values (${esc(gi.id)},${esc(gi.upt_id)},${esc(gi.ultg_id)},${esc(gi.nama)},true,${json({ nama: gi.nama, normalizedName: gi.nama, mtuKhsMigration: true })},null) on conflict (id) do nothing;`);
  for (const bay of missingBay) statements.push(`do $migration$ begin if exists (select 1 from public.mtu_khs_gardu_induk_bay where id=${esc(bay.id)} and (gardu_induk_id is distinct from ${esc(bay.gardu_induk_id)} or normalized_name is distinct from ${esc(bay.nama)})) then raise exception 'MTU_BAY_ID_CONFLICT:%', ${esc(bay.id)}; end if; end $migration$; insert into public.mtu_khs_gardu_induk_bay(id,gardu_induk_id,normalized_name,active,data,created_by) values (${esc(bay.id)},${esc(bay.gardu_induk_id)},${esc(bay.nama)},true,${json({ nama: bay.nama, normalizedName: bay.nama, mtuKhsMigration: true })},null) on conflict (id) do nothing;`);
  for (const catalog of missingCatalog) statements.push(`do $migration$ begin if exists (select 1 from public.katalog where id=${esc(catalog.id)} and coalesce(data->>'katalog','') not in ('',${esc(catalog.code)})) then raise exception 'MTU_KATALOG_ID_CONFLICT:%', ${esc(catalog.id)}; end if; end $migration$; insert into public.katalog(id,data,created_at) values (${esc(catalog.id)},${json({ katalog: catalog.code, name: catalog.description, category: "Lainnya", jenisBarang: catalog.jenisBarang, source: "MTU_KHS_SPEC" })},extract(epoch from now())::bigint) on conflict (id) do nothing;`);
  if (hitachiNeeded) statements.push(`do $migration$ begin if exists (select 1 from public.supplier where id='MTU-SUPPLIER-HITACHI' and data->>'nama' is distinct from 'HITACHI') then raise exception 'MTU_SUPPLIER_ID_CONFLICT:MTU-SUPPLIER-HITACHI'; end if; end $migration$; insert into public.supplier(id,data) values ('MTU-SUPPLIER-HITACHI',${json({ nama: "HITACHI", source: "MTU_KHS_SOURCE_ONLY" })}) on conflict (id) do nothing;`);
  for (const item of yearItems) {
    const batch = `MTU-BATCH-${item.year}-${sourceSha.slice(0, 16)}`;
    statements.push(`insert into public.mtu_khs_import_batches(id,procurement_year,uit_id,source_file,file_sha256,sheet_name,status,summary,created_by,committed_at,commit_idempotency_key) values (${esc(batch)},${item.year},${esc(item.uitId)},${esc(SOURCE)},${esc(sourceSha)},${esc(item.sheetName)},'APPROVED',${json({ migrationActor: "SYSTEM_ON_BEHALF_OF_USER", requestedBy: ACTOR, sourceSha256: sourceSha, committedCount: item.rows.length, physicalQty: item.rows.reduce((sum, row) => sum + row.source.physicalQty, 0) })},${esc(ACTOR)},now(),${esc(`${batch}-LIVE`)}) on conflict (id) do nothing;`);
    for (const row of item.rows) {
      const rawHash = sha256(JSON.stringify(row.rawData || {}));
      const recordId = `MTU-KHS-${item.year}-${row.rowNumber}-${rawHash.slice(0, 16)}`;
      const specId = row.source.mtuCode ? stableId("MTU-SPEC-KHS", item.year, row.source.mtuCode, row.source.vendor) : null;
      const normalized = { ...row.source, mtuSpecId: specId, katalogId: row.source.katalogId || null, mappingProvenance: { ...(row.source.mappingProvenance || {}), Spec: { source: row.source.mtuCode || "", targetId: specId, method: specId ? "deterministic-source" : "not-applicable" } }, _migration: { batchKey: batch, migrationActor: "SYSTEM_ON_BEHALF_OF_USER", requestedBy: ACTOR, sourceRow: row.rowNumber, rawRowSha256: rawHash, inference: row.inference || null, sourceHierarchyConflict: row.source.sourceHierarchyConflict || null } };
      const warnings = row.source.catalogWarning ? [row.source.catalogWarning] : [];
      statements.push(`insert into public.mtu_khs_import_rows(id,batch_id,source_row,raw_data,normalized_data,validation_errors,validation_warnings,duplicate_candidate,raw_row_sha256) values (${esc(`${batch}-${row.rowNumber}`)},${esc(batch)},${row.rowNumber},${json(row.rawData)},${json(normalized)},'[]'::jsonb,${json(warnings)},false,${esc(rawHash)}) on conflict (id) do nothing;`);
      if (specId) statements.push(`insert into public.mtu_khs_specs(id,procurement_year,mtu_code,vendor,katalog_id,mapping_status,data) values (${esc(specId)},${item.year},${esc(normalized.mtuCode)},${esc(normalized.vendor)},null,'APPROVED',${json({ mtuKhsMigration: true, batchKey: batch, provider: normalized.provider, ...(normalized.catalogSpecification || {}) })}) on conflict (procurement_year,mtu_code,vendor) do update set mapping_status='APPROVED', data=coalesce(public.mtu_khs_specs.data,'{}'::jsonb)||excluded.data;`);
      statements.push(`insert into public.mtu_khs_records(id,upt_id,ultg_id,gardu_induk_id,bay_id,gudang_id,mtu_spec_id,katalog_id,supplier_id,procurement_year,sifat_pekerjaan,qty,data,created_by) values (${esc(recordId)},${esc(normalized.uptId)},nullif(${esc(normalized.ultgId)},''),nullif(${esc(normalized.garduIndukId)},''),nullif(${esc(normalized.bayId)},''),nullif(${esc(normalized.gudangId)},''),${specId ? esc(specId) : "null"},${normalized.katalogId ? esc(normalized.katalogId) : "null"},${esc(normalized.supplierId)},${item.year},${esc(normalized.sifatPekerjaan)},${Number(normalized.physicalQty || 0)},${json(normalized)},${esc(ACTOR)}) on conflict (id) do nothing;`);
    }
  }
  const batchList = yearItems.map(item => esc(`MTU-BATCH-${item.year}-${sourceSha.slice(0, 16)}`)).join(",");
  statements.push(`do $preflight$ declare total_count integer; y2024_count integer; y2026_count integer; y2024_qty numeric; y2026_qty numeric; begin select count(*) into total_count from public.mtu_khs_records where data->'_migration'->>'batchKey' in (${batchList}); if total_count <> 1070 then raise exception 'MTU_PREFLIGHT_COUNT:%', total_count; end if; select count(*) into y2024_count from public.mtu_khs_records where data->'_migration'->>'batchKey' = ${esc(`MTU-BATCH-2024-${sourceSha.slice(0, 16)}`)}; select count(*) into y2026_count from public.mtu_khs_records where data->'_migration'->>'batchKey' = ${esc(`MTU-BATCH-2026-${sourceSha.slice(0, 16)}`)}; if y2024_count <> 713 or y2026_count <> 357 then raise exception 'MTU_PREFLIGHT_YEAR_COUNT:%/%', y2024_count, y2026_count; end if; select coalesce(sum(qty),0) into y2024_qty from public.mtu_khs_records where data->'_migration'->>'batchKey' = ${esc(`MTU-BATCH-2024-${sourceSha.slice(0, 16)}`)}; select coalesce(sum(qty),0) into y2026_qty from public.mtu_khs_records where data->'_migration'->>'batchKey' = ${esc(`MTU-BATCH-2026-${sourceSha.slice(0, 16)}`)}; if y2024_qty <> 1501 or y2026_qty <> 526 then raise exception 'MTU_PREFLIGHT_QTY:%/%', y2024_qty, y2026_qty; end if; if exists (select 1 from public.mtu_khs_records r where r.data->'_migration'->>'batchKey' in (${batchList}) and (r.gardu_induk_id is not null and not exists (select 1 from public.mtu_khs_gardu_induk gi where gi.id=r.gardu_induk_id and gi.upt_id=r.upt_id and gi.ultg_id=r.ultg_id) or r.bay_id is not null and not exists (select 1 from public.mtu_khs_gardu_induk_bay bay join public.mtu_khs_gardu_induk gi on gi.id=bay.gardu_induk_id where bay.id=r.bay_id and gi.id=r.gardu_induk_id and gi.upt_id=r.upt_id))) then raise exception 'MTU_PREFLIGHT_CROSS_HIERARCHY'; end if; if exists (select 1 from public.mtu_khs_import_rows ir join public.mtu_khs_import_batches b on b.id=ir.batch_id where b.id in (${batchList}) and jsonb_array_length(public.mtu_khs_validate_import_row(ir.normalized_data,b.uit_id)->'errors') > 0) then raise exception 'MTU_PREFLIGHT_VALIDATION_ERRORS'; end if; end $preflight$;`);
  statements.push("commit;");
  return statements.join("\n");
}

function buildRollback(sourceSha, years, missingGi, missingBay, missingCatalog = []) {
  const batches = years.map(year => `MTU-BATCH-${year}-${sourceSha.slice(0, 16)}`);
  const inList = batches.map(esc).join(",");
  const bayList = missingBay.map(item => esc(item.id)).join(",") || "null";
  const giList = missingGi.map(item => esc(item.id)).join(",") || "null";
  const catalogList = missingCatalog.map(item => esc(item.id)).join(",") || "null";
  const reactivationBatch = esc(`MTU-LIVE-${sourceSha.slice(0, 16)}`);
    return `begin;\n-- Generated rollback. It refuses to remove masters still referenced outside this migration.\ndelete from public.mtu_khs_records where data->'_migration'->>'batchKey' in (${inList});\ndelete from public.mtu_khs_import_rows where batch_id in (${inList});\ndelete from public.mtu_khs_import_batches where id in (${inList});\ndelete from public.mtu_khs_specs where data->>'mtuKhsMigration' = 'true' and data->>'batchKey' in (${inList}) and not exists (select 1 from public.mtu_khs_records r where r.mtu_spec_id = mtu_khs_specs.id);\nupdate public.mtu_khs_gardu_induk_bay set active=false, updated_at=now() where data->'mtuKhsReactivation'->>'batchKey' = ${reactivationBatch} and data->'mtuKhsReactivation'->>'previousActive' = 'false' and not exists (select 1 from public.mtu_khs_records r where r.bay_id = mtu_khs_gardu_induk_bay.id);\nupdate public.mtu_khs_gardu_induk set active=false, updated_at=now() where data->'mtuKhsReactivation'->>'batchKey' = ${reactivationBatch} and data->'mtuKhsReactivation'->>'previousActive' = 'false' and not exists (select 1 from public.mtu_khs_records r where r.gardu_induk_id = mtu_khs_gardu_induk.id);\ndelete from public.mtu_khs_gardu_induk_bay where data->>'mtuKhsMigration' = 'true' and id in (${bayList}) and not exists (select 1 from public.mtu_khs_records r where r.bay_id = mtu_khs_gardu_induk_bay.id);\ndelete from public.mtu_khs_gardu_induk where data->>'mtuKhsMigration' = 'true' and id in (${giList}) and not exists (select 1 from public.mtu_khs_records r where r.gardu_induk_id = mtu_khs_gardu_induk.id);\ndelete from public.katalog where id in (${catalogList}) and data->>'source' = 'MTU_KHS_SPEC' and not exists (select 1 from public.mtu_khs_records r where r.katalog_id = katalog.id) and not exists (select 1 from public.stock_current s where s.katalog_id = katalog.id);\ndelete from public.supplier where id = 'MTU-SUPPLIER-HITACHI' and data->>'source' = 'MTU_KHS_SOURCE_ONLY' and not exists (select 1 from public.mtu_khs_records where supplier_id = supplier.id);\ncommit;\n`;
}

export { compact, siteKeys, resolveGiByUpt, mapRows, buildSql, buildRollback, inferRow272, catalogForRow, specForRow, readSpecificationSheet, NON_SITE_BAYS, readMasters };

function main() {
  const workbook = XLSX.read(fs.readFileSync(SOURCE), { type: "buffer", cellDates: false, raw: false });
  const sourceSha = sha256(fs.readFileSync(SOURCE));
  const masters = readMasters();
  masters.specification = readSpecificationSheet(workbook);
  const yearItems = [];
  for (const [year, sheetName] of [[2024, "Input KHS 2024"], [2026, "Input KHS 2026"]]) {
    const parsed = parseMtuKhsWorkbook({ SheetNames: [sheetName], Sheets: { [sheetName]: workbook.Sheets[sheetName] } }, { procurementYear: year });
    const result = mapRows(masters, parsed, year);
    const uitIds = [...new Set(result.rows.map(row => masters.upt.find(item => item.id === row.source.uptId)?.uit_id).filter(Boolean))];
    if (uitIds.length !== 1) throw new Error(`MTU_BATCH_UIT_NOT_UNIQUE:${year}:${uitIds.join(",") || "none"}`);
    for (const row of result.rows) {
      const check = validateMtuRecord(row.source);
      const nonSite = NON_SITE_BAYS.has(compact(row.source.bayName)) && (!row.source.garduIndukId || compact(row.source.giName) === "-");
      const errors = nonSite ? check.errors.filter(error => error !== "GI belum dipetakan ke master GI") : check.errors;
      if (errors.length) throw new Error(`MTU_PREFLIGHT_VALIDATION:${year}:${row.rowNumber}:${errors.join(",")}`);
      if (row.source.garduIndukId && (!row.source.ultgId || !masters.gi.find(item => item.id === row.source.garduIndukId && item.upt_id === row.source.uptId && item.ultg_id === row.source.ultgId))) throw new Error(`MTU_PREFLIGHT_GI_HIERARCHY:${year}:${row.rowNumber}`);
      if (row.source.bayId && (!row.source.garduIndukId || !masters.bay.find(item => item.id === row.source.bayId && item.gardu_induk_id === row.source.garduIndukId))) throw new Error(`MTU_PREFLIGHT_BAY_HIERARCHY:${year}:${row.rowNumber}`);
      if (row.source.gudangId && (row.source.garduIndukId || row.source.bayId || !masters.gudang.find(item => item.id === row.source.gudangId && item.upt_id === row.source.uptId))) throw new Error(`MTU_PREFLIGHT_GUDANG_HIERARCHY:${year}:${row.rowNumber}`);
    }
    yearItems.push({ year, sheetName, rows: result.rows, inference: result.inference, uitId: uitIds[0], missingCatalog: result.missingCatalog, catalogWarnings: result.catalogWarnings, reactivatedGi: result.reactivatedGi, reactivatedBay: result.reactivatedBay });
  }
  const missingGi = [...new Map(yearItems.flatMap(item => item.rows).filter(row => row.source.garduIndukId?.startsWith("MTU-GI-KHS-")).map(row => [row.source.garduIndukId, { id: row.source.garduIndukId, upt_id: row.source.uptId, ultg_id: row.source.ultgId, nama: compact(row.source.giName) }])).values()];
  const missingBay = [...new Map(yearItems.flatMap(item => item.rows).filter(row => row.source.bayId?.startsWith("MTU-BAY-KHS-")).map(row => [row.source.bayId, { id: row.source.bayId, gardu_induk_id: row.source.garduIndukId, nama: compact(row.source.bayName) }])).values()];
  const reactivatedGi = [...new Map(yearItems.flatMap(item => item.reactivatedGi || []).map(item => [item.id, item])).values()];
  const reactivatedBay = [...new Map(yearItems.flatMap(item => item.reactivatedBay || []).map(item => [item.id, item])).values()];
  const missingCatalog = [...new Map(yearItems.flatMap(item => item.missingCatalog || []).map(item => [item.id, item])).values()];
  const hitachiNeeded = yearItems.some(item => item.rows.some(row => row.source.provider === "HITACHI" && row.source.supplierId === "MTU-SUPPLIER-HITACHI"));
  const sql = buildSql(sourceSha, yearItems, missingGi, missingBay, missingCatalog, reactivatedGi, reactivatedBay, hitachiNeeded);
  const rollback = buildRollback(sourceSha, [2024, 2026], missingGi, missingBay, missingCatalog);
  const out = process.env.MTU_KHS_SQL_OUT || `supabase/migrations/20260912d_mtu_khs_live_${sourceSha.slice(0, 12)}.sql`;
  const rollbackOut = out.replace(/\.sql$/, ".rollback.sql");
  if (process.argv.includes("--emit")) { fs.writeFileSync(out, sql); fs.writeFileSync(rollbackOut, rollback); }
  const conflicts = yearItems.flatMap(item => item.rows.map(row => row.source.sourceHierarchyConflict).filter(Boolean));
  console.log(JSON.stringify({ sourceSha256: sourceSha, years: Object.fromEntries(yearItems.map(item => [item.year, { uitId: item.uitId, rows: item.rows.length, physicalQty: item.rows.reduce((sum, row) => sum + row.source.physicalQty, 0), validationErrors: 0, catalogWarnings: (item.catalogWarnings || []).length, inference: item.inference } ])), totalRows: yearItems.reduce((sum, item) => sum + item.rows.length, 0), missingGi: missingGi.length, missingGiNames: missingGi.map(item => item.nama), missingBay: missingBay.length, missingCatalog: missingCatalog.length, missingCatalogCodes: missingCatalog.map(item => item.code), reactivatedGi: reactivatedGi.length, reactivatedGiNames: reactivatedGi.map(item => item.nama), reactivatedBay: reactivatedBay.length, reactivatedBayNames: reactivatedBay.map(item => item.nama), sourceHierarchyConflict: { total: conflicts.length, GI: conflicts.filter(item => item.field === "GI").length, ULTG: conflicts.filter(item => item.field === "ULTG").length }, hitachiSourceOnly: hitachiNeeded, sql: out, rollback: rollbackOut, emitted: process.argv.includes("--emit") }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
