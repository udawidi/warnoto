-- WARNOTO — Skema database Supabase
-- Dipakai bersama oleh: (1) job ML forecasting (GitHub Actions, malam hari)
--                       (2) fitur scan barcode HP (sinkron multi-device)
--
-- Cara pakai: copy seluruh isi file ini, jalankan di Supabase Dashboard
-- → SQL Editor → New query → paste → Run.

-- ────────────────────────────────────────────────────────────
-- 1. KATALOG — master barang (cerminan dari Master Katalog di App.jsx)
--    Pola jsonb (sama seperti uit/upt/gudang/lokasi/satpam/tim_mutu di
--    section 8) — supaya bisa pakai loadMasterTable/syncMasterTable/
--    seedMasterTableIfEmpty yang generik, bukan sync bespoke terpisah.
--
--    RIWAYAT: tabel ini SEBELUMNYA punya kolom typed (nama/kategori/satuan/
--    jenis_barang/foto_keseluruhan_url) tapi TIDAK PERNAH benar-benar
--    disinkron App.jsx (orphan sejak commit feed925 — "Katalog was
--    explicitly left out of this round"). katalogList/stocks App.jsx cuma
--    tersimpan di localStorage browser sampai 2026-07-02 (ditemukan saat
--    audit sebelum migrasi data massal). Data lama di tabel ini AMAN
--    dihapus (basi/tidak dipakai) — makanya migrasi di bawah pakai
--    `drop column` langsung, bukan preservasi data lama.
-- ────────────────────────────────────────────────────────────
create table if not exists katalog (
  id text primary key,              -- sama dengan id di App.jsx, cth "KAT-1060011"
  data jsonb not null default '{}'::jsonb,
  created_at bigint
);
-- Migrasi installasi lama (skema typed-column, orphan/basi -- lihat catatan di atas):
alter table katalog drop column if exists nama;
alter table katalog drop column if exists kategori;
alter table katalog drop column if exists satuan;
alter table katalog drop column if exists jenis_barang;
alter table katalog drop column if exists foto_keseluruhan_url;
alter table katalog add column if not exists data jsonb not null default '{}'::jsonb;
alter table katalog add column if not exists created_at bigint;
-- PENTING: kalau tabel katalog sudah ada dari SEBELUM migrasi ini, kolom created_at
-- lama bertipe `timestamptz` (bukan bigint) -- `add column if not exists` TIDAK
-- mengubah tipe kolom yang sudah ada, jadi upsert dari syncMasterTable (yang kirim
-- created_at sebagai bigint epoch-ms) akan gagal diam-diam sampai tipe kolomnya
-- dipaksa dikonversi begini (ditemukan & fixed 2026-07-02 saat migrasi data massal).
-- DO block: cuma jalankan ALTER TYPE kalau kolomnya MASIH timestamptz (aman diulang).
do $$
begin
  if (select data_type from information_schema.columns where table_name='katalog' and column_name='created_at') = 'timestamp with time zone' then
    alter table katalog alter column created_at drop default;
    alter table katalog alter column created_at type bigint using (extract(epoch from created_at)*1000)::bigint;
  end if;
end $$;

-- ────────────────────────────────────────────────────────────
-- 1b. STOCKS — Data Stok aktif (qty per item per lokasi), pola jsonb sama.
--     BEDA dari stocks_snapshot (tabel ringkas khusus bot chat/cron malam,
--     lihat section 17) -- tabel ini SUMBER UTAMA Data Stok aplikasi.
--     katalog_id/lokasi_id dihoist sebagai kolom asli (bukan cuma di jsonb)
--     supaya bisa di-filter/join langsung di Supabase Studio kalau perlu.
-- ────────────────────────────────────────────────────────────
create table if not exists stocks (
  id text primary key,
  katalog_id text references katalog(id) on delete set null,
  lokasi_id text,
  data jsonb not null default '{}'::jsonb,
  created_at bigint
);
create index if not exists idx_stocks_katalog on stocks(katalog_id);
create index if not exists idx_stocks_lokasi on stocks(lokasi_id);
alter table stocks enable row level security;
drop policy if exists "Authenticated read stocks" on stocks;
drop policy if exists "Authenticated write stocks" on stocks;
create policy "Authenticated read stocks" on stocks for select using (auth.role() = 'authenticated');
create policy "Authenticated write stocks" on stocks for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Realtime Data Stok (PROPOSAL OPERASIONAL — JANGAN dieksekusi otomatis dari file ini).
-- Setelah service Realtime self-host telah sehat dan user memberi gate eksplisit,
-- tambahkan HANYA public.stocks ke publication yang sudah ada. PK stocks.id cukup
-- untuk DELETE; jangan ubah REPLICA IDENTITY ke FULL karena payload jsonb/WAL membesar.
-- Blok berikut idempotent bila dijalankan manual oleh operator:
--
-- do $$
-- begin
--   if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
--      and not exists (
--        select 1 from pg_publication_tables
--        where pubname = 'supabase_realtime'
--          and schemaname = 'public'
--          and tablename = 'stocks'
--      ) then
--     alter publication supabase_realtime add table public.stocks;
--   end if;
-- end $$;

-- ────────────────────────────────────────────────────────────
-- 2. TUG15_HISTORY — riwayat mutasi stok (sumber data training ML
--    + ditampilkan di halaman scan QR TUG-2 publik)
--    Diisi dari hasil export Laporan Mutasi Stok (TUG-15) di App.jsx
-- ────────────────────────────────────────────────────────────
create table if not exists tug15_history (
  id bigint generated always as identity primary key,
  katalog_id text references katalog(id),
  tanggal date not null,
  jenis_transaksi text not null check (jenis_transaksi in ('MASUK','KELUAR')),
  qty numeric not null,
  lokasi_id text,
  lokasi_kode text,                 -- kode rak (cth "GD-A1"), didenormalisasi saat sync supaya scan page tidak perlu join
  doc_type text,                    -- TUG-3/4/5/8/9/10 dst, untuk jejak asal data
  no_bon text,                      -- cth "TUG-9 / 123/TUG9/2026"
  catatan text,                     -- nama pekerjaan / keterangan dari dokumen TUG terkait
  sync_key text,                    -- kunci unik per-transaksi (katalog+tgl+doctype+jenis), cegah baris dobel
  created_at timestamptz default now()
);
create index if not exists idx_tug15_katalog_tanggal on tug15_history(katalog_id, tanggal);

-- Jika tabel tug15_history sudah ada dari sebelumnya, tambahkan kolom baru:
alter table tug15_history add column if not exists lokasi_kode text;
alter table tug15_history add column if not exists no_bon text;
alter table tug15_history add column if not exists catatan text;
alter table tug15_history add column if not exists sync_key text;

-- PENTING: bersihkan dulu baris yang sudah dobel (kalau ada) SEBELUM membuat
-- index unik di bawah, supaya pembuatan index-nya tidak gagal karena ada
-- duplikat. Aturan: simpan baris dengan id TERKECIL per grup duplikat,
-- hapus sisanya. Grup duplikat = sama katalog, tanggal, jenis, qty, doc_type, no_bon.
delete from tug15_history a
using tug15_history b
where a.id > b.id
  and a.katalog_id = b.katalog_id
  and a.tanggal = b.tanggal
  and a.jenis_transaksi = b.jenis_transaksi
  and a.qty = b.qty
  and coalesce(a.doc_type,'') = coalesce(b.doc_type,'')
  and coalesce(a.no_bon,'') = coalesce(b.no_bon,'');

-- Index unik (NULL tidak dianggap konflik, jadi baris lama tanpa sync_key tetap aman).
create unique index if not exists idx_tug15_sync_key on tug15_history(sync_key);

-- ────────────────────────────────────────────────────────────
-- 3. FORECAST_PREDICTIONS — hasil ML, ditimpa ulang tiap malam oleh job training
-- ────────────────────────────────────────────────────────────
create table if not exists forecast_predictions (
  id bigint generated always as identity primary key,
  katalog_id text references katalog(id) not null,
  tanggal_prediksi date not null,            -- tanggal target prediksi (cth: 30 hari ke depan)
  qty_prediksi numeric,                      -- estimasi qty keluar/dipakai pada tanggal itu
  estimasi_hari_sampai_habis integer,        -- berapa hari lagi stok diperkirakan habis
  model_version text,                        -- cth "prophet-v1", buat audit kalau ganti model
  updated_at timestamptz default now(),
  unique (katalog_id, tanggal_prediksi)
);
create index if not exists idx_forecast_katalog on forecast_predictions(katalog_id);

-- ────────────────────────────────────────────────────────────
-- 4. STOCK_SCAN_LOG — log tiap kali barcode/QR material di-scan lewat halaman
--    publik ScanPublicView (App.jsx, "?scan=<katalogId>", TIDAK perlu login).
--    device_id = id acak per-browser (localStorage) supaya bisa bedakan siapa
--    scan dari HP mana meski tidak ada akun — dipakai kalau banyak orang scan
--    barcode yang sama/berbeda bersamaan di gudang (2026-07-03).
-- ────────────────────────────────────────────────────────────
create table if not exists stock_scan_log (
  id bigint generated always as identity primary key,
  katalog_id text references katalog(id),
  lokasi_id text,
  device_id text,
  scanned_by text,
  scanned_at timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- 5. STOCK_CURRENT — snapshot qty stok terkini per katalog (untuk hitung
--    estimasi_hari_sampai_habis). Ditimpa ulang tiap kali Sync dari App.jsx,
--    1 baris per katalog_id (qty dijumlah dari semua lokasi).
-- ────────────────────────────────────────────────────────────
create table if not exists stock_current (
  katalog_id text primary key references katalog(id),
  qty numeric not null default 0,
  updated_at timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- Row Level Security — aktifkan, biar tidak semua orang bisa baca/tulis sembarangan
-- nanti kalau ada otentikasi user Supabase, policy ini bisa diperketat lagi.
-- Untuk sekarang: anon key cuma boleh READ (SELECT), tulis cuma lewat service_role
-- (dipakai job GitHub Actions & aplikasi lewat fungsi yang terkontrol).
-- ────────────────────────────────────────────────────────────
alter table katalog enable row level security;
alter table tug15_history enable row level security;
alter table forecast_predictions enable row level security;
alter table stock_scan_log enable row level security;
alter table stock_current enable row level security;

-- drop policy if exists dulu di tiap policy, supaya script ini aman dijalankan
-- BERULANG KALI (cth: setelah update skema ini) tanpa error "policy already exists".
drop policy if exists "Public read katalog" on katalog;
drop policy if exists "Public read tug15_history" on tug15_history;
drop policy if exists "Public read forecast_predictions" on forecast_predictions;
drop policy if exists "Public read stock_scan_log" on stock_scan_log;
drop policy if exists "Public read stock_current" on stock_current;

create policy "Public read katalog" on katalog for select using (true);
create policy "Public read tug15_history" on tug15_history for select using (true);
create policy "Public read forecast_predictions" on forecast_predictions for select using (true);
create policy "Public read stock_scan_log" on stock_scan_log for select using (true);
create policy "Public read stock_current" on stock_current for select using (true);

-- Tulis dari App.jsx (anon/publishable key) — sengaja DIBATASI cuma tabel sumber
-- data mentah (katalog, tug15_history, stock_current), supaya forecast_predictions
-- tetap cuma bisa ditulis lewat service_role (job GitHub Actions), tidak bisa
-- "dipalsukan" dari browser.
drop policy if exists "Public insert katalog" on katalog;
drop policy if exists "Public update katalog" on katalog;
drop policy if exists "Public insert tug15_history" on tug15_history;
drop policy if exists "Public insert stock_current" on stock_current;
drop policy if exists "Public update stock_current" on stock_current;
drop policy if exists "Public insert stock_scan_log" on stock_scan_log;

create policy "Public insert katalog" on katalog for insert with check (true);
create policy "Public update katalog" on katalog for update using (true);
create policy "Public insert tug15_history" on tug15_history for insert with check (true);
create policy "Public insert stock_current" on stock_current for insert with check (true);
create policy "Public update stock_current" on stock_current for update using (true);
-- stock_scan_log ditulis dari ScanPublicView (halaman scan QR/barcode publik,
-- tanpa login) — insert-only dari anon key, tidak ada update/delete publik
-- supaya log tidak bisa dipalsukan ulang/dihapus dari browser siapapun.
create policy "Public insert stock_scan_log" on stock_scan_log for insert with check (true);

-- ────────────────────────────────────────────────────────────
-- 6. STORAGE BUCKET — "material-photos", untuk Foto Material Keseluruhan
--    yang ditampilkan di halaman scan QR publik (?scan=<katalogId>).
--    Bucket harus PUBLIC supaya foto bisa dimuat tanpa login di HP.
-- ────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('material-photos', 'material-photos', true)
on conflict (id) do update set public = true;

-- Anon/publishable key boleh upload & timpa foto (dipakai App.jsx saat sync),
-- siapa pun boleh baca (publik, supaya scan page bisa load foto tanpa login).
drop policy if exists "Public read material-photos" on storage.objects;
drop policy if exists "Public upload material-photos" on storage.objects;
drop policy if exists "Public update material-photos" on storage.objects;

create policy "Public read material-photos" on storage.objects
  for select using (bucket_id = 'material-photos');
create policy "Public upload material-photos" on storage.objects
  for insert with check (bucket_id = 'material-photos');
create policy "Public update material-photos" on storage.objects
  for update using (bucket_id = 'material-photos');

-- ────────────────────────────────────────────────────────────
-- 7. PROFILES — data user aplikasi (cerminan dari currentUser di App.jsx).
--    Login sekarang lewat Supabase Auth (auth.users), bukan array password
--    polos di App.jsx lagi. Tabel ini cuma menyimpan data tampilan/role,
--    dihubungkan 1:1 ke auth.users lewat id (uuid) yang sama.
-- ────────────────────────────────────────────────────────────
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  name text not null,
  role text not null,           -- UPT: ADMIN / TL / ASMAN / MANAGER / ADMIN_ULTG / MGR_ULTG — UIT: ADMIN_UIT / ASMAN_LOG_UIT / MGR_LOGISTIK_UIT — Pusat: ADMIN_LOG_PUSAT — lain: PENGADAAN / VIEWER / SUPERADMIN
  jabatan text,
  avatar text,
  upt_id text,                  -- diisi untuk role scoped ke 1 UPT tertentu (opsional, biasanya via UPT konstan app)
  ultg_id text,                 -- WAJIB diisi untuk role ADMIN_ULTG / MGR_ULTG — unit ULTG yang dia wakili
  uit_id text,                  -- diisi untuk role scoped ke 1 UIT (ADMIN_UIT / ASMAN_LOG_UIT / MGR_LOGISTIK_UIT / PENGADAAN mode UIT); ADMIN_LOG_PUSAT nasional, tidak terikat UIT
  gudang_ids jsonb,
  official_phone text,          -- format 0xxx (10-15 digit), nomor WA resmi untuk notif role-based (TL/Asman/UIT)
  created_at timestamptz default now()
);
-- upt_id/ultg_id/uit_id SENGAJA tanpa foreign key ke tabel upt/uit di sini —
-- tabel upt/uit baru didefinisikan di bagian 8 (MASTER DATA) di bawah, setelah
-- section ini, jadi FK inline di sini akan gagal saat schema.sql dijalankan
-- dari kosong (forward reference ke tabel yang belum ada).
-- Migrasi installasi lama yang tabelnya sudah ada sebelum kolom ini ditambahkan:
alter table profiles add column if not exists upt_id text;
alter table profiles add column if not exists ultg_id text;
alter table profiles add column if not exists uit_id text;
alter table profiles add column if not exists gudang_ids jsonb;
alter table profiles add column if not exists official_phone text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='profiles_official_phone_format' and conrelid='profiles'::regclass) then
    alter table profiles add constraint profiles_official_phone_format
      check (official_phone is null or official_phone ~ '^0[0-9]{9,14}$');
  end if;
end $$;

alter table profiles enable row level security;
drop policy if exists "Authenticated read profiles" on profiles;
-- Semua user yang sudah login boleh baca SEMUA profil (bukan cuma punya
-- sendiri) — App.jsx butuh ini untuk menampilkan nama "dibuat oleh"/
-- "disetujui oleh" pengguna lain di dokumen TUG, daftar approval, dst.
create policy "Authenticated read profiles" on profiles for select using (auth.role() = 'authenticated');
-- SENGAJA tidak ada policy insert/update untuk role authenticated biasa —
-- supaya user tidak bisa menaikkan role-nya sendiri lewat console browser.
-- Pembuatan/ubah profil Fase 1 lewat SQL manual (lihat instruksi migrasi).
-- Fase 2 SUDAH SELESAI (2026-07-07): Admin bisa daftarkan akun baru langsung
-- dari menu "Kelola Akun" di aplikasi (App.jsx), lewat Edge Function
-- supabase/functions/admin-create-user (service_role, bypass RLS di atas).

-- Trigger: begitu ada user baru terdaftar di Supabase Auth (lewat Dashboard
-- "Add user" atau nanti Edge Function), otomatis bikin baris stub di
-- profiles (role default VIEWER, paling rendah aksesnya) — supaya Admin
-- tinggal jalankan UPDATE untuk isi detail (name/role/jabatan/avatar)
-- sesudahnya, tidak perlu INSERT manual yang harus mencocokkan uuid sendiri.
create or replace function public.handle_new_auth_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, name, role)
  values (new.id, split_part(new.email, '@', 1), split_part(new.email, '@', 1), 'VIEWER')
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ────────────────────────────────────────────────────────────
-- 8. MASTER DATA (UIT/UPT/Gudang/Lokasi/Satpam/Tim Mutu) — sebelumnya hanya
--    tersimpan di localStorage tiap browser, sekarang Supabase jadi sumber
--    utamanya supaya sinkron antar device/user. 1 baris = 1 entri; kolom
--    `data` (jsonb) menyimpan object-nya apa adanya karena field-nya beragam
--    dan berkembang (mis. lokasi punya mapX/mapY/pendingData/jenisArea yang
--    tidak semua dipakai di semua baris) — kolom id/relasi/status dipisah
--    di luar `data` supaya tetap bisa di-query/relasikan.
-- ────────────────────────────────────────────────────────────
create table if not exists uit (
  id text primary key,
  data jsonb not null,
  created_at bigint
);
create table if not exists upt (
  id text primary key,
  uit_id text references uit(id) on delete set null,
  data jsonb not null,
  created_at bigint
);
create table if not exists ultg (
  id text primary key,
  upt_id text references upt(id) on delete set null,
  data jsonb not null,
  created_at bigint
);
create table if not exists gudang (
  id text primary key,
  upt_id text references upt(id) on delete set null,
  data jsonb not null,
  created_at bigint
);
create table if not exists sub_gudang (
  id text primary key,
  gudang_id text references gudang(id) on delete set null,
  data jsonb not null,
  created_at bigint
);
create index if not exists idx_subgudang_gudang on sub_gudang(gudang_id);
create table if not exists lokasi (
  id text primary key,
  gudang_id text references gudang(id) on delete set null,
  status text,
  data jsonb not null,
  created_at bigint
);
create index if not exists idx_lokasi_gudang on lokasi(gudang_id);
create table if not exists satpam (
  id text primary key,
  data jsonb not null,
  created_at bigint
);
create table if not exists tim_mutu (
  id text primary key,
  data jsonb not null,
  created_at bigint
);

