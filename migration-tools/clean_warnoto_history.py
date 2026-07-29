import argparse
import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import pandas as pd


BLANKS = {"", "-", "--", "N/A", "NA", "NULL", "NONE", "NAN", "0"}


def cell(value):
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    if pd.isna(value):
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def clean_text(value):
    text = cell(value)
    text = re.sub(r"\s+", " ", text).strip()
    return "" if text.upper() in BLANKS else text


def norm_upper(value):
    return clean_text(value).upper()


def normalize_catalog(value):
    raw = clean_text(value)
    if not raw:
        return ""
    raw = raw.replace(".0", "") if re.fullmatch(r"\d+\.0", raw) else raw
    raw = re.sub(r"[^0-9A-Za-z]", "", raw)
    if not raw or raw.upper() in BLANKS:
        return ""
    if raw.isdigit():
        stripped = raw.lstrip("0")
        return stripped or "0"
    return raw.upper()


def normalize_material_name(value):
    text = norm_upper(value)
    if not text:
        return ""
    text = text.replace("；", ";")
    text = re.sub(r"\s*;\s*", ";", text)
    text = re.sub(r"\s+", " ", text)
    text = text.replace("KV", "kV").upper()
    return text


def normalize_unit(value):
    text = norm_upper(value)
    aliases = {
        "BUAH": "BH",
        "PCS": "PCS",
        "PC": "PCS",
        "SET": "SET",
        "UNIT": "U",
        "UN": "U",
        "METER": "M",
    }
    return aliases.get(text, text)


def parse_qty(value):
    raw = clean_text(value)
    if not raw:
        return None
    raw = raw.replace(",", ".") if raw.count(",") == 1 and raw.count(".") == 0 else raw
    raw = re.sub(r"[^0-9.\-]", "", raw)
    if raw in {"", "-", "."}:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def parse_date(value):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    if isinstance(value, (pd.Timestamp, datetime)):
        return pd.Timestamp(value).strftime("%Y-%m-%d")
    raw = clean_text(value)
    if not raw:
        return ""
    parsed = pd.to_datetime(raw, errors="coerce", dayfirst=False)
    if pd.isna(parsed):
        parsed = pd.to_datetime(raw, errors="coerce", dayfirst=True)
    return "" if pd.isna(parsed) else parsed.strftime("%Y-%m-%d")


def classify_sap(katalog):
    k = normalize_catalog(katalog)
    if not k:
        return "NON_SAP_OR_UNKNOWN"
    if k.isdigit() and len(k) == 10:
        return "SAP_CADANG_10_DIGIT"
    if k.isdigit() and len(k) in (7, 8):
        return "SAP_PERSEDIAAN_7_8_DIGIT"
    return "NON_SAP_OR_UNKNOWN"


def doc_type_from_sheet(sheet):
    return {
        "tug34_barang": "TUG3",
        "tug10_barang": "TUG10",
        "tug9_barang": "TUG9",
        "tug8_barang": "TUG8",
        "tug5_barang": "TUG5",
    }[sheet]


def movement_for_doc(doc_type):
    if doc_type in {"TUG3", "TUG10"}:
        return "MASUK"
    if doc_type in {"TUG8", "TUG9"}:
        return "KELUAR"
    return "PERMINTAAN"


def read_sheet(path, sheet):
    return pd.read_excel(path, sheet_name=sheet, dtype=object).rename(columns=lambda c: str(c).strip())


def first_present(row, names):
    for name in names:
        if name in row and clean_text(row[name]):
            return row[name]
    return ""


def make_sync_key(parts):
    stable = "|".join(clean_text(x) for x in parts)
    digest = hashlib.sha1(stable.encode("utf-8")).hexdigest()[:12]
    return f"MIGRASI-{digest}"


