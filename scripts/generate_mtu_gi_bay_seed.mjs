#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import xlsx from "xlsx";

const UPT_MAP = Object.freeze({ BALI: "UPT-BLI", GRESIK: "UPT-GRS", MADIUN: "UPT-MDN", MALANG: "UPT-MLG", PROBOLINGGO: "UPT-PBG", SURABAYA: "UPT-SBY" });
const DEFAULT_INPUT = "D:/CLAUDE/WARNOTO data/Data Material HAR/BAY GI.xlsx";
const DEFAULT_OUTPUT = "supabase/migrations/20260912b_mtu_gi_bay_full_seed.sql";

export function normalizeText(value) {
  return String(value ?? "").replace(/^\s*\*+\s*/, "").trim().replace(/\s+/g, " ").toUpperCase();
}
export function normalizeUpt(value) {
  const key = normalizeText(value).replace(/^UPT\s+/, "");
  return UPT_MAP[key] || "";
}
export function normalizeUltg(value) { return normalizeText(value).replace(/^ULTG\s+/, ""); }
export function slug(value) { return normalizeText(value).replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, ""); }
export function deterministicId(prefix, ...parts) {
  const base = `${prefix}-${parts.map(slug).join("-")}`;
  const suffix = crypto.createHash("sha256").update([prefix, ...parts].join("\u001f")).digest("hex").slice(0, 16);
  return `${base.slice(0, 180 - suffix.length - 1)}-${suffix}`;
}

function pick(row, headers, names) {
  const index = names.map(name => headers.findIndex(header => normalizeText(header) === normalizeText(name))).find(index => index >= 0);
  return index === undefined ? "" : row[index];
}
function statusActive(status) { return normalizeText(status) !== "TIDAK OPERASI"; }
function completeScore(item) { return Number(Boolean(item.bayExternalId)) * 4 + Number(Boolean(item.giExternalId)) * 2 + Number(Boolean(item.status)) + Number(item.status === "OPERASI"); }

export function parseWorkbook(workbookPath) {
  const workbook = xlsx.read(fs.readFileSync(workbookPath), { type: "buffer", cellDates: false, raw: false });
  const sheetName = "3a. BAY";
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet tidak ditemukan: ${sheetName}`);
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  const headers = rows[3] || [];
  const parsed = [];
  for (let i = 5; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const uptId = normalizeUpt(pick(row, headers, ["UPT"]));
    const ultgName = normalizeUltg(pick(row, headers, ["ULTG"]));
    const giName = normalizeText(pick(row, headers, ["Nama GI/GIS", "Nama GI", "GI"]));
    const bayName = normalizeText(pick(row, headers, ["Nama Bay", "BAY", "Bay"]));
    if (!uptId && !ultgName && !giName && !bayName) continue;
    if (!uptId || !ultgName || !giName || !bayName) throw new Error(`Hierarchy kosong pada baris ${i + 1}`);
    const status = normalizeText(pick(row, headers, ["Status", "Status Operasi/ Tidak Operasi/ Belum Operasi"]));
    const item = {
      sourceRow: i + 1, uptId, ultgName, giName, bayName,
      giExternalId: String(pick(row, headers, ["ID GI", "ID_GI", "ID GI/GIS", "ID GI/GIS/GITET", "ID_FUNCTLOC GI"]) || "").trim(),
      bayExternalId: String(pick(row, headers, ["ID_FUNCTLOC"]) || "").trim(),
      status, active: statusActive(status),
    };
    parsed.push(item);
  }
  return parsed;
}

export function dedupeRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.uptId}|${row.giName}|${row.bayName}`;
    const current = groups.get(key);
    if (!current) groups.set(key, { ...row, sourceRows: [row.sourceRow] });
    else {
      current.sourceRows.push(row.sourceRow);
      const winner = completeScore(row) > completeScore(current) ? row : current;
      Object.assign(current, winner, { sourceRows: current.sourceRows });
    }
  }
  return [...groups.values()].map(item => ({ ...item, sourceRows: [...new Set(item.sourceRows)].sort((a, b) => a - b) }));
}