alter table uit enable row level security;
alter table upt enable row level security;
alter table ultg enable row level security;
alter table gudang enable row level security;
alter table sub_gudang enable row level security;
alter table lokasi enable row level security;
alter table satpam enable row level security;
alter table tim_mutu enable row level security;

drop policy if exists "Authenticated read sub_gudang" on sub_gudang;
drop policy if exists "Authenticated write sub_gudang" on sub_gudang;
create policy "Authenticated read sub_gudang" on sub_gudang for select using (auth.role() = 'authenticated');
create policy "Authenticated write sub_gudang" on sub_gudang for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated read ultg" on ultg;
drop policy if exists "Authenticated write ultg" on ultg;
create policy "Authenticated read ultg" on ultg for select using (auth.role() = 'authenticated');
create policy "Authenticated write ultg" on ultg for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Baca: siapa saja yang sudah login boleh baca semua master data (app butuh
-- ini di banyak tempat — dropdown, laporan, dst). Tulis: dibatasi authenticated
-- juga (bukan publik/anon) — konsisten dengan model trust app ini, dimana
-- pembatasan PER ROLE (Admin/TL) ditegakkan di level UI seperti fitur lain.
drop policy if exists "Authenticated read uit" on uit;
drop policy if exists "Authenticated write uit" on uit;
create policy "Authenticated read uit" on uit for select using (auth.role() = 'authenticated');
create policy "Authenticated write uit" on uit for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated read upt" on upt;
drop policy if exists "Authenticated write upt" on upt;
create policy "Authenticated read upt" on upt for select using (auth.role() = 'authenticated');
create policy "Authenticated write upt" on upt for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated read gudang" on gudang;
drop policy if exists "Authenticated write gudang" on gudang;
create policy "Authenticated read gudang" on gudang for select using (auth.role() = 'authenticated');
create policy "Authenticated write gudang" on gudang for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated read lokasi" on lokasi;
drop policy if exists "Authenticated write lokasi" on lokasi;
create policy "Authenticated read lokasi" on lokasi for select using (auth.role() = 'authenticated');
create policy "Authenticated write lokasi" on lokasi for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated read satpam" on satpam;
drop policy if exists "Authenticated write satpam" on satpam;
create policy "Authenticated read satpam" on satpam for select using (auth.role() = 'authenticated');
create policy "Authenticated write satpam" on satpam for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated read tim_mutu" on tim_mutu;
drop policy if exists "Authenticated write tim_mutu" on tim_mutu;
create policy "Authenticated read tim_mutu" on tim_mutu for select using (auth.role() = 'authenticated');
create policy "Authenticated write tim_mutu" on tim_mutu for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────
-- 9. RAG (Retrieval-Augmented Generation) — knowledge base AI Agent.
--    Tiap baris = 1 "chunk" teks (deskripsi 1 katalog, atau ringkasan 1
--    transaksi TUG) + vector embedding-nya (Cohere embed-multilingual-v3.0,
--    1024 dimensi). Saat user tanya ke AI Agent, pertanyaannya di-embed lalu
--    dicari (via fungsi match_rag_chunks) chunk yang paling relevan secara
--    makna — bukan cuma top-20/10 hardcoded seperti context-stuffing yang
--    sudah ada sebelumnya. Sinkron knowledge base ini DIPICU MANUAL (tombol
--    "Sync Knowledge Base" di AI Agent, khusus Admin) — bukan otomatis tiap
--    ada perubahan data, supaya tidak boros panggilan API embedding.
-- ────────────────────────────────────────────────────────────
create extension if not exists vector;

create table if not exists rag_chunks (
  id text primary key,           -- cth "katalog_UPT-SBY_KAT-1060011" atau "txn_TUG9-xxxxx"
  source_type text not null,     -- 'katalog' | 'txn' | 'faq' | 'mutasi'
  source_id text not null,       -- id katalog/txn aslinya, utk update/hapus saat sumber berubah
  content text not null,         -- teks yang di-embed (yang juga dikirim balik ke AI sebagai konteks)
  embedding vector(1024),
  upt_id text,                   -- UPT pemilik chunk; null = SHARED (FAQ, katalog tanpa stok) tampil ke semua viewer
  updated_at timestamptz default now()
);
create index if not exists idx_rag_chunks_source on rag_chunks(source_type, source_id);
create index if not exists idx_rag_chunks_upt on rag_chunks(upt_id);
create index if not exists idx_rag_chunks_embedding on rag_chunks using hnsw (embedding vector_cosine_ops);

