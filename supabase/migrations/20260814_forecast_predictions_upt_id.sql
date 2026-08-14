-- 20260814_forecast_predictions_upt_id.sql
-- Isolasi prediksi ML Forecast Stok per-UPT.
--
-- MASALAH: forecast_predictions tak punya upt_id → prediksi Prophet yang
-- diturunkan dari histori (praktis hanya UPT-SBY yang punya transaksi) bocor ke
-- UPT lain yang menstok katalog sama (26 katalog bocor nyata). Prediksi harus
-- per (upt_id, katalog_id, tanggal).
--
-- Backfill baris lama → UPT-SBY: seluruh histori pelatih (tug15_history + arsip
-- AppSheet source_upt Surabaya) berasal dari SBY, jadi prediksi eksisting = SBY.

ALTER TABLE public.forecast_predictions
  ADD COLUMN IF NOT EXISTS upt_id text;

UPDATE public.forecast_predictions
  SET upt_id = 'UPT-SBY'
  WHERE upt_id IS NULL;

-- Unik lama (katalog_id, tanggal_prediksi) → sertakan upt_id supaya tiap UPT
-- punya seri prediksinya sendiri tanpa tabrakan.
ALTER TABLE public.forecast_predictions
  DROP CONSTRAINT IF EXISTS forecast_predictions_katalog_id_tanggal_prediksi_key;

ALTER TABLE public.forecast_predictions
  ADD CONSTRAINT forecast_predictions_katalog_upt_tanggal_key
  UNIQUE (katalog_id, upt_id, tanggal_prediksi);

-- Verifikasi (harus semua UPT-SBY setelah backfill):
--   SELECT upt_id, count(*) FROM public.forecast_predictions GROUP BY 1;