export function buildSeed(rows) {
  const deduped = dedupeRows(rows);
  const giMap = new Map();
  for (const row of deduped) {
    const giKey = `${row.uptId}|${row.giName}`;
    let gi = giMap.get(giKey);
    if (!gi) {
      const ultgName = row.giName === "GI 150KV NGIMBANG" && row.uptId === "UPT-MDN" ? "BABAT" : row.ultgName;
      gi = { id: deterministicId("MTU-GI", row.uptId, row.giName), uptId: row.uptId, ultgName, name: row.giName, sourceRows: [], giExternalIds: [], sourceUltgNames: [], bays: [] };
      giMap.set(giKey, gi);
    }
    gi.sourceRows.push(...row.sourceRows);
    if (row.giExternalId) gi.giExternalIds.push(row.giExternalId);
    if (row.ultgName) gi.sourceUltgNames.push(row.ultgName);
    gi.bays.push({ id: deterministicId("MTU-BAY", row.uptId, row.giName, row.bayName), name: row.bayName, active: row.active, status: row.status, externalId: row.bayExternalId, giExternalId: row.giExternalId, sourceRows: row.sourceRows });
  }
  return [...giMap.values()].map(gi => ({
    ...gi,
    sourceRows: [...new Set(gi.sourceRows)].sort((a, b) => a - b),
    giExternalIds: [...new Set(gi.giExternalIds)].sort(),
    sourceUltgNames: [...new Set(gi.sourceUltgNames)].sort(),
    bays: gi.bays.sort((a, b) => a.name.localeCompare(b.name))
  }));
}