alter table rag_chunks enable row level security;
drop policy if exists "Authenticated read rag_chunks" on rag_chunks;
drop policy if exists "Authenticated write rag_chunks" on rag_chunks;
create policy "Authenticated read rag_chunks" on rag_chunks for select using (auth.role() = 'authenticated');
create policy "Authenticated write rag_chunks" on rag_chunks for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Pencarian similarity (cosine) — dipanggil dari App.jsx lewat supabase.rpc('match_rag_chunks', ...)
-- p_upts: 3-tier scope. NULL = nasional (Pusat/SUPERADMIN) lihat semua chunk;
-- ARRAY[...] = UIT/UPT hanya chunk upt_id di array + chunk SHARED (upt_id null, mis. FAQ).
create or replace function match_rag_chunks(query_embedding vector(1024), match_count int default 8, p_upts text[] default null)
returns table(id text, source_type text, source_id text, content text, similarity float)
language sql stable
as $$
  select id, source_type, source_id, content, 1 - (embedding <=> query_embedding) as similarity
  from rag_chunks
  where embedding is not null
    and (p_upts is null or upt_id is null or upt_id = any(p_upts))
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- ────────────────────────────────────────────────────────────
-- 10. WAREHOUSE_CAPACITY — kapasitas gudang per sub-gudang (m2), baris LIVE
--     (setelah di-approve). Grain: UPT x Gudang x Sub Gudang. Sumber:
--     Laporan KAPASITAS GUDANG UIT JBM.xlsx, diimport lewat UI
--     (KapasitasGudangImportTab → approveCapacityImport di App.jsx).
--
--     RIWAYAT: skema kolom typed ini sempat TIDAK sinkron dengan App.jsx
--     (syncMasterTable generik mengirim {id,data,created_at} yang tidak
--     cocok kolom typed di bawah -> upsert selalu gagal HTTP 400, data
--     kapasitas hanya tersimpan localStorage/CLOUD per-browser). Sempat
--     direncanakan migrasi ke pola jsonb generik (lihat riwayat git),
--     tapi migrasi itu TIDAK PERNAH dijalankan ke produksi. Perbaikan
--     final 2026-07-22: skema kolom typed di bawah DIPERTAHANKAN apa
--     adanya, App.jsx diperbaiki lewat fungsi mapping khusus
--     (loadWarehouseCapacity/syncWarehouseCapacity di src/lib/masterSync.js)
--     yang memetakan camelCase (JS) <-> snake_case (kolom) satu per satu.
-- ────────────────────────────────────────────────────────────
create table if not exists warehouse_capacity (
  id text primary key,              -- "CAP-{UPT}-{GUDANG}-{SUB}" uppercase, dibuat App.jsx
  upt text not null,
  gudang text not null,
  sub_gudang text not null,
  type_gudang text,
  alamat text,
  latitude numeric,
  longitude numeric,
  luas_lahan_m2 numeric not null default 0,
  luas_terpakai_m2 numeric not null default 0,
  sisa_luas_m2 numeric not null default 0,
  persentase_terpakai numeric not null default 0,
  persediaan_pct numeric default 0,
  cadang_pct numeric default 0,
  pre_memory_pct numeric default 0,
  attb_pct numeric default 0,
  lainnya_pct numeric default 0,
  status_kapasitas text not null default 'AMAN' check (status_kapasitas in ('KRITIS','WASPADA','AMAN')),
  contact_person text,
  waktu_update text,
  keterangan text,
  link_gudang text,
  matched_gudang_id text,
  mapping_status text not null default 'UNMATCHED' check (mapping_status in ('UNMATCHED','AUTO_SUGGESTED','CONFIRMED')),
  import_batch_id text,
  updated_at timestamptz default now()
);

alter table warehouse_capacity enable row level security;
drop policy if exists "Authenticated read warehouse_capacity" on warehouse_capacity;
drop policy if exists "Authenticated write warehouse_capacity" on warehouse_capacity;
create policy "Authenticated read warehouse_capacity" on warehouse_capacity for select using (auth.role() = 'authenticated');
create policy "Authenticated write warehouse_capacity" on warehouse_capacity for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────
-- 11. WAREHOUSE_CAPACITY_IMPORTS — riwayat batch import + antrian approval
--     kapasitas gudang (1 baris = 1 file diupload). Kolom `records` jsonb
--     menyimpan seluruh array baris kapasitas dalam batch itu APA ADANYA
--     (passthrough, tidak di-flatten) -- beda dari warehouse_capacity yang
--     kolomnya di-flatten satu per satu.
--
--     RIWAYAT: sama seperti warehouse_capacity di atas, skema kolom typed
--     ini sempat direncanakan migrasi ke pola jsonb generik tapi tidak
--     pernah dijalankan. Perbaikan final 2026-07-22: kolom approval
--     (status/records/approved_*/rejected_*/reject_reason) ditambahkan
--     lewat migration `warehouse_capacity_imports_add_approval_columns`,
--     `imported_at` diubah dari timestamptz ke bigint (konsisten epoch-ms
--     seperti tabel master lain), App.jsx diperbaiki lewat
--     loadWarehouseCapacityImports/syncWarehouseCapacityImports.
-- ────────────────────────────────────────────────────────────
create table if not exists warehouse_capacity_imports (
  id text primary key,              -- batchId "CAPIMP-{timestamp}", dibuat App.jsx
  source_file text not null,
  sheet_name text,
  imported_by text,
  imported_at bigint,
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  warning_rows integer not null default 0,
  status text not null default 'PENDING_ASMAN' check (status in ('PENDING_ASMAN','APPROVED','REJECTED')),
  records jsonb not null default '[]'::jsonb,
  approved_by text,
  approved_at bigint,
  rejected_by text,
  rejected_at bigint,
  reject_reason text
);

alter table warehouse_capacity_imports enable row level security;
drop policy if exists "Authenticated read wh_cap_imports" on warehouse_capacity_imports;
drop policy if exists "Authenticated write wh_cap_imports" on warehouse_capacity_imports;
create policy "Authenticated read wh_cap_imports" on warehouse_capacity_imports for select using (auth.role() = 'authenticated');
create policy "Authenticated write wh_cap_imports" on warehouse_capacity_imports for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────
-- 13. WARNOTO_STATE — snapshot state gudang untuk AI Agent.
--     Di-update tiap saveToCloud berhasil. Edge Function membaca baris
--     terbaru (order by updated_at desc limit 1) sebagai konteks.
--     Hanya menyimpan data ringkasan, bukan seluruh CLOUD blob.
-- ────────────────────────────────────────────────────────────
create table if not exists warnoto_state (
  id bigint generated always as identity primary key,
  state_data jsonb not null,            -- ringkasan: stok kritis, tug pending, kapasitas, dll
  version text,                         -- "v1", untuk migrasi skema state ke depan
  updated_at timestamptz default now()
);
create index if not exists idx_warnoto_state_updated on warnoto_state(updated_at desc);

alter table warnoto_state enable row level security;
-- App.jsx (anon key) perlu insert/update; Edge Function memakai service_role
drop policy if exists "Public read warnoto_state" on warnoto_state;
drop policy if exists "Public insert warnoto_state" on warnoto_state;
create policy "Public read warnoto_state" on warnoto_state for select using (true);
create policy "Public insert warnoto_state" on warnoto_state for insert with check (true);

-- ────────────────────────────────────────────────────────────
-- 15. WA_SYNC_STATUS — status terakhir sinkronisasi RAG/state dari App.jsx.
--     Dipakai bersama oleh nightly_sync.mjs (tulis) & telegram-webhook (baca).
--     Nama "wa_" dipertahankan (legacy) — WA Bot sudah dihapus, tabel ini
--     tetap dipakai bot Telegram. 1 baris per sync_type (upsert by sync_type).
-- ────────────────────────────────────────────────────────────
create table if not exists wa_sync_status (
  sync_type text primary key,           -- "rag_knowledge_base" | "warnoto_state"
  last_synced_at timestamptz,
  synced_by text,
  record_count integer default 0,
  status text default 'OK' check (status in ('OK','ERROR','RUNNING')),
  error_message text,
  updated_at timestamptz default now()
);

alter table wa_sync_status enable row level security;
drop policy if exists "Public read wa_sync_status" on wa_sync_status;
drop policy if exists "Public write wa_sync_status" on wa_sync_status;
create policy "Public read wa_sync_status" on wa_sync_status for select using (true);
create policy "Public write wa_sync_status" on wa_sync_status for all using (true) with check (true);

-- ────────────────────────────────────────────────────────────
-- 16. TELEGRAM BOT — channel AI Agent utama (satu-satunya). WA Bot sudah
--     dihapus 2026-07-13 (terblokir Business Verification Meta, tidak dipakai).
--     Setup Telegram ringan: tanpa App Review/verifikasi bisnis/pembatasan negara.
-- ────────────────────────────────────────────────────────────
create table if not exists tg_allowed_users (
  id bigint generated always as identity primary key,
  telegram_user_id text not null unique,  -- numeric Telegram user id (string, dari update.message.from.id)
  telegram_username text,                 -- @username, opsional (tidak semua user Telegram punya)
  display_name text,
  notes text,
  added_by text,
  added_at timestamptz default now(),
  is_active boolean not null default true
);
alter table tg_allowed_users enable row level security;
drop policy if exists "Authenticated read tg_allowed_users" on tg_allowed_users;
drop policy if exists "Authenticated write tg_allowed_users" on tg_allowed_users;
create policy "Authenticated read tg_allowed_users" on tg_allowed_users for select using (auth.role() = 'authenticated');
create policy "Authenticated write tg_allowed_users" on tg_allowed_users for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists tg_agent_logs (
  id bigint generated always as identity primary key,
  telegram_user_id text not null,
  telegram_username text,
  display_name text,
  message_in text not null,
  intent text,
  answer_summary text,
  rag_chunks_used integer default 0,
  is_whitelisted boolean not null default false,
  response_ms integer,
  error_message text,
  created_at timestamptz default now()
);
create index if not exists idx_tg_logs_user on tg_agent_logs(telegram_user_id);
create index if not exists idx_tg_logs_created on tg_agent_logs(created_at desc);
alter table tg_agent_logs enable row level security;
drop policy if exists "Authenticated read tg_agent_logs" on tg_agent_logs;
create policy "Authenticated read tg_agent_logs" on tg_agent_logs for select using (auth.role() = 'authenticated');
-- feedback: 'up' | 'down' | null — diisi lewat tombol inline Telegram (lihat telegram-webhook)
alter table tg_agent_logs add column if not exists feedback text check (feedback in ('up','down') or feedback is null);
-- Edge Function (service_role) perlu UPDATE baris ini saat user klik tombol feedback.
drop policy if exists "Service write tg_agent_logs" on tg_agent_logs;
create policy "Service write tg_agent_logs" on tg_agent_logs for update using (true) with check (true);

-- ────────────────────────────────────────────────────────────
-- 17. STOCKS_SNAPSHOT — salinan qty+harga Data Stok ke Supabase, khusus supaya
--     cron malam (nightly_sync, jalan di GitHub Actions TANPA browser terbuka)
--     bisa hitung ulang top-N by value / stok kritis dengan angka Rupiah yang
--     benar. Sebelum ini, harga material HANYA ada di localStorage/CLOUD tiap
--     browser Admin — tidak bisa diakses proses server-side sama sekali.
--     Diisi otomatis dari App.jsx lewat saveToCloud (auto-sync debounced 90
--     detik, bareng syncRagChunks/syncWarnotoState) — "whole list is the
--     truth" (upsert + hapus yang tidak ada lagi), sama seperti master data lain.
-- ────────────────────────────────────────────────────────────
create table if not exists stocks_snapshot (
  id text primary key,              -- sama dengan stocks[].id di App.jsx
  katalog_id text references katalog(id) on delete set null,
  nama text not null,
  qty numeric not null default 0,
  satuan text,
  harga numeric not null default 0,
  jenis_barang text,
  min_qty numeric default 0,
  lokasi_kode text,                 -- kode blok, cth "GD-A1" — supaya bot bisa jawab "di blok mana"
  gudang_nama text,                 -- nama Gudang induk blok tsb, cth "Gudang Ketintang"
  kode_katalog text,                -- nomor katalog SAP (BEDA dari katalog_id/PK) — dipakai
                                     -- klasifikasi SAP/Non-SAP di nightly_sync.mjs. Tabel
                                     -- `katalog` terpisah TIDAK pernah disinkron App.jsx (orphan),
                                     -- jadi stocks_snapshot ini sumber tunggal yang selalu segar.
  updated_at timestamptz default now()
);
alter table stocks_snapshot add column if not exists lokasi_kode text;
alter table stocks_snapshot add column if not exists gudang_nama text;
alter table stocks_snapshot add column if not exists kode_katalog text;
create index if not exists idx_stocks_snapshot_katalog on stocks_snapshot(katalog_id);
alter table stocks_snapshot enable row level security;
drop policy if exists "Authenticated read stocks_snapshot" on stocks_snapshot;
drop policy if exists "Authenticated write stocks_snapshot" on stocks_snapshot;
create policy "Authenticated read stocks_snapshot" on stocks_snapshot for select using (auth.role() = 'authenticated');
create policy "Authenticated write stocks_snapshot" on stocks_snapshot for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
-- Nightly cron (service_role, dari GitHub Actions) juga perlu baca tabel ini -
-- service_role otomatis bypass RLS, jadi tidak perlu policy tambahan untuk itu.

