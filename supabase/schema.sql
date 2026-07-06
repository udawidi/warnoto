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
  role text not null,           -- ADMIN / TL / ASMAN / MANAGER / ADMIN_UIT / MGR_LOGISTIK_UIT / ADMIN_ULTG / MGR_ULTG / PENGADAAN / VIEWER
  jabatan text,
  avatar text,
  upt_id text,                  -- diisi untuk role scoped ke 1 UPT tertentu (opsional, biasanya via UPT konstan app)
  ultg_id text,                 -- WAJIB diisi untuk role ADMIN_ULTG / MGR_ULTG — unit ULTG yang dia wakili
  created_at timestamptz default now()
);
-- Migrasi installasi lama yang tabelnya sudah ada sebelum kolom ini ditambahkan:
alter table profiles add column if not exists upt_id text;
alter table profiles add column if not exists ultg_id text;

alter table profiles enable row level security;
drop policy if exists "Authenticated read profiles" on profiles;
-- Semua user yang sudah login boleh baca SEMUA profil (bukan cuma punya
-- sendiri) — App.jsx butuh ini untuk menampilkan nama "dibuat oleh"/
-- "disetujui oleh" pengguna lain di dokumen TUG, daftar approval, dst.
create policy "Authenticated read profiles" on profiles for select using (auth.role() = 'authenticated');
-- SENGAJA tidak ada policy insert/update untuk role authenticated biasa —
-- supaya user tidak bisa menaikkan role-nya sendiri lewat console browser.
-- Pembuatan/ubah profil Fase 1 lewat SQL manual (lihat instruksi migrasi),
-- Fase 2 nanti lewat Edge Function dengan service_role.

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
  id text primary key,           -- cth "katalog_KAT-1060011" atau "txn_TUG9-xxxxx"
  source_type text not null,     -- 'katalog' | 'txn'
  source_id text not null,       -- id katalog/txn aslinya, utk update/hapus saat sumber berubah
  content text not null,         -- teks yang di-embed (yang juga dikirim balik ke AI sebagai konteks)
  embedding vector(1024),
  updated_at timestamptz default now()
);
create index if not exists idx_rag_chunks_source on rag_chunks(source_type, source_id);
create index if not exists idx_rag_chunks_embedding on rag_chunks using hnsw (embedding vector_cosine_ops);

alter table rag_chunks enable row level security;
drop policy if exists "Authenticated read rag_chunks" on rag_chunks;
drop policy if exists "Authenticated write rag_chunks" on rag_chunks;
create policy "Authenticated read rag_chunks" on rag_chunks for select using (auth.role() = 'authenticated');
create policy "Authenticated write rag_chunks" on rag_chunks for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Pencarian similarity (cosine) — dipanggil dari App.jsx lewat supabase.rpc('match_rag_chunks', ...)
create or replace function match_rag_chunks(query_embedding vector(1024), match_count int default 8)
returns table(id text, source_type text, source_id text, content text, similarity float)
language sql stable
as $$
  select id, source_type, source_id, content, 1 - (embedding <=> query_embedding) as similarity
  from rag_chunks
  where embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- ────────────────────────────────────────────────────────────