function sqlJson(value) { return `$json$${JSON.stringify(value).replaceAll("$json$", "\\u0024json\\u0024")}$json$`; }
export function renderMigration(seed, { sourcePath, sourceSha256 }) {
  const payload = seed.map(gi => ({
    id: gi.id,
    uptId: gi.uptId,
    ultgName: gi.ultgName,
    name: gi.name,
    sourceRows: gi.sourceRows,
    sourceImport: {
      sourceFile: sourcePath,
      sourceSheet: "3a. BAY",
      sourceRows: gi.sourceRows,
      giExternalIds: gi.giExternalIds,
      sourceUltgNames: gi.sourceUltgNames,
      anomalies: gi.sourceUltgNames.filter(name => name !== gi.ultgName).length
        ? [{ type: "ULTG_CONFLICT", selected: gi.ultgName, sourceValues: gi.sourceUltgNames }]
        : []
    },
    bays: gi.bays.map(bay => ({
      id: bay.id,
      name: bay.name,
      active: bay.active,
      status: bay.status,
      externalId: bay.externalId || null,
      giExternalId: bay.giExternalId || null,
      sourceRows: bay.sourceRows,
      sourceImport: {
        sourceFile: sourcePath,
        sourceSheet: "3a. BAY",
        sourceRows: bay.sourceRows,
        externalId: bay.externalId || null,
        giExternalId: bay.giExternalId || null,
        rawStatus: bay.status || null
      }
    }))
  }));
  const escapedSourcePath = sourcePath.replaceAll("'", "''");
  return `-- Generated from ${sourcePath}; additive/idempotent, no deletes.
BEGIN;

INSERT INTO public.mtu_khs_master_seed_runs(seed_key, source_url, source_tab, source_sha256)
VALUES ('20260912-bay-gi-full-v1', 'file://${escapedSourcePath}', '3a. BAY', '${sourceSha256}')
ON CONFLICT (seed_key) DO UPDATE SET source_url = EXCLUDED.source_url, source_tab = EXCLUDED.source_tab, source_sha256 = EXCLUDED.source_sha256;

DO $mtu_full_seed$
DECLARE
  item jsonb;
  bay_item jsonb;
  target_upt text;
  target_ultg text;
  target_gi text;
  target_bay text;
  match_count integer;
BEGIN
  FOR item IN SELECT value FROM jsonb_array_elements(${sqlJson(payload)}::jsonb) LOOP
    target_upt := item->>'uptId';
    IF NOT EXISTS (SELECT 1 FROM public.upt WHERE id = target_upt) THEN
      RAISE EXCEPTION 'MTU_FULL_SEED_UPT_NOT_FOUND:%', target_upt;
    END IF;

    SELECT count(*), min(u.id) INTO match_count, target_ultg
    FROM public.ultg u
    WHERE u.upt_id = target_upt
      AND regexp_replace(upper(regexp_replace(btrim(coalesce(u.data->>'nama', u.data->>'name', u.id)), '[[:space:]]+', ' ', 'g')), '^ULTG[[:space:]]+', '', 'i') = item->>'ultgName';
    IF match_count = 0 THEN
      RAISE EXCEPTION 'MTU_FULL_SEED_ULTG_NOT_FOUND:%/%', target_upt, item->>'ultgName';
    ELSIF match_count <> 1 THEN
      RAISE EXCEPTION 'MTU_FULL_SEED_ULTG_NOT_UNIQUE:%/%/%', target_upt, item->>'ultgName', match_count;
    END IF;

    SELECT count(*), min(gi.id) INTO match_count, target_gi
    FROM public.mtu_khs_gardu_induk gi
    WHERE gi.upt_id = target_upt AND gi.normalized_name = item->>'name';
    IF match_count > 1 THEN
      RAISE EXCEPTION 'MTU_FULL_SEED_GI_NOT_UNIQUE:%/%/%', target_upt, item->>'name', match_count;
    ELSIF match_count = 0 THEN
      IF EXISTS (SELECT 1 FROM public.mtu_khs_gardu_induk gi WHERE gi.id = item->>'id') THEN
        RAISE EXCEPTION 'MTU_FULL_SEED_GI_ID_COLLISION:%', item->>'id';
      END IF;
      target_gi := item->>'id';
      INSERT INTO public.mtu_khs_gardu_induk(id, upt_id, ultg_id, normalized_name, data, created_by)
      VALUES (target_gi, target_upt, target_ultg, item->>'name',
        jsonb_build_object('nama', item->>'name', 'normalizedName', item->>'name', 'sourceImport', item->'sourceImport'), NULL);
    ELSE
      UPDATE public.mtu_khs_gardu_induk
      SET ultg_id = target_ultg,
          active = true,
          data = coalesce(data, '{}'::jsonb) || jsonb_build_object('sourceImport', coalesce(data->'sourceImport', '{}'::jsonb) || item->'sourceImport')
      WHERE id = target_gi;
    END IF;

    FOR bay_item IN SELECT value FROM jsonb_array_elements(item->'bays') LOOP
      SELECT count(*), min(bay.id) INTO match_count, target_bay
      FROM public.mtu_khs_gardu_induk_bay bay
      WHERE bay.gardu_induk_id = target_gi AND bay.normalized_name = bay_item->>'name';
      IF match_count > 1 THEN
        RAISE EXCEPTION 'MTU_FULL_SEED_BAY_NOT_UNIQUE:%/%/%', target_gi, bay_item->>'name', match_count;
      ELSIF match_count = 0 THEN
        IF EXISTS (SELECT 1 FROM public.mtu_khs_gardu_induk_bay bay WHERE bay.id = bay_item->>'id') THEN
          RAISE EXCEPTION 'MTU_FULL_SEED_BAY_ID_COLLISION:%', bay_item->>'id';
        END IF;
        target_bay := bay_item->>'id';
        INSERT INTO public.mtu_khs_gardu_induk_bay(id, gardu_induk_id, normalized_name, active, data, created_by)
        VALUES (target_bay, target_gi, bay_item->>'name', coalesce((bay_item->>'active')::boolean, true),
          jsonb_build_object('nama', bay_item->>'name', 'normalizedName', bay_item->>'name', 'sourceImport', bay_item->'sourceImport'), NULL);
      ELSE
        UPDATE public.mtu_khs_gardu_induk_bay
        SET active = coalesce((bay_item->>'active')::boolean, true),
            data = coalesce(data, '{}'::jsonb) || jsonb_build_object('sourceImport', coalesce(data->'sourceImport', '{}'::jsonb) || bay_item->'sourceImport')
        WHERE id = target_bay;
      END IF;
    END LOOP;
  END LOOP;
END $mtu_full_seed$;
COMMIT;
`;
}

export function generate(inputPath = DEFAULT_INPUT, outputPath = DEFAULT_OUTPUT) {
  const rows = parseWorkbook(inputPath); const seed = buildSeed(rows);
  const sourceSha256 = crypto.createHash("sha256").update(fs.readFileSync(inputPath)).digest("hex");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, renderMigration(seed, { sourcePath: inputPath, sourceSha256 }));
  return { rows: rows.length, gi: seed.length, bay: seed.reduce((sum, item) => sum + item.bays.length, 0), outputPath };
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/generate_mtu_gi_bay_seed.mjs")) {
  const result = generate(process.argv[2] || DEFAULT_INPUT, process.argv[3] || DEFAULT_OUTPUT);
  console.log(JSON.stringify(result));
}