-- ────────────────────────────────────────────────────────────
-- 18. AI_FAQ_CURATED — "buku pintar" hasil kurasi Admin dari pertanyaan nyata
--     yang dijawab buruk oleh bot (lihat panel baru di AI Agent web). Ikut
--     di-embed ke rag_chunks (source_type='faq') oleh syncRagChunks (client)
--     maupun nightly_sync.mjs (cron) — supaya pertanyaan serupa besok-besok
--     langsung dijawab pakai jawaban resmi ini, bukan coba-coba lagi.
-- ────────────────────────────────────────────────────────────
create table if not exists ai_faq_curated (
  id bigint generated always as identity primary key,
  pertanyaan text not null,
  jawaban text not null,
  source_log_table text,            -- 'wa_agent_logs' | 'tg_agent_logs' | null (ditulis manual)
  source_log_id bigint,
  created_by text,
  created_at timestamptz default now(),
  is_active boolean not null default true
);
alter table ai_faq_curated enable row level security;
drop policy if exists "Authenticated read ai_faq_curated" on ai_faq_curated;
drop policy if exists "Authenticated write ai_faq_curated" on ai_faq_curated;
create policy "Authenticated read ai_faq_curated" on ai_faq_curated for select using (auth.role() = 'authenticated');
create policy "Authenticated write ai_faq_curated" on ai_faq_curated for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────
-- 19. MARA_CATALOG — referensi Katalog MARA (upload XLSX ribuan baris via
--     Master Data → Master Katalog → "Upload MARA"), dipakai autofill/search
--     saat tambah katalog baru (searchMaraCatalog/applyMaraToKatalog di
--     App.jsx) dan referensi di UsulanKatalogTab/MaterialCadangTab. Read-only
--     reference — TIDAK PERNAH jadi master katalog aktif (`katalog`/`stocks`
--     terpisah total).
--
--     CATATAN: tabel ini sebelumnya HIDUP DI SUPABASE (dipakai aktif oleh
--     App.jsx via uploadMaraToDB) TAPI TIDAK PERNAH terdokumentasi di file
--     ini — ditemukan orphan-dari-schema.sql (bukan orphan-dari-app, beda
--     dari kasus tabel `katalog` sebelumnya) saat audit 2026-07-02. Lebih
--     parah lagi: RLS aktif tapi TANPA SATUPUN POLICY (`enable row level
--     security` ter-set entah kapan, tapi policy read/write tidak pernah
--     dibuat) — artinya tabel TERKUNCI TOTAL, upload MARA maupun autofill
--     search tidak akan pernah berhasil sampai policy di bawah dijalankan.
--     Definisi `create table` di bawah pakai `if not exists` (aman kalau
--     tabel sudah ada), tapi PK/kolom TIDAK diverifikasi ulang di sini kalau
--     tabel sudah ada dengan struktur beda — cek `information_schema.columns`
--     dulu kalau curiga skema live berbeda dari definisi ini.
-- ────────────────────────────────────────────────────────────
create table if not exists mara_catalog (
  kode_material text primary key,
  material_type text,
  material_group text,
  material_group_desc text,          -- teks bacaan (cth "TRANSF GENERATOR"), dipakai isi Kategori
                                      -- di form Tambah Katalog Baru (material_group = kode SAP
                                      -- mentah spt "ZM0101", kurang enak dibaca)
  satuan text,
  status text,
  nama text
);
alter table mara_catalog add column if not exists material_group_desc text;
alter table mara_catalog enable row level security;
drop policy if exists "Authenticated read mara_catalog" on mara_catalog;
drop policy if exists "Authenticated write mara_catalog" on mara_catalog;
create policy "Authenticated read mara_catalog" on mara_catalog for select using (auth.role() = 'authenticated');
create policy "Authenticated write mara_catalog" on mara_catalog for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- -----------------------------------------------------------------------------
-- 20. MATERIAL_CADANG_HEALTH_INDEX
--     Domain terpisah untuk fitur Health Index Material Cadang + AI Insight.
--     Angka resmi dihitung lokal/audit-able di App.jsx. AI hanya menyimpan
--     insight, diagnosis, rekomendasi, dan validasi data; tidak mengubah stok,
--     min_qty, approval, atau hasil deterministic.
-- -----------------------------------------------------------------------------
create table if not exists material_cadang_imports (
  id text primary key,
  file_name text,
  imported_by text,
  imported_at bigint,
  total_rows integer default 0,
  valid_rows integer default 0,
  warning_rows integer default 0,
  invalid_rows integer default 0,
  data_quality jsonb not null default '{}'::jsonb,
  raw_meta jsonb not null default '{}'::jsonb
);
create index if not exists idx_mc_imports_imported_at on material_cadang_imports(imported_at desc);

create table if not exists material_cadang_analysis_runs (
  id text primary key,
  import_id text references material_cadang_imports(id) on delete set null,
  legacy_analysis_id text,
  created_by text,
  created_at bigint,
  model_ai text,
  params jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb
);
create index if not exists idx_mc_runs_created_at on material_cadang_analysis_runs(created_at desc);

create table if not exists material_cadang_health_results (
  id text primary key,
  run_id text references material_cadang_analysis_runs(id) on delete cascade,
  katalog_id text,
  no_katalog text,
  nama_material text,
  health_index numeric,
  health_status text,
  risk_score numeric,
  data_confidence numeric,
  abc_class text,
  policy text,
  current_qty numeric,
  recommended_qty numeric,
  gap_qty numeric,
  gap_value numeric,
  deterministic_breakdown jsonb not null default '{}'::jsonb,
  data_quality_flags jsonb not null default '[]'::jsonb,
  result_payload jsonb not null default '{}'::jsonb
);
create index if not exists idx_mc_health_results_run on material_cadang_health_results(run_id);
create index if not exists idx_mc_health_results_status on material_cadang_health_results(health_status);
create index if not exists idx_mc_health_results_katalog on material_cadang_health_results(no_katalog);

create table if not exists material_cadang_ai_insights (
  id text primary key,
  run_id text references material_cadang_analysis_runs(id) on delete cascade,
  no_katalog text,
  insight_scope text not null default 'RUN', -- RUN | MATERIAL
  model text,
  status text,
  confidence numeric,
  executive_summary text,
  diagnosis text,
  recommendation text,
  flags jsonb not null default '[]'::jsonb,
  insight_payload jsonb not null default '{}'::jsonb,
  created_at bigint
);
create index if not exists idx_mc_ai_insights_run on material_cadang_ai_insights(run_id);
create index if not exists idx_mc_ai_insights_katalog on material_cadang_ai_insights(no_katalog);

create table if not exists material_cadang_apply_audit (
  id text primary key,
  apply_id text,
  run_id text,
  katalog_id text,
  no_katalog text,
  requested_min_qty numeric,
  previous_min_qty numeric,
  approved_min_qty numeric,
  action text not null,
  actor text,
  acted_at bigint,
  note text,
  audit_payload jsonb not null default '{}'::jsonb
);
create index if not exists idx_mc_apply_audit_apply on material_cadang_apply_audit(apply_id);
create index if not exists idx_mc_apply_audit_run on material_cadang_apply_audit(run_id);

alter table material_cadang_imports enable row level security;
alter table material_cadang_analysis_runs enable row level security;
alter table material_cadang_health_results enable row level security;
alter table material_cadang_ai_insights enable row level security;
alter table material_cadang_apply_audit enable row level security;

drop policy if exists "Authenticated read mc_imports" on material_cadang_imports;
drop policy if exists "Authenticated write mc_imports" on material_cadang_imports;
drop policy if exists "Authenticated read mc_runs" on material_cadang_analysis_runs;
drop policy if exists "Authenticated write mc_runs" on material_cadang_analysis_runs;
drop policy if exists "Authenticated read mc_health_results" on material_cadang_health_results;
drop policy if exists "Authenticated write mc_health_results" on material_cadang_health_results;
drop policy if exists "Authenticated read mc_ai_insights" on material_cadang_ai_insights;
drop policy if exists "Authenticated write mc_ai_insights" on material_cadang_ai_insights;
drop policy if exists "Authenticated read mc_apply_audit" on material_cadang_apply_audit;
drop policy if exists "Authenticated write mc_apply_audit" on material_cadang_apply_audit;

