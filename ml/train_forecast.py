"""
WARNOTO — Job training forecast pemakaian material (jalan tiap malam via GitHub Actions).

Alur:
  1. Ambil semua histori mutasi stok (tug15_history) dari Supabase, derive upt_id tiap
     baris lewat lokasi_id -> lokasi.gudang_id -> gudang.upt_id (histori arsip AppSheet
     selalu UPT-SBY, sesuai asal datanya).
  2. Per (upt_id, katalog_id), susun time-series qty KELUAR harian.
  3. Latih model Prophet (kalau histori cukup, minimal MIN_DATA_POINTS baris) per grup.
  4. Prediksi qty pemakaian 30 hari ke depan, tulis/timpa ke tabel forecast_predictions
     (kunci upsert: katalog_id, upt_id, tanggal_prediksi).
  5. Ambil qty stok terkini PER-UPT dari stocks (bukan stock_current yang nasional),
     hitung estimasi_hari_sampai_habis = qty_saat_ini_upt / rata2_qty_prediksi_harian
     (hanya diisi di baris prediksi pertama).
"""
import os
import sys
from datetime import datetime, timedelta

import pandas as pd
# prophet/supabase di-import lazy di dalam fungsi (bukan top-level) supaya
# train_forecast_selftest.py bisa import build_lokasi_upt_map/normalize_katalog_code
# tanpa perlu paket-paket berat itu terpasang.

from lib.normalize_katalog_code import normalize_katalog_code

MIN_DATA_POINTS = 5   # diturunkan sementara dari 10: histori transaksi live masih sedikit,
                       # dinaikkan lagi setelah data tug15_history terkumpul lebih banyak
FORECAST_DAYS = 30
MODEL_VERSION = "prophet-v1"


def get_client():
    from supabase import create_client
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SECRET_KEY"]  # service_role / secret key — HANYA dari GitHub Secrets
    return create_client(url, key)


def fetch_history(sb):
    res = sb.table("tug15_history").select("katalog_id, tanggal, jenis_transaksi, qty, lokasi_id").eq("jenis_transaksi", "KELUAR").execute()
    return pd.DataFrame(res.data)


def build_lokasi_upt_map(lokasi_rows, gudang_rows):
    """lokasi_id -> upt_id, lewat lokasi.data.gudangId -> gudang.data.uptId
    (sama persis dengan uptIdFromLokasi di scripts/nightly_sync.mjs)."""
    gudang_to_upt = {row["id"]: (row.get("data") or {}).get("uptId") for row in gudang_rows}
    lokasi_to_upt = {}
    for row in lokasi_rows:
        gudang_id = (row.get("data") or {}).get("gudangId")
        lokasi_to_upt[row["id"]] = gudang_to_upt.get(gudang_id)
    return lokasi_to_upt


def fetch_lokasi_upt_map(sb):
    lokasi_res = sb.table("lokasi").select("id, data").execute()
    gudang_res = sb.table("gudang").select("id, data").execute()
    return build_lokasi_upt_map(lokasi_res.data, gudang_res.data)


def fetch_stock_current_per_upt(sb):
    """Qty stok terkini per (upt_id, katalog_id), dari tabel stocks (kolom upt_id sudah
    di-backfill via migration 20260809). stock_current lama nasional-only, tak dipakai lagi
    untuk estimasi per-UPT."""
    res = sb.table("stocks").select("katalog_id, upt_id, data").execute()
    qty_map = {}
    for row in res.data:
        kid, uid = row.get("katalog_id"), row.get("upt_id")
        if not kid or not uid:
            continue
        key = (uid, kid)
        qty_map[key] = qty_map.get(key, 0) + (float((row.get("data") or {}).get("qty") or 0))
    return qty_map


def fetch_legacy_history(sb):
    """Histori KELUAR arsip AppSheet lama (UPT Surabaya), dipetakan ke katalog_id sekarang
    lewat normalize_katalog_code. Baris yang kodenya tidak match katalog manapun di-skip."""
    legacy_res = (
        sb.table("legacy_history_archive")
        .select("no_katalog, tanggal, qty")
        .eq("jenis_transaksi", "KELUAR")
        .ilike("source_upt", "%Surabaya%")
        .execute()
    )
    legacy_df = pd.DataFrame(legacy_res.data)

    katalog_res = sb.table("katalog").select("id, data").execute()
    code_to_id = {
        normalize_katalog_code(row["data"].get("katalog")): row["id"]
        for row in katalog_res.data
        if row.get("data", {}).get("katalog")
    }

    rows = []
    total = len(legacy_df)
    for _, row in legacy_df.iterrows():
        kid = code_to_id.get(normalize_katalog_code(row["no_katalog"]))
        if kid is None:
            continue
        rows.append({"katalog_id": kid, "tanggal": row["tanggal"], "qty": row["qty"], "upt_id": "UPT-SBY"})

    matched = len(rows)
    print(f"Legacy history: {matched} baris cocok katalog (dari {total} baris KELUAR UPT Surabaya), {total - matched} diabaikan (kode tidak match).")
    return pd.DataFrame(rows, columns=["katalog_id", "tanggal", "qty", "upt_id"])


