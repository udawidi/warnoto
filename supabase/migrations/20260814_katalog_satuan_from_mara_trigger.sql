-- 20260814_katalog_satuan_from_mara_trigger.sql
-- Enforce aturan mengikat: no.katalog — nama — satuan = 1 kesatuan, satuan
-- bersumber dari mara_catalog (master MARA SAP).
--
-- MASALAH: mengisi katalog.data->>'satuan' via SQL langsung SIA-SIA — tabel
-- katalog dimiliki app-state, tiap saveToCloud full-sync menimpanya kembali
-- (satuan kosong dari client). Fix di app-layer rapuh (banyak write-path +
-- semua client harus refresh). Solusi robust: TRIGGER di boundary DB yang
-- ikut menangkap tulisan app — isi satuan dari MARA saat kosong, di setiap
-- INSERT/UPDATE, apa pun kliennya (app/bot/edge/import).
--
-- Non-destruktif: hanya mengisi satuan KOSONG; satuan yang sudah terisi
-- (mis. diset manual) TIDAK disentuh. Katalog tanpa padanan MARA dibiarkan.
--
-- ponytail: per-row lookup MARA hanya saat satuan kosong (guard IF), dipercepat
-- functional index idx_mara_kode_ltrim. Kalau throughput jadi masalah, cache
-- MARA satuan ke kolom katalog — tapi belum perlu.

-- Index fungsional agar trigger match ltrim(kode) pakai index, bukan seq scan.
CREATE INDEX IF NOT EXISTS idx_mara_kode_ltrim
  ON public.mara_catalog (ltrim(kode_material, '0'));

CREATE OR REPLACE FUNCTION public.katalog_fill_satuan_from_mara()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  m_satuan text;
BEGIN
  IF coalesce(nullif(NEW.data->>'satuan', ''), '') = '' THEN
    SELECT satuan INTO m_satuan
    FROM public.mara_catalog
    WHERE ltrim(kode_material, '0') = ltrim(NEW.data->>'katalog', '0')
      AND coalesce(satuan, '') <> ''
    LIMIT 1;
    IF m_satuan IS NOT NULL THEN
      NEW.data = jsonb_set(NEW.data, '{satuan}', to_jsonb(m_satuan));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS katalog_fill_satuan ON public.katalog;
CREATE TRIGGER katalog_fill_satuan
  BEFORE INSERT OR UPDATE ON public.katalog
  FOR EACH ROW
  EXECUTE FUNCTION public.katalog_fill_satuan_from_mara();

-- Backfill semua katalog yang satuan-nya kosong (trigger hanya jalan di tulisan
-- baru). SET data = data memicu BEFORE UPDATE → trigger mengisi dari MARA.
UPDATE public.katalog
SET data = data
WHERE coalesce(nullif(data->>'satuan', ''), '') = '';