create policy "Authenticated read mc_imports" on material_cadang_imports for select using (auth.role() = 'authenticated');
create policy "Authenticated write mc_imports" on material_cadang_imports for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Authenticated read mc_runs" on material_cadang_analysis_runs for select using (auth.role() = 'authenticated');
create policy "Authenticated write mc_runs" on material_cadang_analysis_runs for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Authenticated read mc_health_results" on material_cadang_health_results for select using (auth.role() = 'authenticated');
create policy "Authenticated write mc_health_results" on material_cadang_health_results for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Authenticated read mc_ai_insights" on material_cadang_ai_insights for select using (auth.role() = 'authenticated');
create policy "Authenticated write mc_ai_insights" on material_cadang_ai_insights for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Authenticated read mc_apply_audit" on material_cadang_apply_audit for select using (auth.role() = 'authenticated');
create policy "Authenticated write mc_apply_audit" on material_cadang_apply_audit for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Material Cadang durable per-UPT (blob 3 store localStorage). RLS UPT-scoped (can_access_upt).
create table if not exists public.material_cadang_state (
  upt_id text primary key,
  data jsonb not null default '{}'::jsonb,
  health jsonb not null default '{}'::jsonb,
  ai jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.material_cadang_state enable row level security;
drop policy if exists "Scoped material_cadang_state" on public.material_cadang_state;
create policy "Scoped material_cadang_state" on public.material_cadang_state
  for all using (can_access_upt(upt_id)) with check (can_access_upt(upt_id));
grant select, insert, update, delete on public.material_cadang_state to authenticated;

-- 20b. MATERIAL_INSPECTIONS — append-only inspection Material Cadang.
-- DB canonical; foto privat disimpan sebagai path bucket, bukan base64 jsonb.
-- Revisi 2026-07-27: satu BA (material_inspection_batches) berisi 1..10 material
-- (material_inspections jadi tabel item). Nomor BA digenerate server-side lewat
-- RPC create_material_inspection_batch() agar tidak bisa ditebak/ditabrak client.

-- Counter nomor BA per (UPT, tahun). Tabel, bukan sequence Postgres, supaya
-- nomor bisa direset per tahun & per UPT tanpa DDL runtime.
create table if not exists material_inspection_seq (
  upt_id text not null,
  tahun int not null,
  last_seq bigint not null default 0,
  primary key (upt_id, tahun)
);
alter table material_inspection_seq enable row level security;
grant all on material_inspection_seq to service_role;
-- Tanpa grant/policy untuk authenticated: hanya RPC (security definer) yang menyentuh ini.

create table if not exists material_inspection_batches (
  id uuid primary key default gen_random_uuid(),
  nomor_ba text not null unique,     -- '000001/BA-INSPEKSI/UPT-SBY/07/2026'
  upt_id text not null default 'UPT-SBY',
  gudang_id text references gudang(id) on delete set null,
  tanggal date not null default now()::date,
  inspector_id uuid references profiles(id) on delete set null,
  data jsonb not null default '{}'::jsonb,   -- header manual: pelaksana*, managerUpt, namaUpt, noSloc, namaGudang
  created_at timestamptz not null default now()
);

-- Scope DB adalah sumber kebenaran untuk BA/material/foto: UPT sendiri,
-- UPT di bawah UIT sendiri, atau UPT induk ULTG. SUPERADMIN tetap global.
create or replace function public.can_access_material_inspection_scope(p_upt_id text, p_gudang_id text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from profiles actor
    where actor.id = auth.uid()
      and (
        actor.role = 'SUPERADMIN'
        or (
          p_upt_id is not null
          and p_gudang_id is not null
          and exists (select 1 from gudang g where g.id = p_gudang_id and g.upt_id = p_upt_id)
          and (
            actor.gudang_ids is null
            or (
              jsonb_typeof(actor.gudang_ids) = 'array'
              and (jsonb_array_length(actor.gudang_ids) = 0 or actor.gudang_ids ? p_gudang_id)
            )
          )
          and (
            actor.upt_id = p_upt_id
            or (actor.uit_id is not null and exists (select 1 from upt u where u.id = p_upt_id and u.uit_id = actor.uit_id))
            or (actor.ultg_id is not null and exists (select 1 from ultg ul where ul.id = actor.ultg_id and ul.upt_id = p_upt_id))
          )
        )
      )
  );
$$;
revoke all on function public.can_access_material_inspection_scope(text, text) from public;
grant execute on function public.can_access_material_inspection_scope(text, text) to authenticated;
create index if not exists idx_mi_batches_created_at on material_inspection_batches(created_at desc);
create index if not exists idx_mi_batches_upt on material_inspection_batches(upt_id);
create index if not exists idx_mi_batches_gudang on material_inspection_batches(gudang_id);
grant select on material_inspection_batches to authenticated;
grant all on material_inspection_batches to service_role;
alter table material_inspection_batches enable row level security;
drop policy if exists "Authenticated read material_inspection_batches" on material_inspection_batches;
create policy "Authenticated read material_inspection_batches" on material_inspection_batches
  for select to authenticated using (public.can_access_material_inspection_scope(upt_id, gudang_id));
-- Sengaja TIDAK ada policy insert: batch hanya dibuat lewat RPC security definer,
-- supaya nomor BA & pasangan batch+item selalu atomik.

create table if not exists material_inspections (
  id uuid primary key default gen_random_uuid(),
  stock_id text references stocks(id) on delete set null,
  katalog_id text references katalog(id) on delete set null,
  lokasi_id text references lokasi(id) on delete set null,
  inspector_id uuid references profiles(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table material_inspections
  add column if not exists batch_id uuid references material_inspection_batches(id) on delete cascade;
create index if not exists idx_material_inspections_created_at on material_inspections(created_at desc);
create index if not exists idx_material_inspections_stock on material_inspections(stock_id);
create index if not exists idx_material_inspections_batch on material_inspections(batch_id);
grant select on material_inspections to authenticated;
grant all on material_inspections to service_role;
alter table material_inspections enable row level security;
drop policy if exists "Authenticated read material_inspections" on material_inspections;
-- Insert langsung dari client dihapus (revisi 2026-07-27): semua insert lewat RPC.
drop policy if exists "Admin TL insert material_inspections" on material_inspections;
create policy "Authenticated read material_inspections" on material_inspections
  for select to authenticated using (
    exists (
      select 1 from material_inspection_batches b
      where b.id = material_inspections.batch_id
        and public.can_access_material_inspection_scope(b.upt_id, b.gudang_id)
    )
  );

-- RPC atomik: buat 1 batch + 1..10 item dalam satu transaksi, nomor BA server-side.
-- p_header: { upt_id?, gudang_id?, tanggal?, ...field manual BA }
-- p_items : [ { stock_id, ...field per-material termasuk photoPaths } ]
create or replace function public.create_material_inspection_batch(p_items jsonb, p_header jsonb)
returns jsonb as $$
declare
  v_inspector uuid := auth.uid();
  v_upt text := nullif(p_header->>'upt_id', '');
  v_actor_upt text;
  v_actor_gudang_ids jsonb;
  v_tanggal date := coalesce((p_header->>'tanggal')::date, now()::date);
  v_gudang text := nullif(p_header->>'gudang_id', '');
  v_count int;
  v_seq bigint;
  v_nomor text;
  v_batch_id uuid;
  v_items jsonb;
begin
  if v_inspector is null then
    raise exception 'Tidak terautentikasi.';
  end if;
  if not exists (select 1 from profiles where id = v_inspector and role in ('ADMIN', 'TL')) then
    raise exception 'Hanya ADMIN/TL yang boleh membuat BA inspeksi.';
  end if;
  select upt_id, gudang_ids into v_actor_upt, v_actor_gudang_ids
  from profiles where id = v_inspector;
  if v_actor_upt is null or v_upt is null or v_upt <> v_actor_upt then
    raise exception 'UPT BA harus sama dengan UPT profil pemeriksa.';
  end if;
  if v_gudang is null or not exists (
    select 1 from gudang g where g.id = v_gudang and g.upt_id = v_actor_upt
  ) then
    raise exception 'Gudang BA tidak ditemukan pada UPT pemeriksa.';
  end if;
  if v_actor_gudang_ids is not null and (
    jsonb_typeof(v_actor_gudang_ids) <> 'array'
    or (jsonb_array_length(v_actor_gudang_ids) > 0 and not (v_actor_gudang_ids ? v_gudang))
  ) then
    raise exception 'Gudang BA tidak diizinkan untuk pemeriksa ini.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Daftar material tidak valid.';
  end if;

  v_count := jsonb_array_length(p_items);
  if v_count < 1 or v_count > 10 then
    raise exception 'Satu BA harus berisi 1 sampai 10 material (diterima %).', v_count;
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where nullif(e.value->>'stock_id', '') is null
  ) then
    raise exception 'Setiap material wajib punya stock_id.';
  end if;
  if (select count(distinct e.value->>'stock_id') from jsonb_array_elements(p_items) e) <> v_count then
    raise exception 'Material duplikat dalam satu BA tidak diperbolehkan.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where not exists (select 1 from stocks s where s.id = e.value->>'stock_id')
  ) then
    raise exception 'Ada stock_id yang tidak ditemukan di data stok.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) e
    join stocks s on s.id = e.value->>'stock_id'
    left join lokasi l on l.id = s.lokasi_id
    left join gudang g on g.id = l.gudang_id
    where g.id is null or g.id <> v_gudang or g.upt_id <> v_actor_upt
  ) then
    raise exception 'Setiap material harus berada pada gudang dan UPT BA yang dipilih.';
  end if;
  -- decision: jenisBarang 'Cadang' TIDAK divalidasi di sini. Filter itu urusan
  -- picker UI; data katalog lama banyak yang jenisBarang-nya kosong, jadi cek di
  -- RPC malah memblokir inspeksi sah. Identitas material tetap aman karena
  -- katalog_id/lokasi_id diambil dari JOIN ke stocks, bukan dari input client.

  insert into material_inspection_seq (upt_id, tahun, last_seq)
  values (v_upt, extract(year from v_tanggal)::int, 1)
  on conflict (upt_id, tahun) do update set last_seq = material_inspection_seq.last_seq + 1
  returning last_seq into v_seq;

  v_nomor := lpad(v_seq::text, 6, '0') || '/BA-INSPEKSI/' || v_upt || '/'
    || to_char(v_tanggal, 'MM') || '/' || to_char(v_tanggal, 'YYYY');

  insert into material_inspection_batches (nomor_ba, upt_id, gudang_id, tanggal, inspector_id, data)
  values (v_nomor, v_upt, v_gudang, v_tanggal, v_inspector, coalesce(p_header, '{}'::jsonb))
  returning id into v_batch_id;

  with inserted as (
    insert into material_inspections (batch_id, stock_id, katalog_id, lokasi_id, inspector_id, data)
    select v_batch_id, s.id, s.katalog_id, s.lokasi_id, v_inspector, e.value - 'stock_id'
    from jsonb_array_elements(p_items) e
    join stocks s on s.id = e.value->>'stock_id'
    returning id, batch_id, stock_id, katalog_id, lokasi_id, inspector_id, data, created_at
  )
  select coalesce(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb) into v_items from inserted;

  return jsonb_build_object('batch_id', v_batch_id, 'nomor_ba', v_nomor, 'items', v_items);
end;
$$ language plpgsql security definer set search_path = public;
revoke all on function public.create_material_inspection_batch(jsonb, jsonb) from public;
grant execute on function public.create_material_inspection_batch(jsonb, jsonb) to authenticated;

-- Migrasi data v1 (1 inspeksi = 1 BA) → struktur batch. Idempoten: hanya
-- menyentuh item dengan batch_id IS NULL, jadi aman dijalankan ulang.
do $$
declare
  r record;
  v_seq bigint;
  v_upt text;
  v_tanggal date;
  v_batch_id uuid;
begin
  for r in
    select mi.id, mi.inspector_id, mi.created_at, mi.data, l.gudang_id
    from material_inspections mi
    left join lokasi l on l.id = mi.lokasi_id
    where mi.batch_id is null
    order by mi.created_at
  loop
    v_upt := 'UPT-SBY';
    v_tanggal := r.created_at::date;
    insert into material_inspection_seq (upt_id, tahun, last_seq)
    values (v_upt, extract(year from v_tanggal)::int, 1)
    on conflict (upt_id, tahun) do update set last_seq = material_inspection_seq.last_seq + 1
    returning last_seq into v_seq;

    insert into material_inspection_batches (nomor_ba, upt_id, gudang_id, tanggal, inspector_id, data)
    values (
      lpad(v_seq::text, 6, '0') || '/BA-INSPEKSI/' || v_upt || '/'
        || to_char(v_tanggal, 'MM') || '/' || to_char(v_tanggal, 'YYYY'),
      v_upt,
      r.gudang_id,
      v_tanggal,
      r.inspector_id,
      jsonb_build_object('managerUpt', 'Yaya Supriman')
        || coalesce(r.data->'finalBa', '{}'::jsonb)
    )
    returning id into v_batch_id;

    update material_inspections set batch_id = v_batch_id where id = r.id;
  end loop;
end $$;

-- Setelah migrasi, batch_id wajib. Dipisah dari DO block supaya kalau ada row
-- sisa yang gagal termigrasi, error-nya kelihatan di sini (bukan silently null).
alter table material_inspections alter column batch_id set not null;

insert into storage.buckets (id, name, public)
values ('material-inspection-photos', 'material-inspection-photos', false)
on conflict (id) do update set public = false;
drop policy if exists "Authenticated read material-inspection-photos" on storage.objects;
drop policy if exists "Admin TL insert material-inspection-photos" on storage.objects;
drop policy if exists "Admin TL cleanup material-inspection-photos" on storage.objects;
create policy "Authenticated read material-inspection-photos" on storage.objects
  for select to authenticated using (
    bucket_id = 'material-inspection-photos'
    and exists (
      select 1
      from material_inspections mi
      join material_inspection_batches b on b.id = mi.batch_id
      where coalesce(mi.data->'photoPaths', '[]'::jsonb) ? name
        and public.can_access_material_inspection_scope(b.upt_id, b.gudang_id)
    )
  );
create policy "Admin TL insert material-inspection-photos" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'material-inspection-photos'
    and name like (auth.uid()::text || '/%')
    and exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role in ('ADMIN', 'TL'))
  );
create policy "Admin TL cleanup material-inspection-photos" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'material-inspection-photos'
    and name like (auth.uid()::text || '/%')
    and exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role in ('ADMIN', 'TL'))
  );