def load_headers(path):
    cfg = {
        "tug34": ("TUG34_ID", "TUG3", "Penerimaan TUG-3/4"),
        "tug10": ("TUG10_ID", "TUG10", "Pengembalian ke Gudang"),
        "tug9": ("TUG9_ID", "TUG9", "Pemakaian Sendiri"),
        "tug8": ("TUG8_ID", "TUG8", "Pemakaian Unit Lain"),
        "tug5": ("TUG5_ID", "TUG5", "Permintaan Barang"),
    }
    out = {}
    for sheet, (id_col, doc_type, label) in cfg.items():
        df = read_sheet(path, sheet)
        for _, row in df.iterrows():
            doc_id = clean_text(row.get(id_col))
            if not doc_id:
                continue
            out[doc_id] = {
                "doc_id": doc_id,
                "doc_type": doc_type,
                "doc_label": label,
                "upt_header": clean_text(row.get("UPT")),
                "lokasi_header": clean_text(row.get("Lokasi Gudang")),
                "unit_lawan": clean_text(
                    first_present(
                        row,
                        [
                            "Vendor pengirim barang",
                            "Unit pengirim",
                            "Unit penerima",
                            "UPT penerima",
                        ],
                    )
                ),
                "pekerjaan": clean_text(
                    first_present(
                        row,
                        [
                            "Pekerjaan",
                            "Deskripsi pekerjaan",
                            "Keterangan Pekerjaan",
                            "Catatan saat penerimaan barang",
                        ],
                    )
                ),
                "tanggal_header": parse_date(
                    first_present(
                        row,
                        [
                            "Tanggal penerimaan",
                            "Tanggal pembuatan TUG",
                            "Tanggal Pembuatan TUG",
                            "Tanggal pengambilan",
                            "Tanggal penggantian",
                        ],
                    )
                ),
                # Lampiran lokal AppSheet (path relatif ke folder _extracted, bukan URL).
                # Nama kolomnya beda-beda per sheet, jadi dipetakan ke nama generik.
                "foto_surat_jalan_relpath": clean_text(
                    first_present(
                        row,
                        ["Foto surat jalan", "Foto surat permintaan", "Foto surat pengembalian"],
                    )
                ),
                "foto_sim_ktp_relpath": clean_text(
                    first_present(row, ["Foto SIM/ KTP sopir", "Foto SIM / KTP sopir"])
                ),
                "foto_kendaraan_relpath": clean_text(
                    first_present(row, ["Foto Kendaraan pengangkut", "Foto kendaraan pengangkut"])
                ),
                # Kolom "PDF"/"ID PDF" cuma id hex 8 karakter (tidak bisa di-resolve ke file),
                # path PDF sesungguhnya ada di "Print Bon" (tug34/10/9/8) / "Print PDF" (tug5).
                "pdf_relpath": clean_text(first_present(row, ["Print Bon", "Print PDF"])),
                "berita_acara_relpath": clean_text(row.get("Print Berita Acara")),
                "lampiran_relpath": clean_text(row.get("Print Lampiran")),
            }
    return out


def build_document_attachments(headers):
    return [
        {
            "doc_type": h["doc_type"],
            "doc_id": h["doc_id"],
            "source_upt": h["upt_header"],
            "foto_surat_jalan_relpath": h["foto_surat_jalan_relpath"],
            "foto_sim_ktp_relpath": h["foto_sim_ktp_relpath"],
            "foto_kendaraan_relpath": h["foto_kendaraan_relpath"],
            "pdf_relpath": h["pdf_relpath"],
            "berita_acara_relpath": h["berita_acara_relpath"],
            "lampiran_relpath": h["lampiran_relpath"],
        }
        for h in headers.values()
    ]


def build_master(path):
    df = read_sheet(path, "listMaterial")
    rows = []
    by_id = {}
    by_catalog = defaultdict(list)
    by_name_unit_upt = defaultdict(list)
    for _, row in df.iterrows():
        item = {
            "id_material": clean_text(row.get("idMaterial")),
            "upt": clean_text(row.get("Milik UPT")),
            "katalog_raw": clean_text(row.get("Katalog")),
            "no_katalog": normalize_catalog(row.get("Katalog")),
            "nama_material": clean_text(row.get("Nama Material")),
            "nama_material_norm": normalize_material_name(row.get("Nama Material")),
            "satuan": normalize_unit(row.get("Satuan")),
            "valuasi": parse_qty(row.get("Valuasi")),
            "status": clean_text(row.get("Status")),
            "jumlah_sap": parse_qty(row.get("Jumlah SAP")),
            "jumlah_awal": parse_qty(row.get("Jumlah Awal")),
            "material_masuk": parse_qty(row.get("Material Masuk")),
            "material_keluar": parse_qty(row.get("Material Keluar")),
            "jumlah_stok": parse_qty(row.get("Jumlah Stok")),
        }
        rows.append(item)
        if item["id_material"]:
            by_id[item["id_material"].upper()] = item
        if item["no_katalog"]:
            by_catalog[item["no_katalog"]].append(item)
        key = (item["upt"].upper(), item["nama_material_norm"], item["satuan"])
        if item["nama_material_norm"]:
            by_name_unit_upt[key].append(item)
    return rows, by_id, by_catalog, by_name_unit_upt