-- 10. WAREHOUSE_CAPACITY — kapasitas gudang per sub-gudang (m2), baris LIVE
--     (setelah di-approve). Grain: UPT x Gudang x Sub Gudang. Sumber:
--     Laporan KAPASITAS GUDANG UIT JBM.xlsx, diimport lewat UI
--     (KapasitasGudangImportTab → approveCapacityImport di App.jsx).
--
--     RIWAYAT: skema ini sebelumnya kolom typed (upt/gudang/sub_gudang/dst)
--     tapi TIDAK PERNAH benar-benar disinkron App.jsx — fitur Kapasitas
--     Gudang cuma tersimpan localStorage/CLOUD sampai ditemukan saat audit
--     2026-07-03. Diganti ke pola jsonb (sama seperti katalog/stocks) supaya
--     bisa pakai syncMasterTable generik & tidak salah-mapping kolom lagi.
-- ────────────────────────────────────────────────────────────
create table if not exists warehouse_capacity (
  id text primary key,              -- "CAP-{UPT}-{GUDANG}-{SUB}" uppercase, dibuat App.jsx
  data jsonb not null default '{}'::jsonb,
  created_at bigint
);
-- Migrasi installasi lama (skema typed-column, orphan/basi -- lihat catatan di atas):
alter table warehouse_capacity drop column if exists upt;
alter table warehouse_capacity drop column if exists gudang;
alter table warehouse_capacity drop column if exists sub_gudang;
alter table warehouse_capacity drop column if exists type_gudang;
alter table warehouse_capacity drop column if exists alamat;
alter table warehouse_capacity drop column if exists latitude;
alter table warehouse_capacity drop column if exists longitude;
alter table warehouse_capacity drop column if exists luas_lahan_m2;
alter table warehouse_capacity drop column if exists luas_terpakai_m2;
alter table warehouse_capacity drop column if exists sisa_luas_m2;
alter table warehouse_capacity drop column if exists persentase_terpakai;
alter table warehouse_capacity drop column if exists persediaan_pct;
alter table warehouse_capacity drop column if exists cadang_pct;
alter table warehouse_capacity drop column if exists pre_memory_pct;
alter table warehouse_capacity drop column if exists attb_pct;
alter table warehouse_capacity drop column if exists lainnya_pct;
alter table warehouse_capacity drop column if exists status_kapasitas;
alter table warehouse_capacity drop column if exists contact_person;
alter table warehouse_capacity drop column if exists waktu_update;
alter table warehouse_capacity drop column if exists keterangan;
alter table warehouse_capacity drop column if exists link_gudang;
alter table warehouse_capacity drop column if exists matched_gudang_id;
alter table warehouse_capacity drop column if exists mapping_status;
alter table warehouse_capacity drop column if exists import_batch_id;
alter table warehouse_capacity drop column if exists updated_at;
alter table warehouse_capacity add column if not exists data jsonb not null default '{}'::jsonb;
alter table warehouse_capacity add column if not exists created_at bigint;

alter table warehouse_capacity enable row level security;
drop policy if exists "Authenticated read warehouse_capacity" on warehouse_capacity;
drop policy if exists "Authenticated write warehouse_capacity" on warehouse_capacity;
create policy "Authenticated read warehouse_capacity" on warehouse_capacity for select using (auth.role() = 'authenticated');
create policy "Authenticated write warehouse_capacity" on warehouse_capacity for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────
-- 11. WAREHOUSE_CAPACITY_IMPORTS — riwayat batch import kapasitas gudang
--     (1 baris = 1 file diupload, `data.records` berisi semua baris di batch
--     itu — sama seperti App.jsx gudangCapacityImports, disimpan apa adanya
--     sebagai jsonb supaya tidak perlu mapping kolom manual).
-- ────────────────────────────────────────────────────────────
create table if not exists warehouse_capacity_imports (
  id text primary key,              -- batchId, sama dengan id di App.jsx
  data jsonb not null default '{}'::jsonb,
  created_at bigint
);
alter table warehouse_capacity_imports drop column if exists source_file;
alter table warehouse_capacity_imports drop column if exists sheet_name;
alter table warehouse_capacity_imports drop column if exists imported_by;
alter table warehouse_capacity_imports drop column if exists imported_at;
alter table warehouse_capacity_imports drop column if exists total_rows;
alter table warehouse_capacity_imports drop column if exists valid_rows;
alter table warehouse_capacity_imports drop column if exists invalid_rows;
alter table warehouse_capacity_imports drop column if exists warning_rows;
alter table warehouse_capacity_imports add column if not exists data jsonb not null default '{}'::jsonb;
alter table warehouse_capacity_imports add column if not exists created_at bigint;