-- ────────────────────────────────────────────────────────────
-- 21. HEAVY_EQUIPMENT / HEAVY_EQUIPMENT_LOANS — master alat berat + riwayat
--     peminjaman antar-UPT (menu "Alat Berat & Peminjaman UPT" di App.jsx).
--     Sebelumnya cuma localStorage/CLOUD (key pln_heavy_equipment_v1 /
--     pln_heavy_equipment_loans_v1), ditemukan saat audit 2026-07-06 belum
--     pernah disinkron ke Supabase sama sekali. Pola sama seperti katalog/
--     stocks/warehouse_capacity: jsonb generik supaya bisa pakai
--     syncMasterTable/loadMasterTable tanpa mapping kolom manual. Kolom
--     tambahan di heavy_equipment_loans murni untuk filter/index (status,
--     equipment_id, owner/requester UPT) — App.jsx tetap baca dari `data` jsonb.
-- ────────────────────────────────────────────────────────────
create table if not exists heavy_equipment (
  id text primary key,              -- id alat, dibuat App.jsx
  data jsonb not null default '{}'::jsonb,
  created_at bigint,
  upt text
);
create index if not exists idx_heavy_equipment_upt on heavy_equipment(upt);

alter table heavy_equipment enable row level security;
drop policy if exists "Authenticated read heavy_equipment" on heavy_equipment;
drop policy if exists "Authenticated write heavy_equipment" on heavy_equipment;
create policy "Authenticated read heavy_equipment" on heavy_equipment for select using (auth.role() = 'authenticated');
create policy "Authenticated write heavy_equipment" on heavy_equipment for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists heavy_equipment_loans (
  id text primary key,              -- id loan, dibuat App.jsx
  data jsonb not null default '{}'::jsonb,
  created_at bigint,
  equipment_id text,
  status text,
  owner_upt text,
  requester_upt text
);
create index if not exists idx_heavy_equipment_loans_equipment on heavy_equipment_loans(equipment_id);
create index if not exists idx_heavy_equipment_loans_status on heavy_equipment_loans(status);

alter table heavy_equipment_loans enable row level security;
drop policy if exists "Authenticated read heavy_equipment_loans" on heavy_equipment_loans;
drop policy if exists "Authenticated write heavy_equipment_loans" on heavy_equipment_loans;
create policy "Authenticated read heavy_equipment_loans" on heavy_equipment_loans for select using (auth.role() = 'authenticated');
create policy "Authenticated write heavy_equipment_loans" on heavy_equipment_loans for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────
-- 22. STOCK_OPNAME / STOCK_COUNT — sesi Stock Opname (banding SAP/fisik vs sistem,
--     approval Asman->Manager) & Stock Count (banding SAP vs Aplikasi, read-only).
--     Sebelumnya cuma localStorage/CLOUD (key pln_opname_v1 / pln_stockcount_v1) —
--     ditemukan 2026-07-07 saat user lapor widget akurasi Dashboard tidak muncul di
--     device/browser lain, ternyata data ini TIDAK PERNAH disinkron ke Supabase sama
--     sekali (beda device/browser = data tidak ada). Pola sama seperti heavy_equipment
--     di atas: jsonb generik, App.jsx tetap baca dari `data`.
-- ────────────────────────────────────────────────────────────
create table if not exists stock_opname (
  id text primary key,              -- id sesi opname, dibuat App.jsx ("OPN-...")
  data jsonb not null default '{}'::jsonb,
  created_at bigint,
  status text                       -- DRAFT/PENDING_ASMAN/PENDING_MANAGER/SELESAI/DITOLAK
);
create index if not exists idx_stock_opname_status on stock_opname(status);

alter table stock_opname enable row level security;
drop policy if exists "Authenticated read stock_opname" on stock_opname;
drop policy if exists "Authenticated write stock_opname" on stock_opname;
create policy "Authenticated read stock_opname" on stock_opname for select using (auth.role() = 'authenticated');
create policy "Authenticated write stock_opname" on stock_opname for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists stock_count (
  id text primary key,              -- id sesi stock count, dibuat App.jsx ("SC-...")
  data jsonb not null default '{}'::jsonb,
  created_at bigint
);

alter table stock_count enable row level security;
drop policy if exists "Authenticated read stock_count" on stock_count;
drop policy if exists "Authenticated write stock_count" on stock_count;
create policy "Authenticated read stock_count" on stock_count for select using (auth.role() = 'authenticated');
create policy "Authenticated write stock_count" on stock_count for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────
-- 23. ATTB_LIST — pipeline monitoring penghapusan aset material ATTB
--     (Aktiva Tetap Tidak Beroperasi), 6 jenis aset (Tanah/Bangunan/
--     Saluran Air/Jalan/Kendaraan/Material), 5 tahap linear: Usulan AE.1 ->
--     AE.1 s.d. AE.4 -> Siap Cek Dekom -> Cek KJPP -> Menunggu Lelang.
--     Pola sama heavy_equipment: jsonb generik, App.jsx baca dari `data`.
--     Lihat docs/ATTB_SPEC.md untuk spesifikasi lengkap.
-- ────────────────────────────────────────────────────────────
create table if not exists attb_list (
  id text primary key,              -- id item ATTB, dibuat App.jsx ("ATTB-...")
  data jsonb not null default '{}'::jsonb,
  created_at bigint,
  upt text,
  stage text                        -- 1_USULAN/2_AE1_AE4/3_DEKOM/4_KJPP/5_LELANG
);
create index if not exists idx_attb_list_upt on attb_list(upt);
create index if not exists idx_attb_list_stage on attb_list(stage);

alter table attb_list enable row level security;
drop policy if exists "Authenticated read attb_list" on attb_list;
drop policy if exists "Authenticated write attb_list" on attb_list;
create policy "Authenticated read attb_list" on attb_list for select using (auth.role() = 'authenticated');
create policy "Authenticated write attb_list" on attb_list for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- MATURITY_ASSESSMENTS / MATURITY_AUDITS — canonical self-host persistence.
-- `data` stores form/evidence metadata only; binary/base64 is not permitted.
create table if not exists maturity_assessments (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at bigint not null,
  assessment_at bigint,
  level smallint not null check (level between 1 and 5),
  created_by uuid references profiles(id) on delete set null
);
create index if not exists idx_maturity_assessments_assessment_at on maturity_assessments(assessment_at desc);
alter table maturity_assessments enable row level security;
drop policy if exists "Authenticated read maturity_assessments" on maturity_assessments;
drop policy if exists "Authenticated write maturity_assessments" on maturity_assessments;
create policy "Authenticated read maturity_assessments" on maturity_assessments for select using (auth.role() = 'authenticated');
create policy "Authenticated write maturity_assessments" on maturity_assessments for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
grant select, insert, update, delete on maturity_assessments to authenticated;
grant all on maturity_assessments to service_role;

create table if not exists maturity_audits (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at bigint not null,
  updated_at bigint,
  upt text not null,
  period_key text not null default to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM') check (period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status text not null check (status in ('DRAFT', 'SELF_ASSESSMENT', 'REVIEW_UIT', 'REVISION', 'FINAL')),
  level smallint not null check (level between 1 and 5),
  score numeric(4,2) not null default 1 check (score between 0 and 5),
  updated_by uuid references profiles(id) on delete set null
);
create index if not exists idx_maturity_audits_upt_updated_at on maturity_audits(upt, updated_at desc);
create index if not exists idx_maturity_audits_status on maturity_audits(status);
create unique index if not exists idx_maturity_audits_upt_period_key on maturity_audits(upt, period_key);
alter table maturity_audits enable row level security;
drop policy if exists "Authenticated read maturity_audits" on maturity_audits;
drop policy if exists "Authenticated write maturity_audits" on maturity_audits;
create policy "Authenticated read maturity_audits" on maturity_audits for select using (auth.role() = 'authenticated');
create policy "Authenticated write maturity_audits" on maturity_audits for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
grant select, insert, update, delete on maturity_audits to authenticated;
grant all on maturity_audits to service_role;

-- MATURITY_AUDIT_HISTORY â€” ringkasan nilai per UPT/semester. Dipisahkan dari
-- maturity_audits agar data historis tidak dianggap sebagai audit workflow aktif.
create table if not exists maturity_audit_history (
  id text primary key,
  upt text not null,
  tahun smallint not null check (tahun between 2000 and 2100),
  semester smallint not null check (semester in (1, 2)),
  score numeric(4,2) not null check (score between 0 and 5),
  target numeric(4,2) check (target is null or (target between 0 and 5)), -- migration 20260902_maturity_target.sql
  status text not null check (status in ('ARSIP', 'FINAL', 'BERJALAN')),
  source text not null default 'HISTORIS_TERVERIFIKASI',
  notes text not null default '',
  created_at bigint not null default ((extract(epoch from now()) * 1000)::bigint),
  updated_at bigint not null default ((extract(epoch from now()) * 1000)::bigint),
  updated_by uuid references profiles(id) on delete set null,
  unique (upt, tahun, semester)
);
create index if not exists idx_maturity_audit_history_upt_period on maturity_audit_history(upt, tahun desc, semester desc);
alter table maturity_audit_history enable row level security;
drop policy if exists "Authenticated read maturity_audit_history" on maturity_audit_history;
drop policy if exists "Authenticated write maturity_audit_history" on maturity_audit_history;
create policy "Authenticated read maturity_audit_history" on maturity_audit_history for select using (auth.role() = 'authenticated');
create policy "Authenticated write maturity_audit_history" on maturity_audit_history for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
grant select, insert, update, delete on maturity_audit_history to authenticated;
grant all on maturity_audit_history to service_role;

insert into maturity_audit_history (id, upt, tahun, semester, score, status, source) values
  ('MAH-UPT-SBY-2024-S1', 'UPT Surabaya', 2024, 1, 3.58, 'ARSIP', 'HISTORIS_TERVERIFIKASI'),
  ('MAH-UPT-SBY-2024-S2', 'UPT Surabaya', 2024, 2, 3.74, 'ARSIP', 'HISTORIS_TERVERIFIKASI'),
  ('MAH-UPT-SBY-2025-S1', 'UPT Surabaya', 2025, 1, 3.86, 'FINAL', 'HISTORIS_TERVERIFIKASI'),
  ('MAH-UPT-SBY-2025-S2', 'UPT Surabaya', 2025, 2, 4.12, 'FINAL', 'HISTORIS_TERVERIFIKASI'),
  ('MAH-UPT-SBY-2026-S1', 'UPT Surabaya', 2026, 1, 4.26, 'BERJALAN', 'HISTORIS_TERVERIFIKASI')
on conflict (upt, tahun, semester) do nothing;

-- MATURITY_5S_ASSESSMENTS -- append-only checklist history. A period is not
-- unique because repeated inspections in the same month must remain visible.
create table if not exists maturity_5s_assessments (
  id text primary key,
  upt text not null,
  gudang_id text,
  gudang_nama text not null default '',
  bulan smallint not null check (bulan between 1 and 12),
  tahun smallint not null check (tahun between 2000 and 2100),
  auditor text not null default '',
  checklist jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array'),
  sample_photos jsonb not null default '[]'::jsonb check (jsonb_typeof(sample_photos) = 'array'),
  total_items smallint not null check (total_items >= 0),
  total_checked smallint not null check (total_checked between 0 and total_items),
  score_percent numeric(5,2) not null check (score_percent between 0 and 100),
  catatan text not null default '',
  created_at bigint not null default ((extract(epoch from now()) * 1000)::bigint),
  created_by uuid references profiles(id) on delete set null
);
create index if not exists idx_maturity_5s_assessments_history on maturity_5s_assessments(upt, gudang_id, tahun desc, bulan desc, created_at desc);
alter table maturity_5s_assessments enable row level security;
drop policy if exists "Authenticated read maturity_5s_assessments" on maturity_5s_assessments;
drop policy if exists "Authenticated write maturity_5s_assessments" on maturity_5s_assessments;
drop policy if exists "Authenticated insert maturity_5s_assessments" on maturity_5s_assessments;
create policy "Authenticated read maturity_5s_assessments" on maturity_5s_assessments for select using (auth.role() = 'authenticated');
create policy "Authenticated insert maturity_5s_assessments" on maturity_5s_assessments for insert with check (auth.role() = 'authenticated');
revoke update, delete on maturity_5s_assessments from authenticated;
grant select, insert on maturity_5s_assessments to authenticated;
grant all on maturity_5s_assessments to service_role;