def train_one_katalog(df_katalog):
    """df_katalog: kolom ['tanggal','qty'] -> kembalikan dataframe Prophet [ds,yhat] 30 hari ke depan."""
    from prophet import Prophet
    daily = df_katalog.groupby("tanggal")["qty"].sum().reset_index()
    daily.columns = ["ds", "y"]
    daily["ds"] = pd.to_datetime(daily["ds"])

    full_range = pd.date_range(daily["ds"].min(), daily["ds"].max(), freq="D")
    daily = daily.set_index("ds").reindex(full_range, fill_value=0).rename_axis("ds").reset_index()

    model = Prophet(daily_seasonality=False, weekly_seasonality=True, yearly_seasonality=True)
    model.fit(daily)

    future = model.make_future_dataframe(periods=FORECAST_DAYS)
    forecast = model.predict(future)
    return forecast[forecast["ds"] > daily["ds"].max()][["ds", "yhat"]]


def main():
    sb = get_client()
    history = fetch_history(sb)
    if not history.empty:
        lokasi_to_upt = fetch_lokasi_upt_map(sb)
        history["upt_id"] = history["lokasi_id"].map(lokasi_to_upt)
    legacy = fetch_legacy_history(sb)
    history = pd.concat([history, legacy], ignore_index=True)
    if history.empty:
        print("Tidak ada data tug15_history sama sekali. Berhenti.")
        return

    # Baris tug15_history legacy sering punya lokasi_id yang lokasinya sudah
    # diarsip (tak ada di master lokasi) -> tak ter-resolve. Semua aktivitas
    # transaksi historis berasal dari UPT-SBY (satu-satunya operator), jadi
    # baris tak-resolve di-fallback ke UPT-SBY, bukan dibuang -- menjaga sinyal
    # KELUAR terkini untuk forecast SBY.
    # ponytail: fallback SBY karena historis single-UPT; kalau UPT lain nanti
    # transaksi dengan lokasi valid, mereka ter-resolve normal & tak kena fallback.
    unresolved = history["upt_id"].isna().sum()
    if unresolved:
        print(f"  ⚠️ {unresolved} baris histori tak ter-map ke UPT (lokasi diarsip) -> fallback UPT-SBY.")
    history["upt_id"] = history["upt_id"].fillna("UPT-SBY")

    stock_qty = fetch_stock_current_per_upt(sb)

    groups = history.groupby(["upt_id", "katalog_id"])
    print(f"Ditemukan {groups.ngroups} kombinasi (upt, katalog) dengan histori KELUAR.")

    rows_to_upsert = []
    for (uid, kid), df_k in groups:
        if len(df_k) < MIN_DATA_POINTS:
            continue
        try:
            forecast = train_one_katalog(df_k)
        except Exception as e:
            print(f"  ⚠️ Gagal latih {uid}/{kid}: {e}")
            continue

        avg_qty_harian = forecast["yhat"].clip(lower=0).mean()
        qty_saat_ini = stock_qty.get((uid, kid))
        estimasi_hari = round(qty_saat_ini / avg_qty_harian) if qty_saat_ini is not None and avg_qty_harian > 0 else None

        for _, row in forecast.iterrows():
            rows_to_upsert.append({
                "katalog_id": kid,
                "upt_id": uid,
                "tanggal_prediksi": row["ds"].strftime("%Y-%m-%d"),
                "qty_prediksi": max(0, round(float(row["yhat"]), 2)),
                "estimasi_hari_sampai_habis": estimasi_hari,
                "model_version": MODEL_VERSION,
                "updated_at": datetime.utcnow().isoformat(),
            })
        print(f"  ✓ {uid}/{kid}: {len(df_k)} baris histori → {FORECAST_DAYS} hari prediksi (estimasi habis: {estimasi_hari})")

    if not rows_to_upsert:
        print("Tidak ada kombinasi (upt, katalog) dengan histori cukup (>= %d baris). Tidak ada yang disimpan." % MIN_DATA_POINTS)
        return

    sb.table("forecast_predictions").upsert(rows_to_upsert, on_conflict="katalog_id,upt_id,tanggal_prediksi").execute()
    print(f"Selesai. {len(rows_to_upsert)} baris prediksi tersimpan ke forecast_predictions.")


if __name__ == "__main__":
    main()