def resolve_material(row, master_by_id, master_by_catalog, master_by_name):
    ref = clean_text(row.get("Nama Material"))
    text = clean_text(row.get("Nama Material Teks")) or ref
    raw_catalog = clean_text(row.get("Katalog"))
    no_catalog = normalize_catalog(raw_catalog)
    satuan = normalize_unit(first_present(row, ["Satuan", "Satuan Teks", "Base Unit Of Measure"]))
    upt = clean_text(row.get("UPT"))

    candidates = []
    method = "UNMATCHED"
    confidence = 0
    if ref and ref.upper() in master_by_id:
        candidates = [master_by_id[ref.upper()]]
        method = "ID_MATERIAL"
        confidence = 100
    elif no_catalog and no_catalog in master_by_catalog:
        candidates = master_by_catalog[no_catalog]
        method = "NO_KATALOG"
        confidence = 92 if len(candidates) == 1 else 80
    else:
        key = (upt.upper(), normalize_material_name(text), satuan)
        if key in master_by_name:
            candidates = master_by_name[key]
            method = "NAMA_SATUAN_UPT"
            confidence = 70 if len(candidates) == 1 else 55

    chosen = candidates[0] if candidates else None
    resolved_catalog = no_catalog or (chosen["no_katalog"] if chosen else "")
    resolved_name = clean_text(text) or (chosen["nama_material"] if chosen else "")
    resolved_unit = satuan or (chosen["satuan"] if chosen else "")
    warnings = []
    if not resolved_catalog:
        warnings.append("KATALOG_KOSONG")
    if raw_catalog and chosen and no_catalog and chosen["no_katalog"] and no_catalog != chosen["no_katalog"]:
        warnings.append("KATALOG_BEDA_DENGAN_MASTER_ID")
    if chosen and normalize_material_name(text) and chosen["nama_material_norm"] and normalize_material_name(text) != chosen["nama_material_norm"]:
        warnings.append("NAMA_BEDA_DENGAN_MASTER")
    if chosen and resolved_unit and chosen["satuan"] and resolved_unit != chosen["satuan"]:
        warnings.append("SATUAN_BEDA_DENGAN_MASTER")
    if len(candidates) > 1:
        warnings.append("MULTI_MATCH_MASTER")
    if not chosen and ref.upper().startswith("MTRL-"):
        warnings.append("ID_MATERIAL_TIDAK_ADA_DI_MASTER")
    if classify_sap(resolved_catalog) == "NON_SAP_OR_UNKNOWN":
        warnings.append("NON_SAP_ATAU_KATALOG_TIDAK_STANDAR")

    return {
        "match_method": method,
        "confidence": confidence,
        "id_material_master": chosen["id_material"] if chosen else "",
        "no_katalog": resolved_catalog,
        "nama_material_clean": resolved_name,
        "satuan_clean": resolved_unit,
        "jenis_barang_master": chosen["status"] if chosen else "",
        "warnings": warnings,
    }