-- Maturity Drive: database retains IDs/metadata only; file bytes stay in Drive.
create table if not exists maturity_audit_events (
  id uuid primary key default gen_random_uuid(), audit_id text not null,
  event_type text not null check (event_type in ('AUDIT_CREATED','AUDIT_SAVED','STATUS_CHANGED','TREE_ENSURED','EVIDENCE_UPLOADED','EVIDENCE_SYNCED','EVIDENCE_ASSIGNED','EVIDENCE_UNLINKED','EVIDENCE_DOWNLOADED')),
  actor_id uuid references profiles(id) on delete set null, event_data jsonb not null default '{}'::jsonb,
  created_at bigint not null default ((extract(epoch from now()) * 1000)::bigint)
);
create index if not exists idx_maturity_audit_events_audit_created on maturity_audit_events(audit_id, created_at desc);
create or replace function public.log_maturity_audit_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.maturity_audit_events (audit_id, event_type, actor_id, event_data)
    values (new.id, 'AUDIT_CREATED', new.updated_by,
      jsonb_build_object('status', new.status, 'score', new.score, 'level', new.level, 'period_key', new.period_key, 'audit_updated_at', new.updated_at));
  else
    insert into public.maturity_audit_events (audit_id, event_type, actor_id, event_data)
    values (new.id,
      case when new.status is distinct from old.status then 'STATUS_CHANGED' else 'AUDIT_SAVED' end,
      new.updated_by,
      jsonb_build_object('status_from', old.status, 'status_to', new.status, 'score_from', old.score, 'score_to', new.score, 'level_from', old.level, 'level_to', new.level, 'period_key', new.period_key, 'audit_updated_at', new.updated_at));
  end if;
  return new;
end;
$$;
drop trigger if exists trg_maturity_audits_events on public.maturity_audits;
create trigger trg_maturity_audits_events after insert or update on public.maturity_audits
for each row execute function public.log_maturity_audit_event();
create table if not exists maturity_audit_evidence (
  id uuid primary key default gen_random_uuid(), audit_id text not null,
  aspect_id text not null, item_id text not null, item_label text not null default '',
  category_id text not null default '', category_label text not null default '', upt text not null,
  drive_file_id text not null unique, drive_folder_id text, file_name text not null,
  mime_type text not null default 'application/octet-stream', file_size bigint not null default 0 check (file_size >= 0), md5_checksum text,
  source text not null default 'UPLOAD' check (source in ('UPLOAD','SYNC','ASSIGN')),
  linked_at bigint not null default ((extract(epoch from now()) * 1000)::bigint), linked_by uuid references profiles(id) on delete set null,
  unlinked_at bigint, unlinked_by uuid references profiles(id) on delete set null
);
-- No audit FK: an existing UI draft may select evidence before its audit is saved.
create unique index if not exists idx_maturity_audit_evidence_active_item on maturity_audit_evidence(audit_id, drive_file_id) where unlinked_at is null;
create index if not exists idx_maturity_audit_evidence_audit_aspect on maturity_audit_evidence(audit_id, aspect_id) where unlinked_at is null;
create table if not exists maturity_audit_drive_folders (
  id uuid primary key default gen_random_uuid(), mapping_key text not null unique, audit_id text, period_key text,
  folder_type text not null check (folder_type in ('ROOT','PERIOD','UPT','CATEGORY','ASPECT','ITEM')),
  parent_mapping_key text, drive_folder_id text not null unique, drive_root_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at bigint not null default ((extract(epoch from now()) * 1000)::bigint),
  updated_at bigint not null default ((extract(epoch from now()) * 1000)::bigint)
);
create index if not exists idx_maturity_audit_drive_folders_audit on maturity_audit_drive_folders(audit_id, folder_type);
alter table maturity_audit_events enable row level security;
alter table maturity_audit_evidence enable row level security;
alter table maturity_audit_drive_folders enable row level security;
revoke all on maturity_audit_events, maturity_audit_evidence, maturity_audit_drive_folders from anon, authenticated;
grant all on maturity_audit_events, maturity_audit_evidence, maturity_audit_drive_folders to service_role;

