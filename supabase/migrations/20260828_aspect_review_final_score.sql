-- Nilai final Pusat per-ITEM evidence (Maturity). Tabel maturity_aspect_reviews
-- sudah per-item dan Pusat sudah boleh UPDATE via RLS existing (can_review_maturity_uit
-- OR can_review_maturity_pusat, tanpa syarat status) — tinggal tambah kolom skornya.

alter table public.maturity_aspect_reviews
  add column if not exists final_score smallint check (final_score is null or (final_score between 1 and 5));