def build_transactions(path, headers, master_by_id, master_by_catalog, master_by_name):
    detail_sheets = ["tug34_barang", "tug10_barang", "tug9_barang", "tug8_barang", "tug5_barang"]
    rows = []
    anomalies = []
    for sheet in detail_sheets:
        df = read_sheet(path, sheet)
        doc_type = doc_type_from_sheet(sheet)
        movement = movement_for_doc(doc_type)
        doc_id_col = [c for c in df.columns if c.upper().endswith("_ID")][0]
        item_id_col = [c for c in df.columns if c.lower().startswith("id_")]
        qty_col = "Jumlah Permintaan Barang" if doc_type == "TUG5" else "Jumlah Barang"
        for idx, row in df.iterrows():
            doc_id = clean_text(row.get(doc_id_col))
            header = headers.get(doc_id, {})
            qty = parse_qty(row.get(qty_col))
            resolved = resolve_material(row, master_by_id, master_by_catalog, master_by_name)
            tanggal = parse_date(row.get("Tanggal Mutasi")) or header.get("tanggal_header", "")
            upt = clean_text(row.get("UPT")) or header.get("upt_header", "")
            lokasi = clean_text(first_present(row, ["Lokasi Barang Teks", "Lokasi Gudang", "Lokasi Material Berada"])) or header.get("lokasi_header", "")
            item_id = clean_text(row.get(item_id_col[0])) if item_id_col else ""
            issue = list(resolved["warnings"])
            if not doc_id:
                issue.append("DOC_ID_KOSONG")
            if not tanggal and doc_type != "TUG5":
                issue.append("TANGGAL_KOSONG")
            if qty is None or qty <= 0:
                issue.append("QTY_TIDAK_VALID")
            if movement != "PERMINTAAN" and not resolved["no_katalog"]:
                issue.append("TIDAK_SIAP_IMPORT_TANPA_KATALOG")
            import_ready = movement in {"MASUK", "KELUAR"} and bool(tanggal) and qty is not None and qty > 0 and bool(resolved["no_katalog"])
            katalog_id = f"KAT-{resolved['no_katalog']}" if resolved["no_katalog"] else ""
            tx = {
                "source_sheet": sheet,
                "source_row_excel": int(idx) + 2,
                "doc_type": doc_type,
                "movement": movement,
                "jenis_transaksi": movement if movement in {"MASUK", "KELUAR"} else "",
                "doc_id": doc_id,
                "item_id": item_id,
                "tanggal": tanggal,
                "upt": upt,
                "unit_lawan": header.get("unit_lawan", ""),
                "lokasi_kode": lokasi,
                "katalog_id": katalog_id,
                "no_katalog": resolved["no_katalog"],
                "nama_material": resolved["nama_material_clean"],
                "satuan": resolved["satuan_clean"],
                "qty": qty,
                "jenis_barang_source": clean_text(first_present(row, ["Jenis Barang Teks", "Jenis Barang"])),
                "match_method": resolved["match_method"],
                "confidence": resolved["confidence"],
                "sap_status": classify_sap(resolved["no_katalog"]),
                "catatan": clean_text(first_present(row, ["Keterangan"])) or header.get("pekerjaan", ""),
                "link_foto": clean_text(row.get("Link Foto Barang")),
                "foto_barang_relpath": clean_text(row.get("Foto Barang")),
                "import_ready": "YA" if import_ready else "TIDAK",
                "issue_flags": "; ".join(sorted(set(issue))),
                "sync_key": make_sync_key([doc_type, doc_id, item_id, tanggal, movement, resolved["no_katalog"], qty]),
            }
            rows.append(tx)
            if issue:
                anomalies.append({k: tx[k] for k in [
                    "source_sheet", "source_row_excel", "doc_type", "doc_id", "item_id", "tanggal",
                    "upt", "no_katalog", "nama_material", "satuan", "qty", "match_method",
                    "confidence", "issue_flags"
                ]})
    return rows, anomalies


def build_material_mapping(transactions, master_rows):
    grouped = {}
    for tx in transactions:
        key = (
            tx["no_katalog"] or f"NO_KATALOG::{normalize_material_name(tx['nama_material'])}",
            normalize_material_name(tx["nama_material"]),
            tx["satuan"],
            tx["upt"],
        )
        item = grouped.setdefault(key, {
            "upt": tx["upt"],
            "no_katalog": tx["no_katalog"],
            "katalog_id_usulan": tx["katalog_id"],
            "nama_material_usulan": tx["nama_material"],
            "satuan_usulan": tx["satuan"],
            "sap_status": tx["sap_status"],
            "total_baris_transaksi": 0,
            "total_qty_masuk": 0,
            "total_qty_keluar": 0,
            "dokumen_terkait": set(),
            "match_methods": Counter(),
            "flags": set(),
        })
        item["total_baris_transaksi"] += 1
        if tx["movement"] == "MASUK":
            item["total_qty_masuk"] += tx["qty"] or 0
        if tx["movement"] == "KELUAR":
            item["total_qty_keluar"] += tx["qty"] or 0
        if tx["doc_id"]:
            item["dokumen_terkait"].add(tx["doc_id"])
        item["match_methods"][tx["match_method"]] += 1
        for flag in tx["issue_flags"].split("; "):
            if flag:
                item["flags"].add(flag)

    out = []
    for item in grouped.values():
        status = "MATCH_REVIEW"
        if not item["no_katalog"]:
            status = "HOLD_NON_SAP"
        elif "NON_SAP_ATAU_KATALOG_TIDAK_STANDAR" in item["flags"]:
            status = "REVIEW_NON_SAP"
        elif {"NAMA_BEDA_DENGAN_MASTER", "SATUAN_BEDA_DENGAN_MASTER", "MULTI_MATCH_MASTER"} & item["flags"]:
            status = "WARNING_REVIEW"
        else:
            status = "MATCH_OK"
        out.append({
            **{k: v for k, v in item.items() if k not in {"dokumen_terkait", "match_methods", "flags"}},
            "dokumen_terkait": ", ".join(sorted(item["dokumen_terkait"])[:5]),
            "match_methods": ", ".join(f"{k}:{v}" for k, v in item["match_methods"].most_common()),
            "status_review": status,
            "warning": "; ".join(sorted(item["flags"])),
            "keputusan_admin": "",
            "keputusan_tl": "",
            "catatan_review": "",
        })
    return sorted(out, key=lambda x: (x["status_review"], x["upt"], x["no_katalog"], x["nama_material_usulan"]))