-- Maturity Drive security delta: canonical UPT/actor scope and recoverable
-- assignment records. Mirrors 20260802_maturity_drive_security_delta.sql.
alter table maturity_audits add column if not exists upt_id text references upt(id) on delete restrict;
alter table maturity_audits add column if not exists created_by uuid references profiles(id) on delete set null;
update maturity_audits audit set upt_id = unit.id from upt unit where audit.upt_id is null and unit.data->>'nama' = audit.upt;
update maturity_audits set created_by = updated_by where created_by is null;
alter table maturity_audits alter column upt_id set not null;
alter table maturity_audits alter column created_by drop not null;
drop index if exists idx_maturity_audits_upt_period_key;
create unique index if not exists idx_maturity_audits_upt_id_period_key on maturity_audits(upt_id, period_key);
alter table maturity_audit_evidence add column if not exists upt_id text references upt(id) on delete restrict;
update maturity_audit_evidence evidence set upt_id = audit.upt_id from maturity_audits audit where evidence.upt_id is null and evidence.audit_id = audit.id;
alter table maturity_audit_evidence alter column upt_id set not null;
alter table maturity_audit_evidence add column if not exists assignment_state text not null default 'ACTIVE';
alter table maturity_audit_evidence drop constraint if exists maturity_audit_evidence_assignment_state_check;
alter table maturity_audit_evidence add constraint maturity_audit_evidence_assignment_state_check check (assignment_state in ('ACTIVE','NEEDS_REPAIR'));
create table if not exists maturity_audit_drive_unassigned (
  id uuid primary key default gen_random_uuid(), audit_id text not null references maturity_audits(id) on delete cascade,
  upt_id text not null references upt(id) on delete restrict, period_key text not null check (period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  drive_root_id text not null, drive_file_id text not null, source_folder_id text not null, file_name text not null,
  mime_type text not null default 'application/octet-stream', file_size bigint not null default 0 check (file_size >= 0), md5_checksum text,
  assignment_state text not null default 'UNASSIGNED' check (assignment_state in ('UNASSIGNED','ASSIGNING','ACTIVE','NEEDS_REPAIR')),
  target_folder_id text, target_aspect_id text, target_item_id text, target_item_label text, target_category_id text, target_category_label text,
  assigned_by uuid references profiles(id) on delete set null, assigned_at bigint, last_error text,
  created_at bigint not null default ((extract(epoch from now()) * 1000)::bigint), updated_at bigint not null default ((extract(epoch from now()) * 1000)::bigint),
  unique (audit_id, drive_file_id)
);
create index if not exists idx_maturity_drive_unassigned_scope on maturity_audit_drive_unassigned(audit_id, upt_id, period_key, assignment_state);
alter table maturity_audit_drive_unassigned enable row level security;
revoke all on maturity_audit_drive_unassigned from anon, authenticated;
grant all on maturity_audit_drive_unassigned to service_role;
create or replace function public.set_maturity_audit_actor()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_maturity_audits_actor on public.maturity_audits;
create trigger trg_maturity_audits_actor before insert or update on public.maturity_audits for each row execute function public.set_maturity_audit_actor();
create or replace function public.create_maturity_drive_stub(p_audit_id text, p_upt_id text, p_period_key text, p_created_at bigint, p_actor_id uuid)
returns table(id text, upt text, upt_id text, uit_id text, status text, created_at bigint, period_key text, score numeric)
language plpgsql security definer set search_path = public as $$
declare v_upt text; v_uit_id text;
begin
  select unit.data->>'nama', unit.uit_id into v_upt, v_uit_id
  from public.upt unit where unit.id = p_upt_id;
  if v_upt is null then raise exception 'UPT tidak ditemukan' using errcode = '22023'; end if;
  begin
    insert into public.maturity_audits (id,data,created_at,updated_at,upt,upt_id,period_key,status,level,score,created_by,updated_by)
    values (p_audit_id,jsonb_build_object('id',p_audit_id,'upt',v_upt,'uptId',p_upt_id,'status','DRAFT','level',1,'score',1,'periodKey',p_period_key,'createdAt',p_created_at,'updatedAt',p_created_at,'evidence','{}'::jsonb,'maturityDriveDraft',true),p_created_at,p_created_at,v_upt,p_upt_id,p_period_key,'DRAFT',1,1,p_actor_id,p_actor_id);
  exception when unique_violation then
    if exists (select 1 from public.maturity_audits where upt_id=p_upt_id and period_key=p_period_key and id<>p_audit_id) then raise exception 'UPT ini sudah memiliki audit Maturity untuk periode %.',p_period_key using errcode='23505'; end if;
  end;
  return query select a.id,a.upt,a.upt_id,unit.uit_id,a.status,a.created_at,a.period_key,a.score from public.maturity_audits a join public.upt unit on unit.id=a.upt_id where a.id=p_audit_id;
end;
$$;
revoke all on function public.create_maturity_drive_stub(text,text,text,bigint,uuid) from public;
grant execute on function public.create_maturity_drive_stub(text,text,text,bigint,uuid) to service_role;

-- ────────────────────────────────────────────────────────────
-- 24. STOCK_PHOTO_EMBEDDINGS — pencarian barang Data Stok BERDASARKAN FOTO
--     (visual search ala toko online). Tiap baris = 1 foto material + embedding
--     vektornya (Cohere embed-multilingual-v3.0, input_type=image, 1024 dim).
--
--     SCOPE PER-UPT (Opsi B): foto TIDAK dicampur antar-UPT walau nomor katalog
--     sama (katalog PLN itu standar nasional, 36 nomor dipakai >1 UPT). Tiap UPT
--     punya fotonya sendiri → onboarding UPT baru murni menambah, tidak menimpa
--     data UPT lain. Primary key & path Storage di-namespace slug UPT.
--       id           = "spe_<uptslug>_<katalog>_<source>"
--       storage path = stock-photos/<uptslug>/<katalog>/<source>.jpg
--
--     Sumber awal: migrasi foto dari AppSheet (scripts/migrate_material_photos.mjs,
--     per UPT). Ke depan: upload foto baru di app langsung di-embed real-time.
--     Dikunci per NOMOR KATALOG (foto = identitas jenis material, bukan per lokasi
--     stok), jadi semua baris stok dari katalog itu berbagi foto yang sama.
-- ────────────────────────────────────────────────────────────
create extension if not exists vector;   -- (idempotent; sudah ada dari section 9 RAG)

create table if not exists stock_photo_embeddings (
  id         text primary key,      -- "spe_<uptslug>_<katalog>_<source>", stabil → re-run = upsert
  upt        text not null,         -- scope UPT (Opsi B) — "UPT Surabaya" dst
  katalog    text not null,         -- join key ke Master Katalog / stocks
  source     text not null,         -- 'utama' | 'tambahan' | 'nameplate'
  photo_url  text not null,         -- URL publik di bucket stock-photos
  embedding  vector(1024),
  ocr_text   text,                  -- Fase 2 (OCR nameplate); null utk sekarang
  updated_at timestamptz default now()
);
create index if not exists idx_spe_upt_katalog on stock_photo_embeddings(upt, katalog);
create index if not exists idx_spe_embedding on stock_photo_embeddings using hnsw (embedding vector_cosine_ops);

alter table stock_photo_embeddings enable row level security;
drop policy if exists "Authenticated read spe" on stock_photo_embeddings;
drop policy if exists "Authenticated write spe" on stock_photo_embeddings;
create policy "Authenticated read spe"  on stock_photo_embeddings for select using (auth.role() = 'authenticated');
create policy "Authenticated write spe" on stock_photo_embeddings for all   using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Pencarian similarity per MATERIAL: skor = kemiripan tertinggi antar foto katalog
-- itu, disaring >= min_similarity (default 0.60), top match_count (default 10).
-- p_upt: viewer hanya mencocokkan foto UPT-nya sendiri (stok memang per-UPT);
-- null = lintas semua UPT. Dipanggil App.jsx lewat supabase.rpc('match_stock_photos', ...).
create or replace function match_stock_photos(
  query_embedding vector(1024),
  p_upt text default null,
  match_count int default 10,
  min_similarity float default 0.6
)
returns table(katalog text, similarity float)
language sql stable
as $$
  select katalog, max(1 - (embedding <=> query_embedding)) as similarity
  from stock_photo_embeddings
  where embedding is not null
    and (p_upt is null or upt = p_upt)
  group by katalog
  having max(1 - (embedding <=> query_embedding)) >= min_similarity
  order by similarity desc
  limit match_count;
$$;

-- Bucket foto untuk visual search (dedicated, terpisah dari 'material-photos').
-- Public-read supaya thumbnail cepat tampil; upload lewat service key (migrasi)
-- maupun anon key (upload foto baru dari app), pola sama seperti material-photos.
insert into storage.buckets (id, name, public)
values ('stock-photos', 'stock-photos', true)
on conflict (id) do update set public = true;

drop policy if exists "Public read stock-photos" on storage.objects;
drop policy if exists "Public upload stock-photos" on storage.objects;
drop policy if exists "Public update stock-photos" on storage.objects;
create policy "Public read stock-photos" on storage.objects
  for select using (bucket_id = 'stock-photos');
create policy "Public upload stock-photos" on storage.objects
  for insert with check (bucket_id = 'stock-photos');
create policy "Public update stock-photos" on storage.objects
  for update using (bucket_id = 'stock-photos');

-- ────────────────────────────────────────────────────────────
-- 25. FOTO TRANSAKSI TUG — dipindah dari base64 (blob window.storage, limit
--     ~5MB/key) ke Supabase Storage supaya blob transaksi tetap ringan & muat
--     ratusan transaksi. Field foto di data transaksi menyimpan URL (publik)
--     atau path (privat), BUKAN base64. Foto dikompres di client sebelum upload
--     (compressImage): foto barang/surat ≤1MB, SIM/KTP ≤300KB.
--
--     DUA bucket dengan sifat berbeda:
--       tug-photos       PUBLIC  — foto kendaraan/material/surat jalan/BA/kontrak
--                                  (bukan data pribadi; perlu tampil cepat & di
--                                  dokumen TUG yang bisa disimpan/di-print).
--       tug-docs-private PRIVATE — SIM/KTP pengemudi (DATA PRIBADI). Diakses via
--                                  signed URL berumur pendek, hanya user login.
--                                  Upload/baca dari app pakai sesi Supabase Auth
--                                  (role authenticated), bukan anon key.
-- ────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('tug-photos', 'tug-photos', true)
on conflict (id) do update set public = true;

drop policy if exists "Public read tug-photos" on storage.objects;
drop policy if exists "Public upload tug-photos" on storage.objects;
drop policy if exists "Public update tug-photos" on storage.objects;
create policy "Public read tug-photos" on storage.objects
  for select using (bucket_id = 'tug-photos');
create policy "Public upload tug-photos" on storage.objects
  for insert with check (bucket_id = 'tug-photos');
create policy "Public update tug-photos" on storage.objects
  for update using (bucket_id = 'tug-photos');

insert into storage.buckets (id, name, public)
values ('tug-docs-private', 'tug-docs-private', false)
on conflict (id) do update set public = false;

drop policy if exists "Auth read tug-docs-private" on storage.objects;
drop policy if exists "Auth upload tug-docs-private" on storage.objects;
drop policy if exists "Auth update tug-docs-private" on storage.objects;
create policy "Auth read tug-docs-private" on storage.objects
  for select using (bucket_id = 'tug-docs-private' and auth.role() = 'authenticated');
create policy "Auth upload tug-docs-private" on storage.objects
  for insert with check (bucket_id = 'tug-docs-private' and auth.role() = 'authenticated');
create policy "Auth update tug-docs-private" on storage.objects
  for update using (bucket_id = 'tug-docs-private' and auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────
-- 26. LEGACY_HISTORY_ARCHIVE — arsip READ-ONLY riwayat transaksi dari aplikasi
--     WARNOTO versi lama (AppSheet, DB Excel). Terpisah TOTAL dari tug15_history
--     (transaksi live) — TANPA FK ke `katalog` karena kode katalog lama banyak
--     tidak match master katalog aktif; memaksa FK akan menolak baris legacy yang
--     sah atau merusak katalog live. Kode/nama katalog di sini APA ADANYA dari
--     data lama, tidak divalidasi ulang. Format dibakukan supaya UPT lain juga
--     bisa pakai pipeline yang sama (lihat migration-tools/README.md).
--     Diisi via migration-tools/load_legacy_history_to_supabase.mjs (service_role
--     saja) dari hasil migration-tools/clean_warnoto_history.py — TIDAK ada
--     tulisan dari App.jsx.
-- ────────────────────────────────────────────────────────────
create table if not exists legacy_history_archive (
  id bigint generated always as identity primary key,
  source_app text not null default 'appsheet_warnoto', -- antisipasi sumber legacy lain di masa depan
  source_upt text,                -- "UPT Surabaya", "UPT Gresik", dst — teks bebas, bukan FK ke lokasi aktif
  doc_type text,                  -- TUG3/TUG5/TUG8/TUG9/TUG10
  doc_id text,                    -- No Dokumen/No Bon dari AppSheet
  item_id text,
  tanggal date,
  jenis_transaksi text,           -- MASUK/KELUAR/PERMINTAAN
  no_katalog text,                -- kode katalog APA ADANYA dari data lama, tidak divalidasi ke katalog aktif
  nama_material text,
  satuan text,
  qty numeric,
  unit_lawan text,
  lokasi_kode text,
  catatan text,
  link_foto text,                 -- link Google Drive asli AppSheet, tidak dimigrasi fisik
  match_confidence numeric,       -- dari hasil cleansing (0-100), transparansi kualitas data ke admin
  issue_flags text,               -- anomali dari cleansing (mis. "KATALOG_KOSONG; NAMA_BEDA_DENGAN_MASTER"), kosong = bersih
  sync_key text,                  -- dedupe idempotent antar-run import
  imported_by text,
  imported_at timestamptz default now()
);
create unique index if not exists idx_legacy_history_sync_key on legacy_history_archive(sync_key);
create index if not exists idx_legacy_history_upt_doctype on legacy_history_archive(source_upt, doc_type);

alter table legacy_history_archive enable row level security;
-- Read HANYA untuk user login (BUKAN public seperti tug15_history) — arsip internal,
-- bukan untuk halaman scan publik. Insert/update/delete HANYA lewat service_role
-- (loader script), sengaja TIDAK ada policy write untuk anon/authenticated.
drop policy if exists "Authenticated read legacy_history_archive" on legacy_history_archive;
create policy "Authenticated read legacy_history_archive" on legacy_history_archive
  for select using (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────
-- 27. LAMPIRAN ARSIP LEGACY — foto/PDF dokumen AppSheet lama yang file fisiknya
--     ikut di-backup (path relatif lokal, bukan URL Drive). Diupload ke Supabase
--     Storage oleh migration-tools/upload_legacy_history_attachments.mjs
--     (service_role saja), dua bucket sesuai sensitivitas:
--       - tug-docs-private : foto SIM/KTP sopir + PDF dokumen (data pribadi) —
--                            disimpan sebagai `priv:<path>`, resolve via signed URL.
--       - tug-photos       : foto surat jalan/permintaan/pengembalian, kendaraan,
--                            dan foto barang (public URL langsung).
-- ────────────────────────────────────────────────────────────
alter table legacy_history_archive add column if not exists foto_barang_url text; -- backup foto item ke tug-photos (link_foto Drive lama bisa mati sewaktu-waktu)

create table if not exists legacy_history_documents (
  id bigint generated always as identity primary key,
  source_app text not null default 'appsheet_warnoto',
  source_upt text,
  doc_type text,                  -- TUG3/TUG5/TUG8/TUG9/TUG10
  doc_id text,                    -- No Dokumen/No Bon dari AppSheet
  foto_surat_jalan_url text,      -- public (tug-photos)
  foto_sim_ktp_url text,          -- private, disimpan sbg `priv:<path>` (tug-docs-private)
  foto_kendaraan_url text,        -- public (tug-photos)
  pdf_url text,                   -- private, disimpan sbg `priv:<path>` (tug-docs-private)
  berita_acara_url text,          -- private, disimpan sbg `priv:<path>` (tug-docs-private)
  lampiran_url text,              -- private, disimpan sbg `priv:<path>` (tug-docs-private)
  match_notes text,               -- jejak resolusi file (mis. "sim_ktp: AMBIGU 2 kandidat beda isi, dipilih dari WARNOTOV2-2757983")
  imported_by text,
  imported_at timestamptz default now()
);
create unique index if not exists idx_legacy_history_documents_doc on legacy_history_documents(doc_type, doc_id);

alter table legacy_history_documents enable row level security;
-- Sama seperti legacy_history_archive: read hanya user login, write HANYA service_role.
drop policy if exists "Authenticated read legacy_history_documents" on legacy_history_documents;
create policy "Authenticated read legacy_history_documents" on legacy_history_documents
  for select using (auth.role() = 'authenticated');

-- Privilege minimum untuk endpoint REST self-host: RLS di atas tetap menjadi
-- pengaman row-level; tidak ada DELETE/TRUNCATE atau default privilege tambahan.
grant usage on schema public to authenticated, service_role;
grant select on legacy_history_archive, legacy_history_documents to authenticated;
grant select, insert, update on legacy_history_archive, legacy_history_documents to service_role;
grant usage on sequence legacy_history_archive_id_seq, legacy_history_documents_id_seq to service_role;

-- ────────────────────────────────────────────────────────────
-- EQUIPMENT_LOCATION / EQUIPMENT_TRIP / OPERATOR_PROFILE — Live Location Alat
-- Berat BATCH 1 (fondasi, migrations/20260903_equipment_tracking.sql). Role
-- OPERATOR + UI/peta/realtime client BELUM ada (batch berikut); RLS di sini
-- sengaja permisif-tapi-authenticated dulu (TODO scope UPT batch role).
-- ────────────────────────────────────────────────────────────
create table if not exists equipment_location (
  equipment_id text primary key,
  lat float8,
  lng float8,
  accuracy float8,
  updated_at bigint,
  updated_by uuid references profiles(id) on delete set null,
  upt text,
  status text check (status in ('MOVING','STOPPED'))
);

create table if not exists equipment_trip (
  id text primary key,
  equipment_id text,
  operator_id uuid references profiles(id) on delete set null,
  upt text,
  started_at bigint,
  ended_at bigint,
  distance_m float8,
  point_count int,
  path jsonb
);
alter table equipment_trip add column if not exists inspection jsonb;

create table if not exists operator_profile (
  user_id uuid primary key references profiles(id) on delete cascade,
  phone text,
  sio_photo text,
  sia_photo text,
  updated_at bigint
);
alter table operator_profile add column if not exists profile_photo text;

alter table equipment_location enable row level security;
alter table equipment_trip enable row level security;
alter table operator_profile enable row level security;

drop policy if exists "Authenticated read equipment_location" on equipment_location;
drop policy if exists "Authenticated write equipment_location" on equipment_location;
create policy "Authenticated read equipment_location" on equipment_location for select using (auth.role() = 'authenticated');
create policy "Authenticated write equipment_location" on equipment_location for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated read equipment_trip" on equipment_trip;
drop policy if exists "Authenticated write equipment_trip" on equipment_trip;
create policy "Authenticated read equipment_trip" on equipment_trip for select using (auth.role() = 'authenticated');
create policy "Authenticated write equipment_trip" on equipment_trip for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated read operator_profile" on operator_profile;
drop policy if exists "Authenticated write operator_profile" on operator_profile;
create policy "Authenticated read operator_profile" on operator_profile for select using (auth.role() = 'authenticated');
create policy "Authenticated write operator_profile" on operator_profile for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

grant select, insert, update, delete on equipment_location to authenticated;
grant all on equipment_location to service_role;
grant select, insert, update, delete on equipment_trip to authenticated;
grant all on equipment_trip to service_role;
grant select, insert, update, delete on operator_profile to authenticated;
grant all on operator_profile to service_role;

-- Realtime hanya equipment_location (posisi live). Idempoten.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'equipment_location'
     ) then
    alter publication supabase_realtime add table public.equipment_location;
  end if;
end $$;