alter table warehouse_capacity_imports enable row level security;
drop policy if exists "Authenticated read wh_cap_imports" on warehouse_capacity_imports;
drop policy if exists "Authenticated write wh_cap_imports" on warehouse_capacity_imports;
create policy "Authenticated read wh_cap_imports" on warehouse_capacity_imports for select using (auth.role() = 'authenticated');
create policy "Authenticated write wh_cap_imports" on warehouse_capacity_imports for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────
-- 12. WA_ALLOWED_USERS — whitelist nomor WA yang boleh tanya ke AI Agent.
--     Dikelola Admin lewat panel WA Agent di App.jsx.
-- ────────────────────────────────────────────────────────────
create table if not exists wa_allowed_users (
  id bigint generated always as identity primary key,
  phone_number text not null unique,    -- format internasional tanpa "+" cth "628123456789"
  display_name text,
  notes text,
  added_by text,                        -- username admin yang menambahkan
  added_at timestamptz default now(),
  is_active boolean not null default true
);

alter table wa_allowed_users enable row level security;
-- Read: Edge Function memakai service_role (tidak kena RLS), App.jsx perlu baca untuk tampilkan daftar
drop policy if exists "Authenticated read wa_allowed_users" on wa_allowed_users;
drop policy if exists "Authenticated write wa_allowed_users" on wa_allowed_users;
create policy "Authenticated read wa_allowed_users" on wa_allowed_users for select using (auth.role() = 'authenticated');
create policy "Authenticated write wa_allowed_users" on wa_allowed_users for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

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
-- 14. WA_AGENT_LOGS — audit log setiap pesan masuk ke AI Agent WA.
--     Menyimpan metadata + ringkasan jawaban (bukan teks penuh untuk hemat space).
-- ────────────────────────────────────────────────────────────
create table if not exists wa_agent_logs (
  id bigint generated always as identity primary key,
  phone_number text not null,
  display_name text,
  message_in text not null,             -- pesan asli dari pengirim
  intent text,                          -- "help" | "menu" | "status_sinkron" | "rag_query" | dst
  answer_summary text,                  -- ringkasan jawaban yang dikirim (maks ~500 char)
  rag_chunks_used integer default 0,
  is_whitelisted boolean not null default false,
  response_ms integer,                  -- latency total dalam milidetik
  error_message text,                   -- isi error jika gagal (null = sukses)
  created_at timestamptz default now()
);
create index if not exists idx_wa_logs_phone on wa_agent_logs(phone_number);
create index if not exists idx_wa_logs_created on wa_agent_logs(created_at desc);

alter table wa_agent_logs enable row level security;
-- Edge Function menulis dengan service_role (tidak kena RLS).
-- App.jsx (App Panel Admin) baca untuk tampilkan log — require authenticated.
drop policy if exists "Authenticated read wa_agent_logs" on wa_agent_logs;
create policy "Authenticated read wa_agent_logs" on wa_agent_logs for select using (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────
-- 15. WA_SYNC_STATUS — status terakhir sinkronisasi RAG/state dari App.jsx.
--     1 baris per sync_type (upsert by sync_type).
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
-- 16. TELEGRAM BOT — alternatif WA Bot (dipilih user setelah WA kena restriksi
--     "Business account is restricted from messaging users in this country"
--     akibat Business Verification Meta belum selesai). Setup Telegram jauh
--     lebih ringan: tidak ada App Review, tidak ada verifikasi bisnis, tidak
--     ada pembatasan negara. Struktur tabel & logic Edge Function sengaja
--     dibuat paralel dengan wa_allowed_users/wa_agent_logs supaya mudah
--     dibandingkan/dipelihara bersamaan (WA bisa diaktifkan lagi nanti kalau
--     verifikasi PLN sudah selesai, tanpa saling mengganggu).
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