def build_summary(transactions, anomalies, master_rows):
    by_doc = Counter(tx["doc_type"] for tx in transactions)
    by_ready = Counter(tx["import_ready"] for tx in transactions)
    by_upt = Counter(tx["upt"] or "(kosong)" for tx in transactions)
    by_issue = Counter()
    for row in anomalies:
        for flag in row["issue_flags"].split("; "):
            if flag:
                by_issue[flag] += 1
    summary = [
        {"metric": "Master listMaterial rows", "value": len(master_rows), "note": "Sumber master material AppSheet"},
        {"metric": "Detail TUG rows total", "value": len(transactions), "note": "Gabungan tug34/tug10/tug9/tug8/tug5_barang"},
        {"metric": "Rows siap import tug15_history", "value": by_ready["YA"], "note": "MASUK/KELUAR dengan tanggal, qty, katalog valid"},
        {"metric": "Rows perlu review", "value": by_ready["TIDAK"], "note": "Termasuk TUG5 permintaan dan baris tanpa katalog/tanggal/qty"},
        {"metric": "Anomaly rows", "value": len(anomalies), "note": "Baris dengan minimal satu warning/error"},
    ]
    for doc, value in sorted(by_doc.items()):
        summary.append({"metric": f"Rows {doc}", "value": value, "note": ""})
    for upt, value in sorted(by_upt.items()):
        summary.append({"metric": f"Rows UPT {upt}", "value": value, "note": ""})
    for issue, value in by_issue.most_common():
        summary.append({"metric": f"Issue {issue}", "value": value, "note": ""})
    return summary


def records_for_json(rows):
    clean = []
    for row in rows:
        out = {}
        for k, v in row.items():
            if isinstance(v, float) and math.isnan(v):
                out[k] = None
            elif isinstance(v, set):
                out[k] = sorted(v)
            elif isinstance(v, Counter):
                out[k] = dict(v)
            else:
                out[k] = v
        clean.append(out)
    return clean


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-json", required=True)
    args = parser.parse_args()

    source = Path(args.input)
    master_rows, master_by_id, master_by_catalog, master_by_name = build_master(source)
    headers = load_headers(source)
    transactions, anomalies = build_transactions(source, headers, master_by_id, master_by_catalog, master_by_name)
    mapping = build_material_mapping(transactions, master_rows)
    ready_import = [
        {
            "katalog_id": tx["katalog_id"],
            "tanggal": tx["tanggal"],
            "jenis_transaksi": tx["jenis_transaksi"],
            "qty": tx["qty"],
            "lokasi_id": "",
            "lokasi_kode": tx["lokasi_kode"],
            "doc_type": tx["doc_type"],
            "no_bon": tx["doc_id"],
            "catatan": tx["catatan"],
            "sync_key": tx["sync_key"],
            "source_upt": tx["upt"],
            "source_sheet": tx["source_sheet"],
            "source_row_excel": tx["source_row_excel"],
            "no_katalog": tx["no_katalog"],
            "nama_material": tx["nama_material"],
            "satuan": tx["satuan"],
            "match_method": tx["match_method"],
            "confidence": tx["confidence"],
            "warning": tx["issue_flags"],
        }
        for tx in transactions
        if tx["import_ready"] == "YA"
    ]

    payload = {
        "meta": {
            "source_file": str(source),
            "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "purpose": "Cleansing history transaksi material AppSheet untuk migrasi WARNOTO",
        },
        "summary": records_for_json(build_summary(transactions, anomalies, master_rows)),
        "tug15_history_import": records_for_json(ready_import),
        "transaksi_all_clean": records_for_json(transactions),
        "dokumen_header": records_for_json(build_document_attachments(headers)),
        "mapping_material_review": records_for_json(mapping),
        "anomali_data": records_for_json(anomalies),
        "master_material_clean": records_for_json(master_rows),
    }
    Path(args.output_json).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output_json).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: len(v) for k, v in payload.items() if isinstance(v, list)}, indent=2))


if __name__ == "__main__":
    main()
