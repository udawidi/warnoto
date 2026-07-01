-- WARNOTO — Skema database Supabase
-- Dipakai bersama oleh: (1) job ML forecasting (GitHub Actions, malam hari)
--                       (2) fitur scan barcode HP (sinkron multi-device)
--
-- Cara pakai: copy seluruh isi file ini, jalankan di Supabase Dashboard
-- → SQL Editor → New query → paste → Run.

-- ────────────────────────────────────────────────────────────
-- 1. KATALOG — master barang (cerminan dari Master Katalog di App.jsx)
-- ────────────────────────────────────────────────────────────
create table if not exists katalog (
  id text primary key,              -- sama dengan id di App.jsx, cth "KAT-1060011"
  nama text not null,
  kategori text,
  satuan text,
  jenis_barang text,                -- Cadang / Persediaan / Pre Memory / dst
  foto_keseluruhan_url text,        -- URL publik foto material keseluruhan (bucket material-photos)
  created_at timestamptz default now()
);

-- Jika tabel katalog sudah ada dari sebelumnya (skema versi lama), tambahkan kolom baru:
alter table katalog add column if not exists foto_keseluruhan_url text;

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
-- 4. STOCK_SCAN_LOG — log scan barcode dari HP (fitur sinkron multi-device, menyusul)
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

create policy "Public insert katalog" on katalog for insert with check (true);
create policy "Public update katalog" on katalog for update using (true);
create policy "Public insert tug15_history" on tug15_history for insert with check (true);
create policy "Public insert stock_current" on stock_current for insert with check (true);
create policy "Public update stock_current" on stock_current for update using (true);

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
  role text not null,           -- ADMIN / TL / ASMAN / MANAGER / ADMIN_UIT / MGR_LOGISTIK_UIT / PENGADAAN / VIEWER
  jabatan text,
  avatar text,
  created_at timestamptz default now()
);

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
create table if not exists gudang (
  id text primary key,
  upt_id text references upt(id) on delete set null,
  data jsonb not null,
  created_at bigint
);
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
alter table gudang enable row level security;
alter table lokasi enable row level security;
alter table satpam enable row level security;
alter table tim_mutu enable row level security;

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
-- 10. WAREHOUSE_CAPACITY — kapasitas gudang per sub-gudang (m2).
--     Grain: UPT x Gudang x Sub Gudang. Sumber: Laporan KAPASITAS GUDANG UIT JBM.xlsx.
--     Diimport lewat UI (KapasitasGudangTab) bukan hardcoded.
-- ────────────────────────────────────────────────────────────
create table if not exists warehouse_capacity (
  id text primary key,                  -- "CAP-{UPT}-{GUDANG}-{SUB}" uppercase
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
  persentase_terpakai numeric not null default 0,   -- 0.0 – 1.0
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
  matched_gudang_id text,               -- FK ke gudang.id (nullable, di-isi setelah mapping)
  mapping_status text not null default 'UNMATCHED' check (mapping_status in ('UNMATCHED','AUTO_SUGGESTED','CONFIRMED')),
  import_batch_id text,
  updated_at timestamptz default now()
);
create index if not exists idx_wh_cap_upt on warehouse_capacity(upt);
create index if not exists idx_wh_cap_status on warehouse_capacity(status_kapasitas);

alter table warehouse_capacity enable row level security;
drop policy if exists "Authenticated read warehouse_capacity" on warehouse_capacity;
drop policy if exists "Authenticated write warehouse_capacity" on warehouse_capacity;
create policy "Authenticated read warehouse_capacity" on warehouse_capacity for select using (auth.role() = 'authenticated');
create policy "Authenticated write warehouse_capacity" on warehouse_capacity for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────
-- 11. WAREHOUSE_CAPACITY_IMPORTS — riwayat batch import kapasitas gudang
-- ────────────────────────────────────────────────────────────
create table if not exists warehouse_capacity_imports (
  id text primary key,
  source_file text not null,
  sheet_name text,
  imported_by text,                     -- username / user id
  imported_at timestamptz default now(),
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  warning_rows integer not null default 0
);

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
