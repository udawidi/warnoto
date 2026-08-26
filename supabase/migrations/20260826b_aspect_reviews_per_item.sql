-- Perhalus granularitas review: dari per-ASPEK menjadi per-ITEM evidence.
-- Satu aspek punya beberapa requiredEvidence (mis. "probis Pemeriksaan dan
-- Penerimaan Material Persediaan (flowchart)"). User minta UIT Check/Reject
-- tiap item, bukan satu keputusan untuk seluruh aspek.
--
-- Tabel maturity_aspect_reviews baru dibuat hari ini dan MASIH KOSONG, jadi
-- aman menambah kolom item_id ke primary key tanpa migrasi data.

alter table public.maturity_aspect_reviews
  add column if not exists item_id text not null default '';

-- Ganti PK (audit_id, aspect_id) -> (audit_id, aspect_id, item_id).
alter table public.maturity_aspect_reviews
  drop constraint if exists maturity_aspect_reviews_pkey;
alter table public.maturity_aspect_reviews
  add constraint maturity_aspect_reviews_pkey primary key (audit_id, aspect_id, item_id);

-- Default hanya alat bantu ALTER pada tabel kosong; kolom tetap wajib diisi klien.
alter table public.maturity_aspect_reviews
  alter column item_id drop default;
