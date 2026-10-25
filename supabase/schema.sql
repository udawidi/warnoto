-- WARNOTO — Bootstrap snapshot skema database Supabase
-- File ini untuk bootstrap database kosong ke final state. Bukan runner upgrade/repair produksi.
-- Untuk database existing, jalankan migration berurutan dari supabase/migrations/.
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
-- CANONICAL TUG SOURCE HISTORY (parity with
-- migrations/20260911_tug_item_source_history.sql)
-- Canonical TUG tables/RPCs are installed by their dedicated migration. This
-- guarded block keeps a fresh bootstrap/schema refresh aligned when those
-- tables already exist, without inventing a second canonical DDL path.
-- `tug_create_transaction` and `tug_amend` must insert `source_snapshot`
-- through `tug_source_snapshot_for_stock(...)`; the dedicated migration owns
-- those unchanged RPC signatures and definitions.
-- ────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.tug_items') is not null then
    alter table public.tug_items
      add column if not exists source_snapshot jsonb not null default '{}'::jsonb;
  end if;
end $$;

create or replace function public.tug_source_epoch_ms(p_value text)
returns bigint language plpgsql immutable set search_path = public as $$
begin
  if nullif(btrim(p_value), '') is null then return null; end if;
  if p_value ~ '^\d{10,13}$' then
    if p_value::numeric < 1000000000000 then return (p_value::numeric * 1000)::bigint; end if;
    return p_value::bigint;
  end if;
  begin
    return (extract(epoch from p_value::timestamptz) * 1000)::bigint;
  exception when others then
    return null;
  end;
end $$;

create or replace function public.tug_catalog_code_key(p_value text)
returns text language plpgsql immutable set search_path = public as $$
declare v_digits text := regexp_replace(coalesce(p_value,''), '[^0-9]', '', 'g');
begin
  if v_digits = '' then return lower(btrim(coalesce(p_value,''))); end if;
  if length(v_digits) = 10 and left(v_digits,3) = '100' then v_digits := substr(v_digits,4); end if;
  return coalesce(nullif(ltrim(v_digits,'0'),''),'0');
end $$;

create or replace function public.tug_source_snapshot_for_stock(
  p_stock_id text, p_at timestamptz default now(), p_provenance text default 'CREATE'
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_data jsonb; v_contracts jsonb := '[]'::jsonb; v_kind text;
begin
  select coalesce(data,'{}'::jsonb) into v_data from public.stocks where id=p_stock_id;
  if v_data is null then
    return jsonb_build_object('sourceKind','INITIAL_STOCK','contracts','[]'::jsonb,'provenance',p_provenance);
  end if;
  select coalesce(jsonb_agg(q.ref order by q.entry_ms desc, q.doc_no),'[]'::jsonb) into v_contracts
  from (
    select distinct on (coalesce(r.value->>'docNo',''),coalesce(r.value->>'noKontrak',''))
      r.value as ref, public.tug_source_epoch_ms(r.value->>'tglMasuk') as entry_ms,
      coalesce(r.value->>'docNo','') as doc_no
    from jsonb_array_elements(case when jsonb_typeof(v_data->'kontrakRefs')='array'
      then v_data->'kontrakRefs' else '[]'::jsonb end) r(value)
    where nullif(btrim(r.value->>'docNo'),'') is not null
      and nullif(btrim(r.value->>'noKontrak'),'') is not null
      and public.tug_source_epoch_ms(r.value->>'tglMasuk') is not null
      and to_timestamp(public.tug_source_epoch_ms(r.value->>'tglMasuk')/1000.0) <= p_at
    order by coalesce(r.value->>'docNo',''),coalesce(r.value->>'noKontrak',''),
      public.tug_source_epoch_ms(r.value->>'tglMasuk') desc
  ) q;
  if jsonb_array_length(v_contracts)>0 then v_kind:='TUG3_CONTRACT';
  elsif v_data ? '_tug10Applied' or v_data ? 'sourceTxnId'
     or coalesce(v_data->>'source','') in ('TUG10','TUG10_RETURN','item','dupKatalog') then v_kind:='TUG10_RETURN';
  elsif v_data ? 'sapBaselineQty' or v_data ? 'sapBaselineAt'
     or left(coalesce(p_stock_id,''),8) in ('STK-SAP-','STK-MIG-')
     or coalesce(v_data->>'source','') in ('SAP','SAP_MIGRATION') then v_kind:='SAP_MIGRATION';
  else v_kind:='INITIAL_STOCK'; end if;
  return jsonb_build_object('sourceKind',v_kind,'contracts',v_contracts,'provenance',p_provenance);
end $$;

revoke all on function public.tug_source_epoch_ms(text) from public, anon, authenticated;
revoke all on function public.tug_catalog_code_key(text) from public, anon, authenticated;
revoke all on function public.tug_source_snapshot_for_stock(text,timestamptz,text) from public, anon, authenticated;

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
alter table public.stocks add column if not exists upt_id text;
create index if not exists idx_stocks_upt on public.stocks(upt_id);
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
  notif_events text[] default '{}', -- opt-in penerima notif WA: 'COMPLETION' (selesai) / 'PENDING' (nunggu approval)
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
alter table profiles add column if not exists notif_events text[] default '{}';
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
-- QR blok lokasi gudang. Token adalah bearer capability yang dicetak ke kartu;
-- nilainya tidak pernah dikembalikan oleh RPC publik.
alter table lokasi add column if not exists public_token uuid;
update lokasi set public_token = gen_random_uuid() where public_token is null;
alter table lokasi alter column public_token set default gen_random_uuid();
alter table lokasi alter column public_token set not null;
create unique index if not exists lokasi_public_token_uidx on lokasi(public_token);

create or replace function public.public_block_stock(p_lokasi_id text, p_token uuid)
returns jsonb
language sql stable security definer set search_path = pg_catalog
as $$
  select case
    when l.id is null or l.public_token is distinct from p_token then null::jsonb
    else jsonb_build_object(
      'upt', coalesce(u.data->>'nama', u.data->>'kode', u.id),
      'gudang', coalesce(g.data->>'nama', g.data->>'kode', g.id),
      'subgudang', coalesce(sg.data->>'nama', sg.data->>'kode', ''),
      'blok', coalesce(l.data->>'kode', l.data->>'nama', l.id),
      'materials', coalesce((
        select jsonb_agg(jsonb_build_object(
          'katalog', coalesce(k.data->>'katalog', k.data->>'kode', k.id),
          'nama', coalesce(k.data->>'name', k.data->>'nama', '-'),
          'satuan', coalesce(k.data->>'satuan', k.data->>'unit', ''),
          'qty', q.qty,
          'sapLabel', q.sap_label,
          'jenisBarang', q.jenis_barang
        ) order by coalesce(k.data->>'name', k.data->>'nama', k.id))
        from (
          select classified.katalog_id, classified.sap_label, classified.jenis_barang, sum(classified.qty) as qty
          from (
            select s.katalog_id,
              case
                when coalesce(nullif(s.data->>'sapStatus',''), nullif(k0.data->>'sapStatus','')) = 'Non-SAP' then 'Non-SAP'
                when coalesce(nullif(s.data->>'jenisBarang',''), nullif(k0.data->>'jenisBarang','')) = 'Pre Memory' then 'SAP — Pre Memory'
                when coalesce(nullif(s.data->>'sapStatus',''), nullif(k0.data->>'sapStatus','')) in ('SAP — Persediaan','SAP — Cadang') then coalesce(nullif(s.data->>'sapStatus',''), nullif(k0.data->>'sapStatus',''))
                when coalesce(nullif(s.data->>'sapStatus',''), nullif(k0.data->>'sapStatus','')) = 'SAP' then
                  case
                    when coalesce(nullif(k0.data->>'katalog',''), nullif(k0.data->>'kode',''), k0.id) ~ '^[0-9]+$' and length(regexp_replace(coalesce(nullif(k0.data->>'katalog',''), nullif(k0.data->>'kode',''), k0.id), '^0+', '')) = 10 then 'SAP — Cadang'
                    when coalesce(nullif(k0.data->>'katalog',''), nullif(k0.data->>'kode',''), k0.id) ~ '^[0-9]+$' and length(regexp_replace(coalesce(nullif(k0.data->>'katalog',''), nullif(k0.data->>'kode',''), k0.id), '^0+', '')) between 7 and 8 then 'SAP — Persediaan'
                    else 'SAP — Persediaan'
                  end
                when coalesce(nullif(s.data->>'sapStatus',''), nullif(k0.data->>'sapStatus','')) is null and s.id like 'STK-PREMEM-%' then 'Non-SAP'
                when coalesce(nullif(k0.data->>'katalog',''), nullif(k0.data->>'kode',''), k0.id) ~ '^[0-9]+$' and length(regexp_replace(coalesce(nullif(k0.data->>'katalog',''), nullif(k0.data->>'kode',''), k0.id), '^0+', '')) = 10 then 'SAP — Cadang'
                when coalesce(nullif(k0.data->>'katalog',''), nullif(k0.data->>'kode',''), k0.id) ~ '^[0-9]+$' and length(regexp_replace(coalesce(nullif(k0.data->>'katalog',''), nullif(k0.data->>'kode',''), k0.id), '^0+', '')) between 7 and 8 then 'SAP — Persediaan'
                else 'Non-SAP'
              end as sap_label,
              coalesce(nullif(s.data->>'jenisBarang',''), nullif(k0.data->>'jenisBarang',''), '-') as jenis_barang,
              case
                when coalesce(s.data->>'qty', '') ~ '^-?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))$'
                  then (s.data->>'qty')::numeric
                else 0
              end as qty
            from public.stocks s
            join public.katalog k0 on k0.id = s.katalog_id
            where s.lokasi_id = l.id
          ) classified
          group by classified.katalog_id, classified.sap_label, classified.jenis_barang
        ) q
        join public.katalog k on k.id = q.katalog_id
        where q.qty > 0
      ), '[]'::jsonb)
    )
  end
  from public.lokasi l
  left join public.gudang g on g.id = l.gudang_id
  left join public.upt u on u.id = g.upt_id
  left join public.sub_gudang sg on sg.id = nullif(l.data->>'subGudangId', '')
  where l.id = p_lokasi_id;
$$;

-- Public material QR scan, scoped to the UPT encoded in the label when present.
create or replace function public.public_material_scan(p_katalog_id text, p_upt_id text default null)
returns jsonb
language sql stable security definer set search_path = pg_catalog
as $$
  with
  params as (
    select nullif(btrim(p_katalog_id), '') as katalog_id,
           nullif(btrim(p_upt_id), '') as upt_id
  ),
  kat as (
    select k.id, k.data from public.katalog k, params p
    where k.id = p.katalog_id limit 1
  ),
  stock_base as (
    select s.id, s.katalog_id, s.upt_id as explicit_upt_id,
           nullif(g.upt_id, '') as location_upt_id,
           coalesce(nullif(s.upt_id, ''), nullif(g.upt_id, '')) as effective_upt_id,
           case when coalesce(s.data->>'qty', '') ~ '^-?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))$'
             then (s.data->>'qty')::numeric else 0 end as qty,
           s.lokasi_id, g.id as gudang_id, g.data as gudang_data,
           sg.data as subgudang_data, l.data as lokasi_data
    from public.stocks s
    left join public.lokasi l on l.id = s.lokasi_id
    left join public.gudang g on g.id = l.gudang_id
    left join public.sub_gudang sg on sg.id = nullif(l.data->>'subGudangId', '') and sg.gudang_id = g.id
    join params p on p.katalog_id = s.katalog_id
    where nullif(s.upt_id, '') is null or nullif(g.upt_id, '') is null or nullif(s.upt_id, '') = nullif(g.upt_id, '')
  ),
  upt_options as (
    select sb.effective_upt_id as id,
           coalesce(nullif(u.data->>'nama', ''), nullif(u.data->>'kode', ''), u.id) as nama
    from stock_base sb left join public.upt u on u.id = sb.effective_upt_id
    where sb.effective_upt_id is not null
    group by sb.effective_upt_id, u.id, u.data
  ),
  decision as (
    select case
      when not exists (select 1 from kat) then 'NOT_FOUND'
      when (select count(*) from upt_options) = 0 then 'NOT_FOUND'
      when p.upt_id is not null and not exists (select 1 from upt_options o where o.id = p.upt_id) then 'INVALID_UPT'
      when p.upt_id is null and (select count(*) from upt_options) > 1 then 'SELECT_UPT'
      else 'READY'
    end as status, p.upt_id as requested_upt_id
    from params p
  ),
  chosen as (
    select d.status, case when d.status = 'READY' then coalesce(d.requested_upt_id, (select o.id from upt_options o limit 1)) end as upt_id
    from decision d
  ),
  scoped_stock as (
    select sb.* from stock_base sb, chosen c
    where c.status = 'READY' and c.upt_id is not null and sb.effective_upt_id = c.upt_id
  ),
  location_rows as (
    select ss.gudang_id, ss.lokasi_id,
           coalesce(nullif(ss.gudang_data->>'nama', ''), nullif(ss.gudang_data->>'kode', ''), ss.gudang_id) as gudang,
           coalesce(nullif(ss.subgudang_data->>'nama', ''), nullif(ss.subgudang_data->>'kode', ''), '') as "subGudang",
           coalesce(nullif(ss.lokasi_data->>'kode', ''), nullif(ss.lokasi_data->>'nama', ''), ss.lokasi_id) as blok,
           sum(ss.qty) as qty
    from scoped_stock ss where ss.lokasi_id is not null and ss.gudang_id is not null and ss.lokasi_data is not null
    group by ss.gudang_id, ss.lokasi_id, ss.gudang_data, ss.subgudang_data, ss.lokasi_data
    having sum(ss.qty) > 0
  ),
  history_rows as (
    select h.id, h.tanggal, h.jenis_transaksi, h.qty, h.lokasi_kode,
           h.doc_type, h.no_bon, h.catatan,
           (coalesce((select sum(ss.qty) from scoped_stock ss), 0)
            - coalesce(sum(case when h.jenis_transaksi = 'MASUK' then h.qty else -h.qty end)
                over (order by h.tanggal desc, h.id desc rows between unbounded preceding and 1 preceding), 0)) as sisa
    from public.tug15_history h
    join public.lokasi l on l.id = h.lokasi_id
    join public.gudang g on g.id = l.gudang_id
    join chosen c on c.status = 'READY' and g.upt_id = c.upt_id
    join params p on p.katalog_id = h.katalog_id
    where c.upt_id is not null
  )
  select case when not exists (select 1 from kat) then jsonb_build_object('status', 'NOT_FOUND')
    else jsonb_build_object(
      'status', c.status,
      'katalog', (select jsonb_build_object('id', k.id, 'katalog', k.data->>'katalog', 'name', coalesce(k.data->>'name', k.data->>'nama', '-'), 'satuan', coalesce(k.data->>'satuan', k.data->>'unit', ''), 'jenisBarang', coalesce(k.data->>'jenisBarang', ''), 'merk', coalesce(k.data->>'merk', ''), 'type', coalesce(k.data->>'type', ''), 'category', coalesce(k.data->>'category', ''), 'keterangan', coalesce(k.data->>'keterangan', ''), 'fotoKeseluruhanUrl', coalesce(k.data->>'fotoKeseluruhanUrl', k.data->>'foto_keseluruhan_url', '')) from kat k),
      'uptOptions', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'nama', o.nama) order by o.nama) from upt_options o), '[]'::jsonb),
      'upt', (select jsonb_build_object('id', o.id, 'nama', o.nama) from upt_options o where o.id = c.upt_id),
      'qty', coalesce((select sum(ss.qty) from scoped_stock ss), 0),
      'locations', coalesce((select jsonb_agg(jsonb_build_object('gudang', lr.gudang, 'subGudang', lr."subGudang", 'blok', lr.blok, 'qty', lr.qty) order by lr.gudang, lr."subGudang", lr.blok) from location_rows lr), '[]'::jsonb),
      'history', coalesce((select jsonb_agg(jsonb_build_object('id', hr.id, 'tanggal', hr.tanggal, 'jenis_transaksi', hr.jenis_transaksi, 'qty', hr.qty, 'lokasi_kode', hr.lokasi_kode, 'doc_type', hr.doc_type, 'no_bon', hr.no_bon, 'catatan', hr.catatan, 'sisa', hr.sisa) order by hr.tanggal, hr.id) from history_rows hr), '[]'::jsonb)
    ) end
  from chosen c;
$$;

revoke all on function public.public_material_scan(text, text) from public;
grant execute on function public.public_material_scan(text, text) to anon, authenticated;
revoke all on function public.public_block_stock(text, uuid) from public;
grant execute on function public.public_block_stock(text, uuid) to anon, authenticated;
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
  foto_path text,
  matched_gudang_id text,
  mapping_status text not null default 'UNMATCHED' check (mapping_status in ('UNMATCHED','AUTO_SUGGESTED','CONFIRMED')),
  import_batch_id text,
  updated_at timestamptz default now(),
  constraint warehouse_capacity_bounds_check check (
    luas_lahan_m2 >= 0 and luas_terpakai_m2 >= 0
    and luas_terpakai_m2 <= luas_lahan_m2 + 0.000001
    and abs(sisa_luas_m2 - (luas_lahan_m2 - luas_terpakai_m2)) <= 0.000001
    and persentase_terpakai between 0 and 1
    and abs(persentase_terpakai - case when luas_lahan_m2 = 0 then 0 else luas_terpakai_m2 / luas_lahan_m2 end) <= 0.000001
    and coalesce(persediaan_pct, 0) between 0 and 1
    and coalesce(cadang_pct, 0) between 0 and 1
    and coalesce(pre_memory_pct, 0) between 0 and 1
    and coalesce(attb_pct, 0) between 0 and 1
    and coalesce(lainnya_pct, 0) between 0 and 1
    and coalesce(persediaan_pct, 0) + coalesce(cadang_pct, 0) + coalesce(pre_memory_pct, 0) + coalesce(attb_pct, 0) + coalesce(lainnya_pct, 0) <= 1.000001
    and status_kapasitas = case when persentase_terpakai >= 0.90 then 'KRITIS' when persentase_terpakai >= 0.75 then 'WASPADA' else 'AMAN' end
  )
);

alter table warehouse_capacity enable row level security;
drop policy if exists "Authenticated read warehouse_capacity" on warehouse_capacity;
drop policy if exists "Authenticated write warehouse_capacity" on warehouse_capacity;
create policy "Authenticated read warehouse_capacity" on warehouse_capacity for select using (auth.role() = 'authenticated');
create policy "Authenticated write warehouse_capacity" on warehouse_capacity for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Foto privat per record warehouse_capacity. URL signed dibuat aplikasi saat Detail dibuka.
insert into storage.buckets (id, name, public)
values ('warehouse-capacity-photos', 'warehouse-capacity-photos', false)
on conflict (id) do update set public = false;
drop policy if exists "Authenticated read warehouse capacity photos" on storage.objects;
drop policy if exists "Capacity editors upload warehouse photos" on storage.objects;
drop policy if exists "Capacity editors delete warehouse photos" on storage.objects;
create policy "Authenticated read warehouse capacity photos" on storage.objects
  for select using (bucket_id = 'warehouse-capacity-photos' and auth.role() = 'authenticated');
create policy "Capacity editors upload warehouse photos" on storage.objects
  for insert with check (bucket_id = 'warehouse-capacity-photos' and exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role in ('ADMIN', 'TL', 'SUPERADMIN')
  ));
create policy "Capacity editors delete warehouse photos" on storage.objects
  for delete using (bucket_id = 'warehouse-capacity-photos' and exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role in ('ADMIN', 'TL', 'SUPERADMIN')
  ));

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

-- Shared UPT scope predicate used by UPT-scoped tables. Migrations may replace
-- this definition when role hierarchy changes; keeping it here makes a clean
-- schema bootstrap use the same boundary as production.
create or replace function public.can_access_upt(p_upt_id text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles actor
    where actor.id = auth.uid()
      and (
        actor.role in ('SUPERADMIN', 'ADMIN_LOG_PUSAT')
        or actor.upt_id = p_upt_id
        or (
          actor.role in ('ADMIN_UIT', 'ASMAN_LOG_UIT', 'MGR_LOGISTIK_UIT', 'HAR_UIT')
          and actor.uit_id is not null
          and exists (select 1 from public.upt u where u.id = p_upt_id and u.uit_id = actor.uit_id)
        )
        or (
          actor.role in ('ADMIN_ULTG', 'MGR_ULTG')
          and actor.ultg_id is not null
          and exists (select 1 from public.ultg ul where ul.id = actor.ultg_id and ul.upt_id = p_upt_id)
        )
      )
  );
$$;
revoke all on function public.can_access_upt(text) from public;
grant execute on function public.can_access_upt(text) to authenticated;

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
  v_logistik_requested text := nullif(p_header->>'pelaksanaLogistikId', '');
  v_logistik_id uuid;
  v_logistik_name text;
  v_header_data jsonb;
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
  if v_logistik_requested is null then
    select id, name into v_logistik_id, v_logistik_name
    from profiles where id = v_inspector and role in ('ADMIN', 'TL') and upt_id = v_actor_upt;
  else
    select id, name into v_logistik_id, v_logistik_name
    from profiles
    where id::text = v_logistik_requested
      and role in ('ADMIN', 'TL')
      and upt_id = v_actor_upt;
    if not found then
      raise exception 'Pelaksana logistik harus ADMIN/TL pada UPT pemeriksa.';
    end if;
  end if;
  if v_logistik_id is null then
    raise exception 'Profil pelaksana logistik tidak ditemukan.';
  end if;
  v_header_data := coalesce(p_header, '{}'::jsonb) || jsonb_build_object(
    'pelaksanaLogistikId', v_logistik_id,
    'pelaksanaLogistik', v_logistik_name
  );
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
    where (
      s.lokasi_id is null
      and s.upt_id is distinct from v_actor_upt
    )
    or (
      s.lokasi_id is not null
      and (g.id is null or g.id <> v_gudang or g.upt_id <> v_actor_upt)
    )
  ) then
    raise exception 'Setiap material harus berada pada UPT BA; material berlokasi wajib berada pada gudang BA.';
  end if;
  -- v1 clients may still send boolean checklist values. v2 is strict and tri-state.
  if p_header->>'inspectionFormVersion' = '2' then
    if exists (
      select 1 from jsonb_array_elements(p_items) e
      where (e.value->'checklist'->>'kebersihan') is distinct from 'SESUAI'
        and (e.value->'checklist'->>'kebersihan') is distinct from 'TIDAK_SESUAI'
        or (e.value->'checklist'->>'bebasKarat') is distinct from 'SESUAI'
        and (e.value->'checklist'->>'bebasKarat') is distinct from 'TIDAK_SESUAI'
        or (e.value->'checklist'->>'bebasBocor') is distinct from 'SESUAI'
        and (e.value->'checklist'->>'bebasBocor') is distinct from 'TIDAK_SESUAI'
        or (e.value->'checklist'->>'kemasanBaik') is distinct from 'SESUAI'
        and (e.value->'checklist'->>'kemasanBaik') is distinct from 'TIDAK_SESUAI'
    ) then
      raise exception 'Setiap checklist visual wajib dinilai SESUAI atau TIDAK_SESUAI.';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_items) e
      where jsonb_typeof(e.value->'photoPaths') <> 'array'
        or jsonb_array_length(e.value->'photoPaths') <> 2
    ) then
      raise exception 'Setiap material wajib memiliki tepat dua foto inspeksi.';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(p_items) e
      cross join lateral jsonb_array_elements_text(e.value->'photoPaths') photo(path)
      where not (photo.path like (v_inspector::text || '/%'))
        or not exists (
          select 1 from storage.objects object_row
          where object_row.bucket_id = 'material-inspection-photos'
            and object_row.name = photo.path
        )
    ) then
      raise exception 'Foto inspeksi tidak valid atau bukan milik pemeriksa.';
    end if;
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
  values (v_nomor, v_upt, v_gudang, v_tanggal, v_inspector, v_header_data)
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

-- Draft Inspeksi Material: private per owner, multi-row, foto tetap di bucket yang sama.
create table if not exists material_inspection_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  upt_id text not null,
  gudang_id text null,
  data jsonb not null default '{}'::jsonb,
  photo_paths text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_material_inspection_drafts_owner_updated
  on material_inspection_drafts(owner_id, updated_at desc);
create index if not exists idx_material_inspection_drafts_upt
  on material_inspection_drafts(upt_id);
create or replace function public.touch_material_inspection_draft_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists material_inspection_drafts_touch_updated_at on material_inspection_drafts;
create trigger material_inspection_drafts_touch_updated_at
  before update on material_inspection_drafts
  for each row execute function public.touch_material_inspection_draft_updated_at();

create or replace function public.can_manage_material_inspection_draft(
  p_owner_id uuid,
  p_upt_id text,
  p_gudang_id text
)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles actor
    where actor.id = auth.uid()
      and actor.id = p_owner_id
      and actor.role in ('ADMIN', 'TL')
      and actor.upt_id is not null
      and actor.upt_id = p_upt_id
      and (p_gudang_id is null or exists (
        select 1 from gudang g where g.id = p_gudang_id and g.upt_id = actor.upt_id
      ))
      and (
        p_gudang_id is null or actor.gudang_ids is null
        or (jsonb_typeof(actor.gudang_ids) = 'array'
          and (jsonb_array_length(actor.gudang_ids) = 0 or actor.gudang_ids ? p_gudang_id))
      )
  );
$$;
revoke all on function public.can_manage_material_inspection_draft(uuid, text, text) from public;
grant execute on function public.can_manage_material_inspection_draft(uuid, text, text) to authenticated;
alter table material_inspection_drafts enable row level security;
grant select, insert, update, delete on material_inspection_drafts to authenticated;
grant all on material_inspection_drafts to service_role;
drop policy if exists "Owner read material_inspection_drafts" on material_inspection_drafts;
drop policy if exists "Owner insert material_inspection_drafts" on material_inspection_drafts;
drop policy if exists "Owner update material_inspection_drafts" on material_inspection_drafts;
drop policy if exists "Owner delete material_inspection_drafts" on material_inspection_drafts;
create policy "Owner read material_inspection_drafts" on material_inspection_drafts
  for select to authenticated using (public.can_manage_material_inspection_draft(owner_id, upt_id, gudang_id));
create policy "Owner insert material_inspection_drafts" on material_inspection_drafts
  for insert to authenticated with check (public.can_manage_material_inspection_draft(owner_id, upt_id, gudang_id));
create policy "Owner update material_inspection_drafts" on material_inspection_drafts
  for update to authenticated
  using (public.can_manage_material_inspection_draft(owner_id, upt_id, gudang_id))
  with check (public.can_manage_material_inspection_draft(owner_id, upt_id, gudang_id));
create policy "Owner delete material_inspection_drafts" on material_inspection_drafts
  for delete to authenticated using (public.can_manage_material_inspection_draft(owner_id, upt_id, gudang_id));
drop policy if exists "Owner read material-inspection-draft-photos" on storage.objects;
create policy "Owner read material-inspection-draft-photos" on storage.objects
  for select to authenticated using (
    bucket_id = 'material-inspection-photos'
    and name like (auth.uid()::text || '/drafts/%')
    and exists (
      select 1 from material_inspection_drafts d
      where d.owner_id = auth.uid() and name = any(d.photo_paths)
    )
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

-- Pengembalian alat berat harus memakai RPC atomik. Jalur ini mengunci loan dan
-- alat, memvalidasi ADMIN/TL UPT pemilik, lalu mengembalikan bentuk canonical.
create or replace function public.complete_heavy_equipment_loan(p_loan_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor profiles%rowtype;
  v_loan heavy_equipment_loans%rowtype;
  v_equipment heavy_equipment%rowtype;
  v_actor_upt text;
  v_owner_upt text;
  v_equipment_upt text;
  v_other_active integer;
  v_returned_at bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then
    raise exception 'Tidak terautentikasi.' using errcode = '42501';
  end if;
  select * into v_actor from profiles where id = auth.uid();
  if not found or v_actor.role not in ('ADMIN', 'TL') then
    raise exception 'Hanya ADMIN/TL pemilik alat yang boleh menandai pengembalian.' using errcode = '42501';
  end if;
  select * into v_loan from heavy_equipment_loans where id = nullif(trim(p_loan_id), '') for update;
  if not found then raise exception 'Peminjaman alat tidak ditemukan.' using errcode = 'P0002'; end if;
  if coalesce(v_loan.status, '') not in ('DIPINJAM', 'APPROVED', 'OVERDUE') then
    raise exception 'Peminjaman alat sudah tidak aktif.' using errcode = 'P0001';
  end if;
  if nullif(trim(v_loan.equipment_id), '') is null then
    raise exception 'Peminjaman tidak memiliki referensi alat.' using errcode = '23514';
  end if;
  select * into v_equipment from heavy_equipment where id = v_loan.equipment_id for update;
  if not found then raise exception 'Alat pada peminjaman tidak ditemukan.' using errcode = 'P0002'; end if;
  select regexp_replace(upper(trim(coalesce((select u.data->>'nama' from upt u where u.id = v_actor.upt_id), v_actor.upt_id, ''))), '^UPT[[:space:]]+', '') into v_actor_upt;
  v_owner_upt := regexp_replace(upper(trim(coalesce(v_loan.owner_upt, ''))), '^UPT[[:space:]]+', '');
  v_equipment_upt := regexp_replace(upper(trim(coalesce(v_equipment.upt, v_equipment.data->>'upt', ''))), '^UPT[[:space:]]+', '');
  if v_actor_upt = '' or v_owner_upt = '' or v_actor_upt <> v_owner_upt then
    raise exception 'Pengembalian hanya boleh dilakukan ADMIN/TL UPT pemilik alat.' using errcode = '42501';
  end if;
  if v_equipment_upt <> '' and v_equipment_upt <> v_owner_upt then
    raise exception 'UPT pemilik pada alat dan peminjaman tidak cocok.' using errcode = '23514';
  end if;
  if nullif(v_equipment.data->>'activeLoanId', '') is not null and v_equipment.data->>'activeLoanId' <> v_loan.id then
    raise exception 'Alat sedang terkait peminjaman aktif lain.' using errcode = '40001';
  end if;
  select count(*) into v_other_active from heavy_equipment_loans
    where equipment_id = v_loan.equipment_id and id <> v_loan.id and status in ('DIPINJAM', 'APPROVED', 'OVERDUE');
  if v_other_active > 0 then raise exception 'Alat memiliki peminjaman aktif lain.' using errcode = '40001'; end if;
  update heavy_equipment_loans
    set status = 'SELESAI', data = coalesce(data, '{}'::jsonb) || jsonb_build_object('status', 'SELESAI', 'returnedBy', auth.uid()::text, 'returnedAt', v_returned_at)
    where id = v_loan.id returning * into v_loan;
  update heavy_equipment
    set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('availabilityStatus', 'TERSEDIA', 'activeLoanId', null, 'borrowedToUpt', null, 'borrowedJobName', null, 'borrowedUntil', null)
    where id = v_equipment.id returning * into v_equipment;
  return jsonb_build_object('loan', coalesce(v_loan.data, '{}'::jsonb) || jsonb_build_object('id', v_loan.id), 'equipment', coalesce(v_equipment.data, '{}'::jsonb) || jsonb_build_object('id', v_equipment.id));
end;
$$;
revoke all on function public.complete_heavy_equipment_loan(text) from public;
grant execute on function public.complete_heavy_equipment_loan(text) to authenticated;

-- Alat Bantu Kerja (2026-09-20): typed UPT scope and private evidence.
-- Full backfill, constraints, policies, and RPC parity are finalized near EOF.
alter table heavy_equipment add column if not exists upt_id text references upt(id);
alter table heavy_equipment add column if not exists is_cross_upt_borrowable boolean not null default false;
alter table heavy_equipment_loans add column if not exists owner_upt_id text references upt(id);
alter table heavy_equipment_loans add column if not exists requester_upt_id text references upt(id);
create index if not exists idx_heavy_equipment_upt_id on heavy_equipment(upt_id);
create index if not exists idx_heavy_equipment_loans_owner_upt_id on heavy_equipment_loans(owner_upt_id);
create index if not exists idx_heavy_equipment_loans_requester_upt_id on heavy_equipment_loans(requester_upt_id);
drop policy if exists "Authenticated read heavy_equipment" on heavy_equipment;
drop policy if exists "Authenticated write heavy_equipment" on heavy_equipment;
drop policy if exists "Read heavy_equipment authenticated" on heavy_equipment;
drop policy if exists "Scoped read heavy_equipment" on heavy_equipment;
drop policy if exists "Scoped write heavy_equipment" on heavy_equipment;
drop policy if exists "Heavy equipment scoped read" on heavy_equipment;
drop policy if exists "Heavy equipment TL insert" on heavy_equipment;
drop policy if exists "Heavy equipment TL update" on heavy_equipment;
drop policy if exists "Heavy equipment TL delete" on heavy_equipment;
create policy "Heavy equipment scoped read" on heavy_equipment for select to authenticated using (
  exists (select 1 from profiles actor where actor.id = auth.uid() and (
    actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT') or actor.upt_id = heavy_equipment.upt_id
    or (heavy_equipment.is_cross_upt_borrowable and actor.upt_id is not null)
  ))
);
create policy "Heavy equipment TL insert" on heavy_equipment for insert to authenticated with check (exists (select 1 from profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = heavy_equipment.upt_id));
create policy "Heavy equipment TL update" on heavy_equipment for update to authenticated using (exists (select 1 from profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = heavy_equipment.upt_id)) with check (exists (select 1 from profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = heavy_equipment.upt_id));
create policy "Heavy equipment TL delete" on heavy_equipment for delete to authenticated using (exists (select 1 from profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = heavy_equipment.upt_id));
drop policy if exists "Authenticated read heavy_equipment_loans" on heavy_equipment_loans;
drop policy if exists "Authenticated write heavy_equipment_loans" on heavy_equipment_loans;
drop policy if exists "Scoped all heavy_equipment_loans" on heavy_equipment_loans;
drop policy if exists "Heavy equipment loan scoped read" on heavy_equipment_loans;
create policy "Heavy equipment loan scoped read" on heavy_equipment_loans for select to authenticated using (exists (select 1 from profiles actor where actor.id = auth.uid() and (actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT') or actor.upt_id = owner_upt_id or actor.upt_id = requester_upt_id)));
insert into storage.buckets (id, name, public)
values ('heavy-equipment-evidence', 'heavy-equipment-evidence', false)
on conflict (id) do update set public = false;
drop policy if exists "Heavy equipment evidence read" on storage.objects;
drop policy if exists "Heavy equipment evidence insert" on storage.objects;
drop policy if exists "Heavy equipment evidence update" on storage.objects;
drop policy if exists "Heavy equipment evidence delete" on storage.objects;
create policy "Heavy equipment evidence read" on storage.objects
  for select to authenticated using (
    bucket_id = 'heavy-equipment-evidence'
    and exists (select 1 from profiles p where p.id = auth.uid() and (
      p.role in ('SUPERADMIN','ADMIN_LOG_PUSAT') or p.upt_id = (storage.foldername(name))[1]
      or exists (select 1 from heavy_equipment_loans l where (l.data->>'pickupEvidencePath' = name or l.data->>'returnEvidencePath' = name) and p.upt_id = l.requester_upt_id)
    ))
  );
create policy "Heavy equipment evidence insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'heavy-equipment-evidence'
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'TL' and p.upt_id = (storage.foldername(name))[1])
  );
create policy "Heavy equipment evidence update" on storage.objects for update to authenticated
  using (bucket_id = 'heavy-equipment-evidence' and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'TL' and p.upt_id = (storage.foldername(name))[1]))
  with check (bucket_id = 'heavy-equipment-evidence' and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'TL' and p.upt_id = (storage.foldername(name))[1]));
create policy "Heavy equipment evidence delete" on storage.objects for delete to authenticated
  using (bucket_id = 'heavy-equipment-evidence' and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'TL' and p.upt_id = (storage.foldername(name))[1]));

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
  updated_at timestamptz not null default clock_timestamp(),
  status text,                      -- DRAFT/PENDING_ASMAN/PENDING_MANAGER/SELESAI/DITOLAK
  upt_id text not null references upt(id) on delete restrict
);
alter table stock_opname add column if not exists upt_id text;
create index if not exists idx_stock_opname_status on stock_opname(status);
create index if not exists idx_stock_opname_upt_id on stock_opname(upt_id);

alter table stock_opname enable row level security;
drop policy if exists "Authenticated read stock_opname" on stock_opname;
drop policy if exists "Authenticated write stock_opname" on stock_opname;
drop policy if exists "Scoped read stock_opname" on stock_opname;
drop policy if exists "Scoped write stock_opname" on stock_opname;
drop policy if exists "Stock opname draft insert by warehouse roles" on stock_opname;
drop policy if exists "Stock opname draft update by warehouse roles" on stock_opname;
drop policy if exists "Stock opname draft delete by warehouse roles" on stock_opname;
revoke all on table stock_opname from public, anon, authenticated;
grant select, insert, update, delete on table stock_opname to authenticated;
grant all on table stock_opname to service_role;
create policy "Scoped read stock_opname" on stock_opname for select to authenticated using (public.can_access_upt(upt_id));
create policy "Stock opname draft insert by warehouse roles" on stock_opname for insert to authenticated
  with check (public.can_access_upt(upt_id) and status in ('DRAFT','PENDING_ASMAN') and exists (select 1 from profiles actor where actor.id=auth.uid() and actor.role in ('ADMIN','TL','SUPERADMIN')));
create policy "Stock opname draft update by warehouse roles" on stock_opname for update to authenticated
  using (public.can_access_upt(upt_id) and status='DRAFT' and exists (select 1 from profiles actor where actor.id=auth.uid() and actor.role in ('ADMIN','TL','SUPERADMIN')))
  with check (public.can_access_upt(upt_id) and status in ('DRAFT','PENDING_ASMAN') and exists (select 1 from profiles actor where actor.id=auth.uid() and actor.role in ('ADMIN','TL','SUPERADMIN')));
create policy "Stock opname draft delete by warehouse roles" on stock_opname for delete to authenticated
  using (public.can_access_upt(upt_id) and status='DRAFT' and exists (select 1 from profiles actor where actor.id=auth.uid() and actor.role in ('ADMIN','TL','SUPERADMIN')));

create table if not exists stock_count (
  id text primary key,              -- id sesi stock count, dibuat App.jsx ("SC-...")
  data jsonb not null default '{}'::jsonb,
  created_at bigint,
  upt_id text not null references upt(id) on delete restrict
);
alter table stock_count add column if not exists upt_id text;
create index if not exists idx_stock_count_upt_id on stock_count(upt_id);

alter table stock_count enable row level security;
drop policy if exists "Authenticated read stock_count" on stock_count;
drop policy if exists "Authenticated write stock_count" on stock_count;
drop policy if exists "Scoped read stock_count" on stock_count;
drop policy if exists "Scoped write stock_count" on stock_count;
revoke all on table stock_count from public, anon, authenticated;
grant select, insert, update, delete on table stock_count to authenticated;
grant all on table stock_count to service_role;
create policy "Scoped read stock_count" on stock_count for select to authenticated using (public.can_access_upt(upt_id));
create policy "Scoped write stock_count" on stock_count for all to authenticated using (public.can_access_upt(upt_id)) with check (public.can_access_upt(upt_id));

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
  unlinked_at bigint, unlinked_by uuid references profiles(id) on delete set null,
  sample_id text,
  sample_label text,
  sample_group text,
  supplementary_folder_id text,
  supplementary_folder_name text,
  is_supplementary boolean not null default false,
  constraint maturity_audit_evidence_sample_metadata_check check (
    (is_supplementary = true and sample_id is null and sample_group is null)
    or (is_supplementary = false and sample_id is null and sample_group is null)
    or (is_supplementary = false and sample_id is not null and sample_group is not null and sample_label is not null)
  )
);
-- No audit FK: an existing UI draft may select evidence before its audit is saved.
create unique index if not exists idx_maturity_audit_evidence_active_item on maturity_audit_evidence(audit_id, drive_file_id) where unlinked_at is null;
create index if not exists idx_maturity_audit_evidence_audit_aspect on maturity_audit_evidence(audit_id, aspect_id) where unlinked_at is null;
create index if not exists idx_maturity_audit_evidence_sample on maturity_audit_evidence(audit_id, aspect_id, sample_group, sample_id) where unlinked_at is null;
create table if not exists maturity_audit_drive_folders (
  id uuid primary key default gen_random_uuid(), mapping_key text not null unique, audit_id text, period_key text,
  folder_type text not null check (folder_type in ('ROOT','PERIOD','UPT','CATEGORY','ASPECT','ITEM','FORM5S','SAMPLE','SUPPLEMENTARY')),
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
  upt_id     text not null,         -- canonical UPT scope; migration maps unique master name/slug, never catalog alone
  upt        text not null,         -- scope UPT (Opsi B) — "UPT Surabaya" dst
  katalog    text not null,         -- join key ke Master Katalog / stocks
  source     text not null,         -- 'utama' | 'tambahan' | 'nameplate'
  photo_url  text not null,         -- URL publik di bucket stock-photos
  embedding  vector(1024),
  ocr_text   text,                  -- Fase 2 (OCR nameplate); null utk sekarang
  updated_at timestamptz default now()
);
create index if not exists idx_spe_upt_katalog on stock_photo_embeddings(upt, katalog);
create index if not exists idx_spe_upt_id_katalog on stock_photo_embeddings(upt_id, katalog);
create index if not exists idx_spe_embedding on stock_photo_embeddings using hnsw (embedding vector_cosine_ops);

alter table stock_photo_embeddings enable row level security;
drop policy if exists "Authenticated read spe" on stock_photo_embeddings;
drop policy if exists "Authenticated write spe" on stock_photo_embeddings;
drop policy if exists "Scoped read stock photo embeddings" on stock_photo_embeddings;
create policy "Scoped read stock photo embeddings" on stock_photo_embeddings for select to authenticated
  using (public.can_access_upt(upt_id));
revoke insert, update, delete on stock_photo_embeddings from anon, authenticated;
grant select on stock_photo_embeddings to authenticated;
grant all on stock_photo_embeddings to service_role;

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

-- Tenant-safe replacement. Keep the legacy RPC above during staged frontend rollout.
create or replace function public.match_stock_photos_scoped(
  query_embedding vector(1024),
  p_upt_ids text[] default null,
  match_count int default 10,
  min_similarity float default 0.6
)
returns table(upt_id text, katalog text, similarity float)
language sql stable
as $$
  select e.upt_id, e.katalog, max(1 - (e.embedding <=> query_embedding))::float as similarity
  from public.stock_photo_embeddings e
  where e.embedding is not null
    and public.can_access_upt(e.upt_id)
    and (p_upt_ids is null or e.upt_id = any(p_upt_ids))
  group by e.upt_id, e.katalog
  having max(1 - (e.embedding <=> query_embedding)) >= min_similarity
  order by similarity desc
  limit greatest(0, least(coalesce(match_count, 10), 100));
$$;
revoke all on function public.match_stock_photos_scoped(vector(1024), text[], int, float) from public;
grant execute on function public.match_stock_photos_scoped(vector(1024), text[], int, float) to authenticated;

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

-- MATURITY UIT HARDENING (canonical bootstrap, 20260919).
-- Keep aligned with supabase/proposals/20260919_maturity_uit_hardening.sql.
create or replace function public.is_maturity_superadmin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'SUPERADMIN');
$$;
revoke all on function public.is_maturity_superadmin() from public;
grant execute on function public.is_maturity_superadmin() to authenticated;
create or replace function public.can_write_maturity_upt(p_upt_id text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles actor where actor.id = auth.uid() and (actor.role = 'SUPERADMIN' or (actor.role in ('ADMIN','TL') and p_upt_id is not null and actor.upt_id = p_upt_id)));
$$;
revoke all on function public.can_write_maturity_upt(text) from public;
grant execute on function public.can_write_maturity_upt(text) to authenticated;
create or replace function public.can_review_maturity_uit() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT','SUPERADMIN'));
$$;
revoke all on function public.can_review_maturity_uit() from public;
grant execute on function public.can_review_maturity_uit() to authenticated;
create or replace function public.can_review_maturity_pusat() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('ADMIN_LOG_PUSAT','SUPERADMIN'));
$$;
revoke all on function public.can_review_maturity_pusat() from public;
grant execute on function public.can_review_maturity_pusat() to authenticated;
create or replace function public.can_access_maturity_upt(p_upt_id text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles actor where actor.id = auth.uid() and (
    (p_upt_id is null and actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT'))
    or (p_upt_id is not null and actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT'))
    or (p_upt_id is not null and actor.role in ('ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT') and exists (select 1 from public.upt unit where unit.id = p_upt_id and unit.uit_id = actor.uit_id))
    or (p_upt_id is not null and actor.role not in ('SUPERADMIN','ADMIN_LOG_PUSAT','ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT') and actor.upt_id = p_upt_id)
  ));
$$;
revoke all on function public.can_access_maturity_upt(text) from public;
grant execute on function public.can_access_maturity_upt(text) to authenticated;

alter table public.maturity_assessments add column if not exists upt_id text;
update public.maturity_assessments a set upt_id = p.upt_id from public.profiles p where a.upt_id is null and a.created_by = p.id;
update public.maturity_assessments set data = jsonb_set(coalesce(data, '{}'::jsonb), '{_migration}', jsonb_build_object('scope','PUSAT_LEGACY_UNSCOPED','reason','created_by tidak memiliki profile owner UPT; ownership tidak ditebak','migratedAt',now()), true) where upt_id is null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'maturity_assessments_upt_id_fkey') then
    alter table public.maturity_assessments add constraint maturity_assessments_upt_id_fkey foreign key (upt_id) references public.upt(id) on delete restrict;
  end if;
end $$;
alter table public.maturity_audit_history add column if not exists upt_id text;
update public.maturity_audit_history h set upt_id = u.id from public.upt u where h.upt_id is null and u.data->>'nama' = h.upt;
do $$ begin
  if exists (select 1 from public.maturity_audit_history where upt_id is null) then
    raise exception 'Ada baris maturity_audit_history tanpa padanan upt.id — perbaiki manual dulu.';
  end if;
end $$;
alter table public.maturity_audit_history alter column upt_id set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'maturity_audit_history_upt_id_fkey') then
    alter table public.maturity_audit_history add constraint maturity_audit_history_upt_id_fkey foreign key (upt_id) references public.upt(id) on delete restrict;
  end if;
end $$;
create index if not exists idx_maturity_audit_history_upt_id on public.maturity_audit_history(upt_id, tahun desc, semester desc);

alter table public.maturity_5s_assessments add column if not exists upt_id text;
update public.maturity_5s_assessments s set upt_id = u.id from public.upt u where s.upt_id is null and u.data->>'nama' = s.upt;
do $$ begin
  if exists (select 1 from public.maturity_5s_assessments where upt_id is null) then
    raise exception 'Ada baris maturity_5s_assessments tanpa padanan upt.id — perbaiki manual dulu.';
  end if;
end $$;
alter table public.maturity_5s_assessments alter column upt_id set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'maturity_5s_assessments_upt_id_fkey') then
    alter table public.maturity_5s_assessments add constraint maturity_5s_assessments_upt_id_fkey foreign key (upt_id) references public.upt(id) on delete restrict;
  end if;
end $$;

create table if not exists public.maturity_aspect_reviews (
  audit_id text not null references public.maturity_audits(id) on delete cascade,
  aspect_id text not null, item_id text not null, sample_id text not null default '', upt_id text not null references public.upt(id) on delete restrict,
  state text not null default 'PENDING' check (state in ('PENDING','CHECKED','REJECTED')),
  note text, reviewed_by text, reviewed_at bigint,
  final_score smallint check (final_score is null or final_score between 1 and 5),
  primary key (audit_id, aspect_id, item_id, sample_id)
);
alter table public.maturity_aspect_reviews add column if not exists item_id text not null default '';
alter table public.maturity_aspect_reviews add column if not exists sample_id text not null default '';
alter table public.maturity_aspect_reviews add column if not exists final_score smallint check (final_score is null or final_score between 1 and 5);
alter table public.maturity_aspect_reviews drop constraint if exists maturity_aspect_reviews_pkey;
alter table public.maturity_aspect_reviews add constraint maturity_aspect_reviews_pkey primary key (audit_id, aspect_id, item_id, sample_id);
alter table public.maturity_aspect_reviews alter column item_id drop default;
alter table public.maturity_aspect_reviews alter column sample_id drop default;
create index if not exists maturity_aspect_reviews_upt_idx on public.maturity_aspect_reviews(upt_id);
create index if not exists maturity_aspect_reviews_sample_idx on public.maturity_aspect_reviews(audit_id, aspect_id, sample_id);
create or replace function public.enforce_maturity_review_upt() returns trigger language plpgsql security definer set search_path = public as $$
declare audit_upt text;
begin
  select a.upt_id into audit_upt from public.maturity_audits a where a.id = new.audit_id;
  if audit_upt is null or new.upt_id is distinct from audit_upt then raise exception 'MATURITY_REVIEW_UPT_MISMATCH: review harus memakai UPT audit canonical.' using errcode = '23514'; end if;
  return new;
end;
$$;
drop trigger if exists trg_maturity_review_upt on public.maturity_aspect_reviews;
create trigger trg_maturity_review_upt before insert or update on public.maturity_aspect_reviews for each row execute function public.enforce_maturity_review_upt();

alter table public.maturity_audits enable row level security;
drop policy if exists "Authenticated read maturity_audits" on public.maturity_audits;
drop policy if exists "Authenticated write maturity_audits" on public.maturity_audits;
drop policy if exists "Maturity audits read scoped final" on public.maturity_audits;
drop policy if exists "Maturity audits insert own" on public.maturity_audits;
drop policy if exists "Maturity audits update scoped stage" on public.maturity_audits;
create policy "Maturity audits read scoped final" on public.maturity_audits for select to authenticated using (public.can_access_maturity_upt(upt_id));
create policy "Maturity audits insert own" on public.maturity_audits for insert to authenticated with check (public.can_access_maturity_upt(upt_id) and public.can_write_maturity_upt(upt_id));
create policy "Maturity audits update scoped stage" on public.maturity_audits for update to authenticated using (public.can_access_maturity_upt(upt_id) and ((public.can_write_maturity_upt(upt_id) and status in ('DRAFT','SELF_ASSESSMENT','REVISION')) or (public.can_review_maturity_uit() and status in ('SELF_ASSESSMENT','REVISION','REVIEW_UIT')) or (public.can_review_maturity_pusat() and status in ('REVIEW_PUSAT','FINAL')))) with check (public.can_access_maturity_upt(upt_id));
revoke delete on public.maturity_audits from authenticated;
grant select, insert, update on public.maturity_audits to authenticated;

alter table public.maturity_audit_history enable row level security;
drop policy if exists "Authenticated read maturity_audit_history" on public.maturity_audit_history;
drop policy if exists "Authenticated write maturity_audit_history" on public.maturity_audit_history;
drop policy if exists "Maturity history read scoped final" on public.maturity_audit_history;
drop policy if exists "Maturity history update target scoped" on public.maturity_audit_history;
create policy "Maturity history read scoped final" on public.maturity_audit_history for select to authenticated using (public.can_access_maturity_upt(upt_id));
create policy "Maturity history update target scoped" on public.maturity_audit_history for update to authenticated using (public.can_access_maturity_upt(upt_id) and (public.can_review_maturity_uit() or public.can_review_maturity_pusat() or public.is_maturity_superadmin())) with check (public.can_access_maturity_upt(upt_id));
revoke all on public.maturity_audit_history from authenticated;
grant select, insert on public.maturity_audit_history to authenticated;
grant update (target, updated_at, updated_by) on public.maturity_audit_history to authenticated;

alter table public.maturity_5s_assessments enable row level security;
drop policy if exists "Authenticated read maturity_5s_assessments" on public.maturity_5s_assessments;
drop policy if exists "Authenticated write maturity_5s_assessments" on public.maturity_5s_assessments;
drop policy if exists "Authenticated insert maturity_5s_assessments" on public.maturity_5s_assessments;
drop policy if exists "Maturity 5s read scoped final" on public.maturity_5s_assessments;
drop policy if exists "Maturity 5s insert own" on public.maturity_5s_assessments;
create policy "Maturity 5s read scoped final" on public.maturity_5s_assessments for select to authenticated using (public.can_access_maturity_upt(upt_id));
create policy "Maturity 5s insert own" on public.maturity_5s_assessments for insert to authenticated with check (public.can_write_maturity_upt(upt_id));
revoke all on public.maturity_5s_assessments from authenticated;
grant select, insert on public.maturity_5s_assessments to authenticated;

alter table public.maturity_aspect_reviews enable row level security;
drop policy if exists "Aspect reviews read scoped" on public.maturity_aspect_reviews;
drop policy if exists "Aspect reviews insert by reviewer" on public.maturity_aspect_reviews;
drop policy if exists "Aspect reviews update by reviewer" on public.maturity_aspect_reviews;
drop policy if exists "Aspect reviews read scoped final" on public.maturity_aspect_reviews;
drop policy if exists "Aspect reviews insert scoped reviewer" on public.maturity_aspect_reviews;
drop policy if exists "Aspect reviews update scoped reviewer" on public.maturity_aspect_reviews;
create policy "Aspect reviews read scoped final" on public.maturity_aspect_reviews for select to authenticated using (public.can_access_maturity_upt(upt_id));
create policy "Aspect reviews insert scoped reviewer" on public.maturity_aspect_reviews for insert to authenticated with check (public.can_access_maturity_upt(upt_id) and (public.can_review_maturity_uit() or public.can_review_maturity_pusat()));
create policy "Aspect reviews update scoped reviewer" on public.maturity_aspect_reviews for update to authenticated using (public.can_access_maturity_upt(upt_id) and (public.can_review_maturity_uit() or public.can_review_maturity_pusat())) with check (public.can_access_maturity_upt(upt_id));
revoke delete on public.maturity_aspect_reviews from authenticated;
grant select, insert, update on public.maturity_aspect_reviews to authenticated;

alter table public.maturity_assessments enable row level security;
drop policy if exists "Authenticated read maturity_assessments" on public.maturity_assessments;
drop policy if exists "Authenticated write maturity_assessments" on public.maturity_assessments;
drop policy if exists "Maturity assessments read scoped final" on public.maturity_assessments;
drop policy if exists "Maturity assessments insert own" on public.maturity_assessments;
drop policy if exists "Maturity assessments update own" on public.maturity_assessments;
create policy "Maturity assessments read scoped final" on public.maturity_assessments for select to authenticated using (public.can_access_maturity_upt(upt_id));
create policy "Maturity assessments insert own" on public.maturity_assessments for insert to authenticated with check (public.can_write_maturity_upt(upt_id));
create policy "Maturity assessments update own" on public.maturity_assessments for update to authenticated using (public.can_write_maturity_upt(upt_id)) with check (public.can_write_maturity_upt(upt_id));
revoke delete on public.maturity_assessments from authenticated;
grant select, insert, update on public.maturity_assessments to authenticated;

-- Form 5S insert baru wajib memiliki lima kategori x tiga foto. Trigger
-- BEFORE INSERT hanya memvalidasi insert baru; existing legacy rows tidak disentuh.
create or replace function public.validate_maturity_5s_photo_storage()
returns trigger language plpgsql security definer set search_path = public, storage as $$
declare photo jsonb; storage_path text; category text; categories text[] := array['sort', 'set', 'shine', 'standardize', 'sustain']; photo_count integer; storage_status text; object_mime text; object_size text;
begin
  if jsonb_typeof(new.sample_photos) <> 'array' then
    raise exception 'FORM5S_PHOTO_COUNT_INVALID: sample_photos harus berupa array.' using errcode = '23514';
  end if;
  photo_count := jsonb_array_length(new.sample_photos);
  if photo_count <> 15 then
    raise exception 'FORM5S_PHOTO_COUNT_INVALID: Form 5S baru wajib memiliki 15 foto (3 per kategori).' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(new.sample_photos) item where coalesce(item->>'categoryId', '') = '' or not (item->>'categoryId' = any(categories))) then
    raise exception 'FORM5S_CATEGORY_INVALID: setiap foto baru wajib memiliki kategori canonical.' using errcode = '23514';
  end if;
  foreach category in array categories loop
    if (select count(*) from jsonb_array_elements(new.sample_photos) item where item->>'categoryId' = category) <> 3 then
      raise exception 'FORM5S_CATEGORY_COUNT_INVALID: setiap kategori Form 5S wajib memiliki tepat 3 foto.' using errcode = '23514';
    end if;
  end loop;
  for photo in select value from jsonb_array_elements(new.sample_photos) loop
    storage_path := coalesce(photo->>'storagePath', photo->>'storage_path', '');
    if storage_path = '' or storage_path not like 'form-5s/' || new.upt_id || '/%' then
      raise exception 'FORM5S_STORAGE_PATH_INVALID: path foto harus memakai prefix form-5s/<upt_id>/. ' using errcode = '23514';
    end if;
    storage_status := coalesce(photo->>'storageStatus', photo->>'storage_status', '');
    if storage_status not in ('SELF_HOST_RECORDED', 'BACKUP_RECORDED') then
      raise exception 'FORM5S_STORAGE_STATUS_INVALID: foto harus berstatus SELF_HOST_RECORDED atau BACKUP_RECORDED legacy.' using errcode = '23514';
    end if;
    if storage_status = 'SELF_HOST_RECORDED' and (
      (photo->>'isDrive') is distinct from 'false'
      or (photo->>'syncedToDrive') is distinct from 'false'
      or photo ? 'driveFileId'
      or photo ? 'drive_file_id'
      or photo ? 'url'
    ) then
      raise exception 'FORM5S_STORAGE_METADATA_INVALID: foto self-host tidak boleh membawa metadata Drive.' using errcode = '23514';
    end if;
    select o.metadata->>'mimetype', o.metadata->>'size'
      into object_mime, object_size
      from storage.objects o
     where o.bucket_id = 'maturity-evidence' and o.name = storage_path;
    if not found then
      raise exception 'FORM5S_STORAGE_OBJECT_MISSING: object foto tidak ditemukan di bucket maturity-evidence.' using errcode = '23514';
    end if;
    if lower(coalesce(object_mime, '')) not like 'image/%' then
      raise exception 'FORM5S_STORAGE_MIME_INVALID: object foto harus memiliki MIME image/*.' using errcode = '23514';
    end if;
    if object_size is null or object_size !~ '^[0-9]+$' or (case when object_size ~ '^[0-9]+$' then object_size::bigint else 2097153 end) > 2097152 then
      raise exception 'FORM5S_PHOTO_SIZE_INVALID: ukuran object foto maksimal 2 MiB.' using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists trg_validate_maturity_5s_photo_storage on public.maturity_5s_assessments;
create trigger trg_validate_maturity_5s_photo_storage before insert on public.maturity_5s_assessments
for each row execute function public.validate_maturity_5s_photo_storage();
revoke all on function public.validate_maturity_5s_photo_storage() from public;
grant execute on function public.validate_maturity_5s_photo_storage() to authenticated, service_role;
-- Durable non-canonical TUG workflow and pre-canonical TUG-8/9 drafts
-- (canonical definition lives in migration 20260923_tug_workflow_persistence.sql).
create table if not exists public.tug_workflow_transactions (
  id text primary key,
  doc_type text not null check (doc_type in ('TUG5','TUG7','TUG8','TUG9')),
  upt_id text,
  uit_id text,
  ultg_id text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  stage text not null default 'DRAFT',
  status text not null default 'DRAFT' check (status in ('DRAFT','PENDING','APPROVED','REJECTED','CANCELLED')),
  doc_number text,
  doc_sequence bigint,
  version integer not null default 1 check (version > 0),
  parent_workflow_id text references public.tug_workflow_transactions(id) on delete restrict,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tug_workflow_scope_one check (num_nonnulls(upt_id, uit_id) = 1),
  constraint tug_workflow_draft_number check (status <> 'DRAFT' or doc_number is null or (data->>'legacyImport') = 'true'),
  constraint tug_workflow_canonical_draft_only check (doc_type not in ('TUG8','TUG9') or status = 'DRAFT')
);
create index if not exists tug_workflow_scope_idx on public.tug_workflow_transactions (upt_id, uit_id, doc_type, status, updated_at desc);
create index if not exists tug_workflow_creator_idx on public.tug_workflow_transactions (created_by, updated_at desc);
create unique index if not exists tug_workflow_parent_unique_idx on public.tug_workflow_transactions (parent_workflow_id) where parent_workflow_id is not null;
alter table public.tug_workflow_transactions enable row level security;
drop policy if exists "Scoped read tug workflow" on public.tug_workflow_transactions;
create policy "Scoped read tug workflow" on public.tug_workflow_transactions
  for select to authenticated using (
    public.can_access_upt(upt_id)
    or exists (select 1 from public.profiles actor where actor.id=auth.uid() and actor.uit_id=tug_workflow_transactions.uit_id and actor.role in ('ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT','SUPERADMIN','ADMIN_LOG_PUSAT'))
    or exists (select 1 from public.profiles actor where actor.id=auth.uid() and actor.ultg_id=tug_workflow_transactions.ultg_id and actor.role in ('MGR_ULTG','SUPERADMIN','ADMIN_LOG_PUSAT'))
  );
revoke all on public.tug_workflow_transactions from anon, authenticated;
grant select on public.tug_workflow_transactions to authenticated;

create or replace function public.tug_workflow_scope_allowed(
  p_upt_id text, p_uit_id text, p_ultg_id text
)
returns boolean
language sql stable security definer set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.profiles actor
    where actor.id = auth.uid()
      and (
        actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT')
        or (p_upt_id is not null and p_uit_id is null and public.can_access_upt(p_upt_id))
        or (p_upt_id is not null and p_uit_id is null and actor.role in ('ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT') and exists (select 1 from public.upt u where u.id=p_upt_id and u.uit_id=actor.uit_id))
        or (p_upt_id is not null and p_uit_id is null and actor.role = 'MANAGER' and actor.upt_id = p_upt_id)
        or (p_uit_id is not null and actor.uit_id = p_uit_id and actor.role in ('ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT'))
        or (p_ultg_id is not null and actor.ultg_id = p_ultg_id and actor.role = 'MGR_ULTG')
      )
  )
$$;

create or replace function public.tug_workflow_contains_data_url(p_data jsonb)
returns boolean
language sql immutable
as $$ select coalesce(p_data::text ~* 'data:image/[a-z0-9.+-]+;base64,', false) $$;
revoke all on function public.tug_workflow_scope_allowed(text, text, text) from public, anon, authenticated;
revoke all on function public.tug_workflow_contains_data_url(jsonb) from public, anon, authenticated;

-- TUG-5 UPT Asman final approval. The production migration owns the same
-- definition plus the rollout verifier and rollback file.
create or replace function public.approve_tug5_asman_with_child(
  p_parent_id text,
  p_expected_version integer,
  p_child_id text,
  p_child_data jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  a public.profiles;
  parent_row public.tug_workflow_transactions;
  child_row public.tug_workflow_transactions;
  v_transfer text;
  v_child_type text;
  v_child_upt text := null;
  v_child_uit text;
  v_parent_data jsonb;
  v_child_data jsonb;
  v_reference_key text;
  v_epoch_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_now timestamptz := clock_timestamp();
begin
  select * into a from public.profiles where id = auth.uid();
  if a.id is null then raise exception 'TUG_WORKFLOW_AUTH_REQUIRED'; end if;
  if p_parent_id is null or btrim(p_parent_id) = ''
     or p_child_id is null or btrim(p_child_id) = ''
     or p_parent_id = p_child_id then
    raise exception 'TUG_WORKFLOW_PARENT_CHILD_ID_INVALID';
  end if;
  if p_child_data is null or jsonb_typeof(p_child_data) <> 'object'
     or public.tug_workflow_contains_data_url(p_child_data) then
    raise exception 'TUG_WORKFLOW_PATCH_INVALID';
  end if;
  select * into parent_row
    from public.tug_workflow_transactions
   where id = p_parent_id
   for update;
  if parent_row.id is null then raise exception 'TUG_WORKFLOW_NOT_FOUND'; end if;
  if parent_row.doc_type <> 'TUG5' then raise exception 'TUG_WORKFLOW_DOC_TYPE_INVALID'; end if;
  if parent_row.ultg_id is not null
     or parent_row.uit_id is not null
     or upper(coalesce(parent_row.data->>'sourceType', '')) = 'ULTG'
     or upper(coalesce(parent_row.data->>'docSubType', '')) = 'UIT_INTERCOMPANY' then
    raise exception 'TUG_WORKFLOW_UPT_PARENT_REQUIRED';
  end if;
  if not public.tug_workflow_scope_allowed(parent_row.upt_id, parent_row.uit_id, parent_row.ultg_id) then
    raise exception 'TUG_WORKFLOW_SCOPE_DENIED';
  end if;
  if a.role not in ('ASMAN', 'SUPERADMIN', 'ADMIN_LOG_PUSAT') then
    raise exception 'TUG_WORKFLOW_ROLE_DENIED';
  end if;
  if a.role = 'ASMAN' and (parent_row.upt_id is null or a.upt_id is distinct from parent_row.upt_id) then
    raise exception 'TUG_WORKFLOW_SCOPE_DENIED';
  end if;
  select * into child_row
    from public.tug_workflow_transactions
   where parent_workflow_id = parent_row.id
   for update;
  if child_row.id is not null then
    if child_row.id <> p_child_id then raise exception 'TUG_WORKFLOW_CHILD_ALREADY_EXISTS'; end if;
    if parent_row.stage = 'APPROVED' and parent_row.status = 'APPROVED'
       and parent_row.data->>'approvedByAsman' = auth.uid()::text then
      return jsonb_build_object('ok', true, 'idempotent', true,
        'action', 'TUG5_ASMAN_APPROVE', 'parent', to_jsonb(parent_row), 'child', to_jsonb(child_row));
    end if;
    raise exception 'TUG_WORKFLOW_CHILD_ALREADY_EXISTS';
  end if;
  if p_expected_version is null or parent_row.version <> p_expected_version then
    raise exception 'TUG_WORKFLOW_VERSION_MISMATCH';
  end if;
  if parent_row.stage <> 'PENDING_ASMAN' or parent_row.status <> 'PENDING' then
    raise exception 'TUG_WORKFLOW_STAGE_TRANSITION_INVALID';
  end if;
  v_transfer := upper(coalesce(parent_row.data->>'jenisTransfer', 'INTRACOMPANY'));
  if v_transfer = 'INTRACOMPANY' then
    v_child_type := 'TUG7';
    v_reference_key := 'tug7Id';
  elsif v_transfer = 'INTERCOMPANY' then
    v_child_type := 'TUG5';
    v_reference_key := 'draftTug5UITId';
  else
    raise exception 'TUG_WORKFLOW_TRANSFER_INVALID';
  end if;
  select u.uit_id into v_child_uit from public.upt u where u.id = parent_row.upt_id;
  if v_child_uit is null or not exists (select 1 from public.uit where id = v_child_uit) then
    raise exception 'TUG_WORKFLOW_UIT_REQUIRED';
  end if;
  if (v_child_upt is null) = (v_child_uit is null) then
    raise exception 'TUG_WORKFLOW_SCOPE_INVALID';
  end if;
  select * into child_row from public.tug_workflow_transactions where id = p_child_id for update;
  if child_row.id is not null then raise exception 'TUG_WORKFLOW_CHILD_ID_CONFLICT'; end if;
  v_parent_data := parent_row.data || jsonb_build_object(
    v_reference_key, p_child_id, 'approvedByAsman', a.id, 'approvedAtAsman', v_epoch_ms
  );
  v_child_data := (p_child_data - ARRAY[
    'docType', 'uptId', 'uitId', 'ultgId', 'parentWorkflowId', 'createdBy',
    'createdAt', 'docNumbers', 'docSeq', 'workflowVersion', 'stage',
    'status', 'requiredApprover', 'uptPengirimId', 'tug5Id', 'tug5UptId',
    'docSubType', 'sourceType', 'stockItems'
  ]) || jsonb_build_object(
    'docType', v_child_type, 'parentWorkflowId', parent_row.id, 'createdBy', a.id,
    'createdAt', v_epoch_ms, 'docNumbers', '{}'::jsonb, 'docSeq', null
  ) || case when v_child_type = 'TUG7'
    then jsonb_build_object('tug5Id', parent_row.id)
    else jsonb_build_object('tug5UptId', parent_row.id)
  end;
  if v_child_type = 'TUG7' then
    v_child_data := jsonb_set(v_child_data, '{stockItems}', coalesce((
      select jsonb_agg(item || jsonb_build_object(
        'qty', coalesce(nullif(item->'permintaan', 'null'::jsonb), nullif(item->'qty', 'null'::jsonb), '0'::jsonb)
      ) order by ord)
      from jsonb_array_elements(coalesce(parent_row.data->'stockItems', '[]'::jsonb)) with ordinality as source(item, ord)
    ), '[]'::jsonb), true);
  else
    v_child_data := jsonb_set(v_child_data, '{docSubType}', '"UIT_INTERCOMPANY"'::jsonb, true);
    v_child_data := jsonb_set(v_child_data, '{stockItems}', coalesce(parent_row.data->'stockItems', '[]'::jsonb), true);
  end if;
  update public.tug_workflow_transactions
     set stage = 'APPROVED', status = 'APPROVED', data = v_parent_data,
         version = version + 1, updated_at = v_now
   where id = parent_row.id returning * into parent_row;
  insert into public.tug_workflow_transactions(
    id, doc_type, upt_id, uit_id, ultg_id, created_by, stage, status,
    doc_number, doc_sequence, version, parent_workflow_id, data, created_at, updated_at
  ) values (
    p_child_id, v_child_type, v_child_upt, v_child_uit, null, a.id,
    'DRAFT_UIT', 'PENDING', null, null, 1, parent_row.id, v_child_data, v_now, v_now
  ) returning * into child_row;
  return jsonb_build_object('ok', true, 'idempotent', false,
    'action', 'TUG5_ASMAN_APPROVE', 'parent', to_jsonb(parent_row), 'child', to_jsonb(child_row));
end
$$;
revoke all on function public.approve_tug5_asman_with_child(text, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.approve_tug5_asman_with_child(text, integer, text, jsonb) to authenticated;

-- New UPT TUG-5 is final at Asman. Legacy rows already at PENDING_MANAGER
-- remain eligible for the existing Manager transition RPC.
create or replace function public.guard_tug5_asman_final_stage()
returns trigger
language plpgsql
security definer set search_path = public, pg_catalog
as $$
begin
  if old.doc_type = 'TUG5' and old.stage = 'PENDING_ASMAN' and new.stage = 'PENDING_MANAGER' then
    raise exception 'TUG_WORKFLOW_ASMAN_FINAL_ONLY';
  end if;
  return new;
end
$$;
drop trigger if exists tug5_asman_final_stage_guard on public.tug_workflow_transactions;
create trigger tug5_asman_final_stage_guard
before update of stage on public.tug_workflow_transactions
for each row execute function public.guard_tug5_asman_final_stage();
revoke all on function public.guard_tug5_asman_final_stage() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- TUG-10 dedicated transaction table. The operational migration
-- 20260824_tug10_transactions.sql creates the same table in production.
create table if not exists public.tug10_transactions (
  id text primary key,
  upt_id text not null,
  created_by uuid,
  doc_number text,
  stage text not null default 'DRAFT',
  status text not null default 'DRAFT',
  data jsonb not null default '{}'::jsonb,
  created_at bigint,
  updated_at bigint
);
alter table public.tug10_transactions enable row level security;
drop policy if exists "read tug10 scoped" on public.tug10_transactions;
drop policy if exists "write tug10 scoped" on public.tug10_transactions;
create policy "read tug10 scoped" on public.tug10_transactions
  for select using (auth.uid() is not null and public.can_access_upt(upt_id));
create policy "write tug10 scoped" on public.tug10_transactions
  for all using (public.can_access_upt(upt_id)) with check (public.can_access_upt(upt_id));
grant select, insert, update, delete on public.tug10_transactions to authenticated;
grant select, insert, update, delete on public.tug10_transactions to service_role;
create index if not exists idx_tug10_transactions_upt on public.tug10_transactions (upt_id);

-- TUG-10 atomic final approval mirror. Keep this block aligned with
-- migrations/20261001_tug10_atomic_final_approval.sql.
-- TUG-10 final approval: one atomic, idempotent server transaction.
-- PROPOSAL ONLY: apply to self-host production only after explicit approval.

begin;

create table if not exists public.tug_idempotency_keys (
  key uuid primary key,
  operation text not null,
  actor_id uuid not null,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.tug_idempotency_keys
  drop constraint if exists tug_idempotency_keys_operation_check;
alter table public.tug_idempotency_keys
  add constraint tug_idempotency_keys_operation_check
  check (operation in ('CREATE','SUBMIT','DECIDE','AMEND','TUG10_FINAL_APPROVE'));

alter table public.tug_idempotency_keys enable row level security;
revoke all on public.tug_idempotency_keys from anon, authenticated;
grant all on public.tug_idempotency_keys to service_role;

create or replace function public.tug10_guard_legacy_stock_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if current_setting('app.tug10_final_rpc', true) = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' and (new.data ? '_tug10Applied') then
    raise exception 'TUG10_STOCK_RPC_REQUIRED' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (
    (new.data->'_tug10Applied') is distinct from (old.data->'_tug10Applied')
    or ((old.data ? '_tug10Applied')
      and coalesce(nullif(new.data->>'qty', '')::numeric, 0) > coalesce(nullif(old.data->>'qty', '')::numeric, 0))
    or (new.data->'sourceLot'->>'sourceTransactionId') is distinct from (old.data->'sourceLot'->>'sourceTransactionId')
    or (new.data->'sourceLot'->>'sourceItemIndex') is distinct from (old.data->'sourceLot'->>'sourceItemIndex')
  ) then
    raise exception 'TUG10_STOCK_RPC_REQUIRED' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tug10_guard_legacy_stock_write on public.stocks;
create trigger trg_tug10_guard_legacy_stock_write
before insert or update on public.stocks
for each row execute function public.tug10_guard_legacy_stock_write();
revoke all on function public.tug10_guard_legacy_stock_write() from public, anon, authenticated;

create or replace function public.tug10_guard_legacy_status_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if current_setting('app.tug10_final_rpc', true) = 'on' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'APPROVED' and new.status <> old.status then
    raise exception 'TUG10_APPROVED_IMMUTABLE' using errcode = '42501';
  end if;
  if new.status = 'APPROVED' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    raise exception 'TUG10_APPROVAL_RPC_REQUIRED' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tug10_guard_legacy_status_write on public.tug10_transactions;
create trigger trg_tug10_guard_legacy_status_write
before insert or update on public.tug10_transactions
for each row execute function public.tug10_guard_legacy_status_write();
revoke all on function public.tug10_guard_legacy_status_write() from public, anon, authenticated;

-- Legacy overwritten approve_tug10_final was removed from the bootstrap snapshot.
-- Snapshot the requester display name into each new heavy-equipment loan.
-- The value is server-authoritative and remains readable when profile SELECT
-- scope hides the requester profile from another UPT.

create or replace function public.snapshot_heavy_equipment_requester_name()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_name text;
begin
  select nullif(trim(p.name), '')
    into v_name
    from public.profiles p
   where p.id::text = nullif(trim(new.data->>'requestedBy'), '');

  if v_name is null then
    raise exception 'Nama pemohon wajib berasal dari profil yang valid.' using errcode = '23514';
  end if;

  new.data := coalesce(new.data, '{}'::jsonb) - 'requestedByName';
  new.data := new.data || jsonb_build_object('requestedByName', v_name);
  return new;
end;
$$;

revoke all on function public.snapshot_heavy_equipment_requester_name() from public;

drop trigger if exists trg_heavy_equipment_requester_name_snapshot on public.heavy_equipment_loans;
create trigger trg_heavy_equipment_requester_name_snapshot
before insert on public.heavy_equipment_loans
for each row execute function public.snapshot_heavy_equipment_requester_name();

notify pgrst, 'reload schema';

-- Official UIT roles: read-only access to same-UIT equipment, loans, and
-- referenced private evidence. UPT, HAR_UIT, and national branches above remain.
drop policy if exists "Heavy equipment scoped read" on public.heavy_equipment;
create policy "Heavy equipment scoped read" on public.heavy_equipment
  for select to authenticated using (exists (select 1 from public.profiles actor where actor.id = auth.uid() and (
    actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT')
    or actor.upt_id = heavy_equipment.upt_id
    or (heavy_equipment.is_cross_upt_borrowable and actor.upt_id is not null)
    or (actor.role in ('ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT') and actor.uit_id is not null and exists (
      select 1 from public.upt scoped_upt where scoped_upt.id = heavy_equipment.upt_id and scoped_upt.uit_id = actor.uit_id
    ))
  )));
drop policy if exists "Heavy equipment loan scoped read" on public.heavy_equipment_loans;
create policy "Heavy equipment loan scoped read" on public.heavy_equipment_loans
  for select to authenticated using (exists (select 1 from public.profiles actor where actor.id = auth.uid() and (
    actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT')
    or actor.upt_id = owner_upt_id or actor.upt_id = requester_upt_id
    or (actor.role in ('ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT') and actor.uit_id is not null and (
      exists (select 1 from public.upt scoped_upt where scoped_upt.id = owner_upt_id and scoped_upt.uit_id = actor.uit_id)
      or exists (select 1 from public.upt scoped_upt where scoped_upt.id = requester_upt_id and scoped_upt.uit_id = actor.uit_id)
    ))
  )));
drop policy if exists "Heavy equipment evidence read" on storage.objects;
create policy "Heavy equipment evidence read" on storage.objects
  for select to authenticated using (bucket_id = 'heavy-equipment-evidence' and exists (select 1 from public.profiles actor where actor.id = auth.uid() and (
    actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT') or actor.upt_id = (storage.foldername(name))[1]
    or exists (select 1 from public.heavy_equipment_loans l where (
      l.data->>'pickupEvidencePath' = name or l.data->>'returnEvidencePath' = name
      or exists (select 1 from jsonb_array_elements(coalesce(l.data->'returnEvents', '[]'::jsonb)) event where event->>'evidencePath' = name)
    ) and (actor.upt_id = l.requester_upt_id or (actor.role in ('ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT') and actor.uit_id is not null and (
      exists (select 1 from public.upt scoped_upt where scoped_upt.id = l.owner_upt_id and scoped_upt.uit_id = actor.uit_id)
      or exists (select 1 from public.upt scoped_upt where scoped_upt.id = l.requester_upt_id and scoped_upt.uit_id = actor.uit_id)
    )))
  ))));

notify pgrst, 'reload schema';




-- HAR_UIT direct borrower parity (migration 20260921).
-- requester_uit_id is nullable for legacy UPT/vendor loans; no backfill is
-- safe without a trusted historical requester identity.
alter table public.heavy_equipment_loans
  add column if not exists requester_uit_id text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'heavy_equipment_loans_requester_uit_id_fkey') then
    alter table public.heavy_equipment_loans add constraint heavy_equipment_loans_requester_uit_id_fkey
      foreign key (requester_uit_id) references public.uit(id);
  end if;
end $$;
create index if not exists idx_heavy_equipment_loans_requester_uit_id on public.heavy_equipment_loans(requester_uit_id);

-- Final HAR_UIT RLS contract. The executable checkout RPC definitions are
-- maintained in 20260921_har_uit_heavy_equipment_loans.sql and must be applied
-- after this snapshot on upgraded self-host installations.
drop policy if exists "Heavy equipment scoped read" on public.heavy_equipment;
create policy "Heavy equipment scoped read" on public.heavy_equipment
  for select to authenticated using (
    exists (select 1 from public.profiles actor where actor.id = auth.uid() and (
      actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT')
      or actor.upt_id = heavy_equipment.upt_id
      or (heavy_equipment.is_cross_upt_borrowable and actor.upt_id is not null)
      or (actor.role = 'HAR_UIT' and actor.uit_id is not null and exists (
        select 1 from public.upt owner_upt where owner_upt.id = heavy_equipment.upt_id and owner_upt.uit_id = actor.uit_id
      ))
    ))
  );
drop policy if exists "Heavy equipment loan scoped read" on public.heavy_equipment_loans;
create policy "Heavy equipment loan scoped read" on public.heavy_equipment_loans
  for select to authenticated using (
    exists (select 1 from public.profiles actor where actor.id = auth.uid() and (
      actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT')
      or actor.upt_id = owner_upt_id
      or actor.upt_id = requester_upt_id
      or (actor.role = 'HAR_UIT' and actor.uit_id is not null and (
        requester_uit_id = actor.uit_id
        or exists (select 1 from public.upt owner_upt where owner_upt.id = owner_upt_id and owner_upt.uit_id = actor.uit_id)
        or exists (select 1 from public.upt requester_upt where requester_upt.id = requester_upt_id and requester_upt.uit_id = actor.uit_id)
      ))
    ))
  );

-- HAR_UIT checkout contract: borrowerType=HAR_UIT, borrowerUitId must equal
-- auth profile uit_id, owner UPT must belong to that UIT, all assets must be
-- cross-enabled and available, requester_upt_id stays NULL, and the batch
-- status waits for owner Asman. Both established RPC signatures are retained.
-- See migration 20260921_har_uit_heavy_equipment_loans.sql for executable
-- create or replace bodies and storage policies.

-- Form 5S drafts — private owner + active UPT scope. Proposal mirror for the
-- production migration; apply the migration only after explicit confirmation.
create table if not exists public.maturity_5s_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  upt_id text not null references public.upt(id) on delete restrict,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maturity_5s_drafts_owner_upt_key unique (owner_id, upt_id)
);
create index if not exists idx_maturity_5s_drafts_owner_updated
  on public.maturity_5s_drafts(owner_id, updated_at desc);
create index if not exists idx_maturity_5s_drafts_upt
  on public.maturity_5s_drafts(upt_id);
create or replace function public.touch_maturity_5s_draft_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists maturity_5s_drafts_touch_updated_at on public.maturity_5s_drafts;
create trigger maturity_5s_drafts_touch_updated_at
  before update on public.maturity_5s_drafts
  for each row execute function public.touch_maturity_5s_draft_updated_at();
create or replace function public.can_manage_maturity_5s_draft(p_owner_id uuid, p_upt_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_write_maturity_upt(p_upt_id)
    and p_owner_id = auth.uid()
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and (actor.role = 'SUPERADMIN' or actor.upt_id = p_upt_id));
$$;
revoke all on function public.can_manage_maturity_5s_draft(uuid, text) from public;
grant execute on function public.can_manage_maturity_5s_draft(uuid, text) to authenticated;
alter table public.maturity_5s_drafts enable row level security;
grant select, insert, update, delete on public.maturity_5s_drafts to authenticated;
grant all on public.maturity_5s_drafts to service_role;
drop policy if exists "Maturity 5s drafts owner read" on public.maturity_5s_drafts;
drop policy if exists "Maturity 5s drafts owner insert" on public.maturity_5s_drafts;
drop policy if exists "Maturity 5s drafts owner update" on public.maturity_5s_drafts;
drop policy if exists "Maturity 5s drafts owner delete" on public.maturity_5s_drafts;
create policy "Maturity 5s drafts owner read" on public.maturity_5s_drafts for select to authenticated using (public.can_manage_maturity_5s_draft(owner_id, upt_id));
create policy "Maturity 5s drafts owner insert" on public.maturity_5s_drafts for insert to authenticated with check (public.can_manage_maturity_5s_draft(owner_id, upt_id));
create policy "Maturity 5s drafts owner update" on public.maturity_5s_drafts for update to authenticated using (public.can_manage_maturity_5s_draft(owner_id, upt_id)) with check (public.can_manage_maturity_5s_draft(owner_id, upt_id));
create policy "Maturity 5s drafts owner delete" on public.maturity_5s_drafts for delete to authenticated using (public.can_manage_maturity_5s_draft(owner_id, upt_id));
notify pgrst, 'reload schema';

-- Canonical Alat Bantu Kerja parity with migration 20260920_heavy_equipment_upt_id_loans.sql.
-- This idempotent block keeps fresh and upgraded self-host installations aligned.
alter table public.heavy_equipment
  add column if not exists upt_id text,
  add column if not exists is_cross_upt_borrowable boolean not null default false;
alter table public.heavy_equipment_loans
  add column if not exists owner_upt_id text,
  add column if not exists requester_upt_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'heavy_equipment_upt_id_fkey') then
    alter table public.heavy_equipment add constraint heavy_equipment_upt_id_fkey foreign key (upt_id) references public.upt(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'heavy_equipment_loans_owner_upt_id_fkey') then
    alter table public.heavy_equipment_loans add constraint heavy_equipment_loans_owner_upt_id_fkey foreign key (owner_upt_id) references public.upt(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'heavy_equipment_loans_requester_upt_id_fkey') then
    alter table public.heavy_equipment_loans add constraint heavy_equipment_loans_requester_upt_id_fkey foreign key (requester_upt_id) references public.upt(id);
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from public.heavy_equipment e
    where (select count(*) from public.upt u where regexp_replace(upper(trim(u.data->>'nama')), '^UPT[[:space:]]+', '') = regexp_replace(upper(trim(coalesce(e.upt, e.data->>'upt', ''))), '^UPT[[:space:]]+', '')) <> 1
  ) then raise exception 'heavy_equipment: snapshot nama UPT tidak unik atau tidak ditemukan'; end if;
  if exists (
    select 1 from public.heavy_equipment_loans l
    where (select count(*) from public.upt u where regexp_replace(upper(trim(u.data->>'nama')), '^UPT[[:space:]]+', '') = regexp_replace(upper(trim(coalesce(l.owner_upt, l.data->>'ownerUpt', ''))), '^UPT[[:space:]]+', '')) <> 1
  ) then raise exception 'heavy_equipment_loans: snapshot owner UPT tidak unik atau tidak ditemukan'; end if;
  if exists (
    select 1 from public.heavy_equipment_loans l
    where nullif(trim(coalesce(l.requester_upt, l.data->>'requesterUpt', '')), '') is not null
      and coalesce(l.data->>'borrowerType', 'UPT') = 'UPT'
      and (select count(*) from public.upt u where regexp_replace(upper(trim(u.data->>'nama')), '^UPT[[:space:]]+', '') = regexp_replace(upper(trim(coalesce(l.requester_upt, l.data->>'requesterUpt', ''))), '^UPT[[:space:]]+', '')) <> 1
  ) then raise exception 'heavy_equipment_loans: snapshot requester UPT tidak unik atau tidak ditemukan'; end if;
end $$;

-- Existing rows store a display-name snapshot. Resolve it exactly once to the typed
-- master id; ambiguous/unmapped legacy data must stop the migration.
-- Before this flag existed the registry was intentionally readable lintas-UPT.
-- Preserve that behavior only for legacy rows; new rows keep the private default.
update public.heavy_equipment
set is_cross_upt_borrowable = true
where upt_id is null;

update public.heavy_equipment e
set upt_id = u.id
from public.upt u
where e.upt_id is null
  and regexp_replace(upper(trim(u.data->>'nama')), '^UPT[[:space:]]+', '')
    = regexp_replace(upper(trim(coalesce(e.upt, e.data->>'upt', ''))), '^UPT[[:space:]]+', '');

update public.heavy_equipment_loans l
set owner_upt_id = u.id
from public.upt u
where l.owner_upt_id is null
  and regexp_replace(upper(trim(u.data->>'nama')), '^UPT[[:space:]]+', '')
    = regexp_replace(upper(trim(coalesce(l.owner_upt, l.data->>'ownerUpt', ''))), '^UPT[[:space:]]+', '');

update public.heavy_equipment_loans l
set requester_upt_id = u.id
from public.upt u
where l.requester_upt_id is null
  and coalesce(l.data->>'borrowerType', 'UPT') = 'UPT'
  and regexp_replace(upper(trim(u.data->>'nama')), '^UPT[[:space:]]+', '')
    = regexp_replace(upper(trim(coalesce(l.requester_upt, l.data->>'requesterUpt', ''))), '^UPT[[:space:]]+', '');

do $$
begin
  if exists (select 1 from public.heavy_equipment where upt_id is null) then
    raise exception 'heavy_equipment: ada upt_id yang tidak dapat dipetakan secara unik';
  end if;
  if exists (select 1 from public.heavy_equipment_loans where owner_upt_id is null) then
    raise exception 'heavy_equipment_loans: ada owner_upt_id yang tidak dapat dipetakan secara unik';
  end if;
end $$;

alter table public.heavy_equipment alter column upt_id set not null;
alter table public.heavy_equipment_loans alter column owner_upt_id set not null;
create index if not exists idx_heavy_equipment_upt_id on public.heavy_equipment(upt_id);
create index if not exists idx_heavy_equipment_loans_owner_upt_id on public.heavy_equipment_loans(owner_upt_id);
create index if not exists idx_heavy_equipment_loans_requester_upt_id on public.heavy_equipment_loans(requester_upt_id);

alter table public.heavy_equipment enable row level security;
alter table public.heavy_equipment_loans enable row level security;
drop policy if exists "Authenticated read heavy_equipment" on public.heavy_equipment;
drop policy if exists "Authenticated write heavy_equipment" on public.heavy_equipment;
drop policy if exists "Read heavy_equipment authenticated" on public.heavy_equipment;
drop policy if exists "Scoped read heavy_equipment" on public.heavy_equipment;
drop policy if exists "Scoped write heavy_equipment" on public.heavy_equipment;
drop policy if exists "Heavy equipment scoped read" on public.heavy_equipment;
drop policy if exists "Heavy equipment TL insert" on public.heavy_equipment;
drop policy if exists "Heavy equipment TL update" on public.heavy_equipment;
drop policy if exists "Heavy equipment TL delete" on public.heavy_equipment;
create policy "Heavy equipment scoped read" on public.heavy_equipment
  for select to authenticated using (
    exists (
      select 1 from public.profiles actor
      where actor.id = auth.uid()
        and (
          actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT')
          or actor.upt_id = heavy_equipment.upt_id
          or (heavy_equipment.is_cross_upt_borrowable and actor.upt_id is not null)
        )
    )
  );
create policy "Heavy equipment TL insert" on public.heavy_equipment
  for insert to authenticated with check (
    exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = heavy_equipment.upt_id)
  );
create policy "Heavy equipment TL update" on public.heavy_equipment
  for update to authenticated using (
    exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = heavy_equipment.upt_id)
  ) with check (
    exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = heavy_equipment.upt_id)
  );
create policy "Heavy equipment TL delete" on public.heavy_equipment
  for delete to authenticated using (
    exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = heavy_equipment.upt_id)
  );

drop policy if exists "Authenticated read heavy_equipment_loans" on public.heavy_equipment_loans;
drop policy if exists "Authenticated write heavy_equipment_loans" on public.heavy_equipment_loans;
drop policy if exists "Scoped all heavy_equipment_loans" on public.heavy_equipment_loans;
drop policy if exists "Heavy equipment loan scoped read" on public.heavy_equipment_loans;
create policy "Heavy equipment loan scoped read" on public.heavy_equipment_loans
  for select to authenticated using (exists (
    select 1 from public.profiles actor where actor.id = auth.uid()
      and (actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT') or actor.upt_id = owner_upt_id or actor.upt_id = requester_upt_id)
  ));
-- Loan state changes happen only in security-definer RPCs. No authenticated direct insert/update/delete policy is intentional.

insert into storage.buckets (id, name, public)
values ('heavy-equipment-evidence', 'heavy-equipment-evidence', false)
on conflict (id) do update set public = false;
drop policy if exists "Heavy equipment evidence read" on storage.objects;
drop policy if exists "Heavy equipment evidence insert" on storage.objects;
drop policy if exists "Heavy equipment evidence update" on storage.objects;
drop policy if exists "Heavy equipment evidence delete" on storage.objects;
create policy "Heavy equipment evidence read" on storage.objects
  for select to authenticated using (
    bucket_id = 'heavy-equipment-evidence'
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and (
      actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT')
      or actor.upt_id = (storage.foldername(name))[1]
      or exists (select 1 from public.heavy_equipment_loans l where (l.data->>'pickupEvidencePath' = name or l.data->>'returnEvidencePath' = name) and actor.upt_id = l.requester_upt_id)
    ))
  );
create policy "Heavy equipment evidence insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'heavy-equipment-evidence'
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = (storage.foldername(name))[1])
  );
create policy "Heavy equipment evidence update" on storage.objects
  for update to authenticated using (
    bucket_id = 'heavy-equipment-evidence'
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = (storage.foldername(name))[1])
  ) with check (
    bucket_id = 'heavy-equipment-evidence'
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = (storage.foldername(name))[1])
  );
create policy "Heavy equipment evidence delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'heavy-equipment-evidence'
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = (storage.foldername(name))[1])
  );

create or replace function public.checkout_heavy_equipment_batch(
  p_equipment_ids text[], p_borrower jsonb, p_job jsonb, p_pickup_evidence_path text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor profiles%rowtype;
  v_equipment heavy_equipment%rowtype;
  v_owner_id text;
  v_requester_id text := nullif(trim(coalesce(p_borrower->>'borrowerRefId', '')), '');
  v_type text := upper(coalesce(p_borrower->>'borrowerType', 'UPT'));
  v_batch_id text := coalesce(nullif(trim(p_job->>'batchId'), ''), 'HE-BATCH-' || replace(gen_random_uuid()::text, '-', ''));
  v_status text := case when v_type = 'UPT' then 'PENDING_OWNER_ASMAN' else 'DIPINJAM' end;
  v_count integer := 0;
  v_loans jsonb := '[]'::jsonb;
  v_assets jsonb := '[]'::jsonb;
  v_loan_id text;
  v_row jsonb;
begin
  select * into v_actor from profiles where id = auth.uid();
  if not found or v_actor.role <> 'TL' then raise exception 'Hanya TL UPT pemilik alat yang boleh mencatat peminjaman.' using errcode = '42501'; end if;
  if coalesce(array_length(p_equipment_ids, 1), 0) = 0 or nullif(trim(p_pickup_evidence_path), '') is null then raise exception 'Alat dan bukti serah-terima wajib diisi.' using errcode = '23514'; end if;
  if v_type not in ('UPT','ULTG','GI','VENDOR','UNIT_LAIN') then raise exception 'Jenis peminjam tidak valid.' using errcode = '22023'; end if;
  if nullif(trim(p_job->>'namaPekerjaan'), '') is null or nullif(trim(p_job->>'tanggalAmbil'), '') is null or nullif(trim(p_job->>'tanggalKembali'), '') is null or nullif(trim(p_job->>'keperluan'), '') is null then raise exception 'Pekerjaan, tanggal, dan keperluan wajib diisi.' using errcode = '23514'; end if;
  if (p_job->>'tanggalKembali')::date < (p_job->>'tanggalAmbil')::date then raise exception 'Tanggal kembali tidak boleh sebelum tanggal ambil.' using errcode = '22007'; end if;
  select e.upt_id into v_owner_id from heavy_equipment e where e.id = p_equipment_ids[1];
  if v_owner_id is null then raise exception 'Alat tidak ditemukan.' using errcode = 'P0002'; end if;
  if v_actor.upt_id <> v_owner_id then raise exception 'Actor bukan TL UPT pemilik alat.' using errcode = '42501'; end if;
  if left(p_pickup_evidence_path, length(v_owner_id) + 1) <> v_owner_id || '/' then raise exception 'Path bukti tidak sesuai UPT pemilik.' using errcode = '42501'; end if;
  if (select count(*) from heavy_equipment where id = any(p_equipment_ids)) <> (select count(distinct x) from unnest(p_equipment_ids) x) then raise exception 'Daftar alat tidak valid.' using errcode = 'P0002'; end if;
  for v_equipment in select * from heavy_equipment where id = any(p_equipment_ids) order by id for update loop
    v_count := v_count + 1;
    if v_equipment.upt_id <> v_owner_id or v_equipment.data->>'availabilityStatus' = 'DIPINJAM' or v_equipment.data->>'statusAlat' in ('MAINTENANCE','KIR') then raise exception 'Semua alat harus tersedia dan milik satu UPT.' using errcode = '40001'; end if;
    if v_type = 'UPT' and not v_equipment.is_cross_upt_borrowable then raise exception 'Ada alat yang tidak diizinkan untuk peminjaman lintas-UPT.' using errcode = '42501'; end if;
    if exists (select 1 from heavy_equipment_loans l where l.equipment_id = v_equipment.id and l.status in ('PENDING_OWNER_ASMAN','DIPINJAM','APPROVED','OVERDUE')) then raise exception 'Alat memiliki peminjaman aktif.' using errcode = '40001'; end if;
  end loop;
  if v_count <> array_length(p_equipment_ids, 1) then raise exception 'Daftar alat tidak valid.' using errcode = 'P0002'; end if;
  if v_type = 'UPT' and (v_requester_id is null or v_requester_id = v_owner_id) then raise exception 'UPT peminjam tidak valid.' using errcode = '23514'; end if;
  if v_type <> 'UPT' and (nullif(trim(p_borrower->>'borrowerName'), '') is null or nullif(trim(p_borrower->>'borrowerPic'), '') is null or nullif(trim(p_borrower->>'borrowerContact'), '') is null) then raise exception 'Nama organisasi, PIC, dan kontak wajib diisi.' using errcode = '23514'; end if;
  for v_equipment in select * from heavy_equipment where id = any(p_equipment_ids) order by id loop
    v_loan_id := 'HLOAN-' || replace(gen_random_uuid()::text, '-', '');
    insert into heavy_equipment_loans (id, data, created_at, equipment_id, status, owner_upt, requester_upt, owner_upt_id, requester_upt_id)
    values (v_loan_id, jsonb_build_object(
      'id', v_loan_id, 'equipmentId', v_equipment.id, 'loanBatchId', v_batch_id,
      'ownerUptId', v_owner_id, 'requesterUptId', v_requester_id, 'ownerUpt', v_equipment.upt,
      'requesterUpt', coalesce((select u.data->>'nama' from upt u where u.id = v_requester_id), p_borrower->>'borrowerName'),
      'borrowerType', v_type, 'borrowerName', p_borrower->>'borrowerName', 'borrowerPic', p_borrower->>'borrowerPic', 'borrowerContact', p_borrower->>'borrowerContact',
      'namaPekerjaan', p_job->>'namaPekerjaan', 'tanggalAmbil', p_job->>'tanggalAmbil', 'tanggalKembali', p_job->>'tanggalKembali', 'keperluan', p_job->>'keperluan', 'catatan', p_job->>'catatan',
      'pickupEvidencePath', p_pickup_evidence_path, 'requestedBy', auth.uid()::text, 'requestedAt', floor(extract(epoch from clock_timestamp()) * 1000)::bigint, 'status', v_status
    ), floor(extract(epoch from clock_timestamp()) * 1000)::bigint, v_equipment.id, v_status, v_equipment.upt, coalesce((select u.data->>'nama' from upt u where u.id = v_requester_id), p_borrower->>'borrowerName'), v_owner_id, v_requester_id);
    select data || jsonb_build_object('id', id) into v_row from heavy_equipment_loans where id = v_loan_id;
    v_loans := v_loans || jsonb_build_array(v_row);
    update heavy_equipment set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('availabilityStatus', 'DIPINJAM', 'activeLoanId', v_loan_id, 'loanBatchId', v_batch_id) where id = v_equipment.id returning data || jsonb_build_object('id', id, 'uptId', upt_id, 'isCrossUptBorrowable', is_cross_upt_borrowable) into v_row;
    v_assets := v_assets || jsonb_build_array(v_row);
  end loop;
  return jsonb_build_object('batchId', v_batch_id, 'loans', v_loans, 'equipment', v_assets);
end $$;
revoke all on function public.checkout_heavy_equipment_batch(text[], jsonb, jsonb, text) from public;
grant execute on function public.checkout_heavy_equipment_batch(text[], jsonb, jsonb, text) to authenticated;

-- Approval/return RPCs are intentionally separate from direct table writes. They lock
-- the full batch in stable id order and return canonical JSON for server-first UI state.
create or replace function public.approve_heavy_equipment_batch(p_loan_id text, p_decision text default 'APPROVED', p_catatan text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor profiles%rowtype;
  v_loan heavy_equipment_loans%rowtype;
  v_batch_loan heavy_equipment_loans%rowtype;
  v_status text := upper(coalesce(p_decision, 'APPROVED'));
  v_batch_id text;
  v_loans jsonb;
  v_assets jsonb;
begin
  select * into v_actor from profiles where id = auth.uid();
  if not found or v_actor.role <> 'ASMAN' then raise exception 'Hanya Asman UPT pemilik alat yang boleh memutuskan.' using errcode = '42501'; end if;
  select * into v_loan from heavy_equipment_loans where id = p_loan_id;
  if not found or v_loan.status <> 'PENDING_OWNER_ASMAN' then raise exception 'Peminjaman tidak menunggu approval.' using errcode = 'P0001'; end if;
  if v_actor.upt_id <> v_loan.owner_upt_id then raise exception 'Hanya Asman UPT pemilik alat yang boleh memutuskan.' using errcode = '42501'; end if;
  if v_status not in ('APPROVED','REJECTED') then raise exception 'Keputusan approval tidak valid.' using errcode = '22023'; end if;
  v_batch_id := nullif(v_loan.data->>'loanBatchId', '');
  if v_batch_id is null then raise exception 'Batch peminjaman tidak valid.' using errcode = '23514'; end if;
  for v_batch_loan in select * from heavy_equipment_loans where data->>'loanBatchId' = v_batch_id order by id for update loop
    if v_batch_loan.status <> 'PENDING_OWNER_ASMAN' or v_batch_loan.owner_upt_id <> v_loan.owner_upt_id then raise exception 'Status atau UPT dalam batch tidak konsisten.' using errcode = '40001'; end if;
  end loop;
  perform 1 from heavy_equipment where id in (select equipment_id from heavy_equipment_loans where data->>'loanBatchId' = v_batch_id) order by id for update;
  update heavy_equipment_loans set status = case when v_status = 'APPROVED' then 'DIPINJAM' else 'REJECTED' end, data = data || jsonb_build_object('status', case when v_status = 'APPROVED' then 'DIPINJAM' else 'REJECTED' end, 'approvedBy', case when v_status = 'APPROVED' then auth.uid()::text else null end, 'approvedAt', case when v_status = 'APPROVED' then floor(extract(epoch from clock_timestamp()) * 1000)::bigint else null end, 'rejectReason', case when v_status = 'REJECTED' then p_catatan else null end, 'catatanApproval', p_catatan) where data->>'loanBatchId' = v_batch_id;
  select jsonb_agg(data || jsonb_build_object('id', id, 'ownerUptId', owner_upt_id, 'requesterUptId', requester_upt_id) order by id) into v_loans from heavy_equipment_loans where data->>'loanBatchId' = v_batch_id;
  if v_status = 'REJECTED' then update heavy_equipment e set data = e.data || jsonb_build_object('availabilityStatus','TERSEDIA','activeLoanId',null,'loanBatchId',null) where e.id in (select equipment_id from heavy_equipment_loans where data->>'loanBatchId' = v_batch_id); else update heavy_equipment e set data = e.data || jsonb_build_object('availabilityStatus','DIPINJAM') where e.id in (select equipment_id from heavy_equipment_loans where data->>'loanBatchId' = v_batch_id); end if;
  select jsonb_agg(data || jsonb_build_object('id', id, 'uptId', upt_id, 'isCrossUptBorrowable', is_cross_upt_borrowable) order by id) into v_assets from heavy_equipment where id in (select equipment_id from heavy_equipment_loans where data->>'loanBatchId' = v_batch_id);
  return jsonb_build_object('loans', coalesce(v_loans,'[]'::jsonb), 'equipment', coalesce(v_assets,'[]'::jsonb));
end $$;
revoke all on function public.approve_heavy_equipment_batch(text, text, text) from public;
grant execute on function public.approve_heavy_equipment_batch(text, text, text) to authenticated;

create or replace function public.complete_heavy_equipment_batch(p_loan_ids text[], p_return_evidence_path text, p_condition_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor profiles%rowtype;
  v_loan heavy_equipment_loans%rowtype;
  v_owner text;
  v_count integer := 0;
  v_loans jsonb;
  v_assets jsonb;
begin
  select * into v_actor from profiles where id = auth.uid();
  if not found or v_actor.role <> 'TL' then raise exception 'Hanya TL UPT pemilik alat yang boleh menandai pengembalian.' using errcode = '42501'; end if;
  if nullif(trim(p_return_evidence_path), '') is null or coalesce(array_length(p_loan_ids,1),0) = 0 then raise exception 'Loan dan bukti pengembalian wajib diisi.' using errcode = '23514'; end if;
  if array_length(p_loan_ids,1) <> (select count(distinct x) from unnest(p_loan_ids) x) then raise exception 'Daftar loan tidak valid.' using errcode = '23514'; end if;
  for v_loan in select * from heavy_equipment_loans where id = any(p_loan_ids) order by id for update loop
    v_count := v_count + 1;
    if v_loan.status not in ('DIPINJAM','APPROVED','OVERDUE') then raise exception 'Peminjaman sudah tidak aktif.' using errcode = 'P0001'; end if;
    v_owner := coalesce(v_owner, v_loan.owner_upt_id);
    if v_actor.upt_id <> v_loan.owner_upt_id or v_loan.owner_upt_id <> v_owner then raise exception 'Pengembalian harus dilakukan TL UPT pemilik alat.' using errcode = '42501'; end if;
  end loop;
  if v_count <> array_length(p_loan_ids,1) then raise exception 'Ada loan yang tidak ditemukan.' using errcode = 'P0002'; end if;
  if left(p_return_evidence_path, length(v_owner) + 1) <> v_owner || '/' then raise exception 'Path bukti tidak sesuai UPT pemilik.' using errcode = '42501'; end if;
  perform 1 from heavy_equipment where id in (select equipment_id from heavy_equipment_loans where id = any(p_loan_ids)) order by id for update;
  update heavy_equipment_loans set status='SELESAI', data=data || jsonb_build_object('status','SELESAI','returnEvidencePath',p_return_evidence_path,'conditionNote',p_condition_note,'returnedBy',auth.uid()::text,'returnedAt',floor(extract(epoch from clock_timestamp()) * 1000)::bigint) where id = any(p_loan_ids);
  update heavy_equipment e set data=e.data || jsonb_build_object('availabilityStatus','TERSEDIA','activeLoanId',null,'loanBatchId',null) where id in (select equipment_id from heavy_equipment_loans where id = any(p_loan_ids));
  select jsonb_agg(data || jsonb_build_object('id', id, 'ownerUptId', owner_upt_id, 'requesterUptId', requester_upt_id) order by id) into v_loans from heavy_equipment_loans where id = any(p_loan_ids);
  select jsonb_agg(data || jsonb_build_object('id', id, 'uptId', upt_id, 'isCrossUptBorrowable', is_cross_upt_borrowable) order by id) into v_assets from heavy_equipment where id in (select equipment_id from heavy_equipment_loans where id = any(p_loan_ids));
  return jsonb_build_object('loans', coalesce(v_loans,'[]'::jsonb), 'equipment', coalesce(v_assets,'[]'::jsonb));
end $$;
revoke all on function public.complete_heavy_equipment_batch(text[], text, text) from public;
grant execute on function public.complete_heavy_equipment_batch(text[], text, text) to authenticated;

-- Pengembalian baru wajib membawa bukti foto melalui RPC batch.
revoke execute on function public.complete_heavy_equipment_loan(text) from authenticated;

notify pgrst, 'reload schema';

-- Canonical quantity-pool parity with migration 20260920b_heavy_equipment_quantity_pools.sql.
-- Pool kuantitas alat bantu: saldo atomik, return parsial, dan history append-only.

alter table public.heavy_equipment
  add column if not exists tracking_mode text not null default 'UNIT',
  add column if not exists quantity_total integer not null default 1;
alter table public.heavy_equipment_loans
  add column if not exists quantity_borrowed integer not null default 1,
  add column if not exists quantity_returned_good integer not null default 0,
  add column if not exists quantity_returned_damaged integer not null default 0,
  add column if not exists quantity_returned_lost integer not null default 0;

update public.heavy_equipment
set tracking_mode = case when upper(coalesce(data->>'trackingMode', data->>'tracking_mode', tracking_mode)) = 'QUANTITY' then 'QUANTITY' else 'UNIT' end,
    quantity_total = case when (data->>'quantityTotal') ~ '^[0-9]+$' and (data->>'quantityTotal')::integer > 0 then (data->>'quantityTotal')::integer else greatest(1, quantity_total) end;
update public.heavy_equipment_loans
set quantity_borrowed = case when (data->>'quantityBorrowed') ~ '^[0-9]+$' and (data->>'quantityBorrowed')::integer > 0 then (data->>'quantityBorrowed')::integer else greatest(1, quantity_borrowed) end,
    quantity_returned_good = case when (data->>'quantityReturnedGood') ~ '^[0-9]+$' then greatest(0, (data->>'quantityReturnedGood')::integer) when status = 'SELESAI' then 1 else quantity_returned_good end,
    quantity_returned_damaged = case when (data->>'quantityReturnedDamaged') ~ '^[0-9]+$' then greatest(0, (data->>'quantityReturnedDamaged')::integer) else quantity_returned_damaged end,
    quantity_returned_lost = case when (data->>'quantityReturnedLost') ~ '^[0-9]+$' then greatest(0, (data->>'quantityReturnedLost')::integer) else quantity_returned_lost end;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'heavy_equipment_tracking_mode_check') then
    alter table public.heavy_equipment add constraint heavy_equipment_tracking_mode_check check (tracking_mode in ('UNIT', 'QUANTITY'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'heavy_equipment_quantity_total_check') then
    alter table public.heavy_equipment add constraint heavy_equipment_quantity_total_check check (quantity_total > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'heavy_equipment_unit_quantity_check') then
    alter table public.heavy_equipment add constraint heavy_equipment_unit_quantity_check check (tracking_mode = 'QUANTITY' or quantity_total = 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'heavy_equipment_loan_quantity_borrowed_check') then
    alter table public.heavy_equipment_loans add constraint heavy_equipment_loan_quantity_borrowed_check check (quantity_borrowed > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'heavy_equipment_loan_quantity_returned_good_check') then
    alter table public.heavy_equipment_loans add constraint heavy_equipment_loan_quantity_returned_good_check check (quantity_returned_good >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'heavy_equipment_loan_quantity_returned_damaged_check') then
    alter table public.heavy_equipment_loans add constraint heavy_equipment_loan_quantity_returned_damaged_check check (quantity_returned_damaged >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'heavy_equipment_loan_quantity_returned_lost_check') then
    alter table public.heavy_equipment_loans add constraint heavy_equipment_loan_quantity_returned_lost_check check (quantity_returned_lost >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'heavy_equipment_loan_quantity_returned_sum_check') then
    alter table public.heavy_equipment_loans add constraint heavy_equipment_loan_quantity_returned_sum_check check (quantity_returned_good + quantity_returned_damaged + quantity_returned_lost <= quantity_borrowed);
  end if;
end $$;

create or replace function public.lock_heavy_equipment_quantity_definition()
returns trigger language plpgsql as $$
begin
  if old.tracking_mode = 'UNIT' and new.tracking_mode = 'QUANTITY'
     and exists (select 1 from public.heavy_equipment_loans where equipment_id = old.id) then
    raise exception 'Aset dengan riwayat peminjaman tidak dapat dikonversi menjadi pool.' using errcode = '23514';
  end if;
  if old.tracking_mode = 'QUANTITY' and (new.tracking_mode is distinct from old.tracking_mode or new.quantity_total is distinct from old.quantity_total) then
    raise exception 'Mode dan total pool kuantitas tidak dapat diubah setelah dibuat.' using errcode = '23514';
  end if;
  if old.tracking_mode = 'UNIT' and new.tracking_mode = 'UNIT' and new.quantity_total is distinct from old.quantity_total then
    raise exception 'Total alat individual tidak dapat diubah.' using errcode = '23514';
  end if;
  if new.tracking_mode = 'UNIT' and new.quantity_total <> 1 then
    raise exception 'Alat individual wajib memiliki total 1.' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_lock_heavy_equipment_quantity_definition on public.heavy_equipment;
create trigger trg_lock_heavy_equipment_quantity_definition
before update on public.heavy_equipment
for each row execute function public.lock_heavy_equipment_quantity_definition();

create index if not exists idx_heavy_equipment_tracking_mode on public.heavy_equipment(tracking_mode);
create index if not exists idx_heavy_equipment_loans_quantity_equipment on public.heavy_equipment_loans(equipment_id, status);

-- Recompute only the typed quantity snapshot. UNIT keeps the existing binary state.
create or replace function public.refresh_heavy_equipment_quantity_state(p_equipment_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_equipment heavy_equipment%rowtype;
  v_reserved integer := 0;
  v_damaged integer := 0;
  v_lost integer := 0;
  v_available integer := 0;
begin
  select * into v_equipment from public.heavy_equipment where id = p_equipment_id for update;
  if not found then return; end if;
  if v_equipment.tracking_mode = 'QUANTITY' then
    select coalesce(sum(case when l.status in ('PENDING_OWNER_ASMAN','DIPINJAM','APPROVED','OVERDUE') then greatest(0, l.quantity_borrowed - l.quantity_returned_good - l.quantity_returned_damaged - l.quantity_returned_lost) else 0 end), 0),
           coalesce(sum(case when l.status <> 'REJECTED' then l.quantity_returned_damaged else 0 end), 0),
           coalesce(sum(case when l.status <> 'REJECTED' then l.quantity_returned_lost else 0 end), 0)
      into v_reserved, v_damaged, v_lost
      from public.heavy_equipment_loans l where l.equipment_id = p_equipment_id;
    v_available := greatest(0, v_equipment.quantity_total - v_reserved - v_damaged - v_lost);
    update public.heavy_equipment
       set data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
         'trackingMode', tracking_mode, 'quantityTotal', quantity_total,
         'quantityAvailable', v_available, 'quantityReserved', v_reserved,
         'quantityDamaged', v_damaged, 'quantityLost', v_lost,
         'availabilityStatus', case when v_available > 0 then 'TERSEDIA' else 'DIPINJAM' end)
     where id = p_equipment_id;
  else
    select count(*) into v_reserved
      from public.heavy_equipment_loans l
     where l.equipment_id = p_equipment_id
       and l.status in ('PENDING_OWNER_ASMAN','DIPINJAM','APPROVED','OVERDUE');
    update public.heavy_equipment
       set data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
         'trackingMode', 'UNIT', 'quantityTotal', 1,
         'availabilityStatus', case when v_reserved > 0 then 'DIPINJAM' else 'TERSEDIA' end)
     where id = p_equipment_id;
  end if;
end $$;
revoke all on function public.refresh_heavy_equipment_quantity_state(text) from public;

-- Return evidence may be nested in append-only loan.data.returnEvents.
drop policy if exists "Heavy equipment evidence read" on storage.objects;
create policy "Heavy equipment evidence read" on storage.objects
  for select to authenticated using (
    bucket_id = 'heavy-equipment-evidence'
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and (
      actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT')
      or actor.upt_id = (storage.foldername(name))[1]
      or exists (select 1 from public.heavy_equipment_loans l where (
        l.data->>'pickupEvidencePath' = name
        or l.data->>'returnEvidencePath' = name
        or exists (select 1 from jsonb_array_elements(coalesce(l.data->'returnEvents', '[]'::jsonb)) event where event->>'evidencePath' = name)
      ) and actor.upt_id = l.requester_upt_id)
    ))
  );

-- Referenced evidence is immutable. Orphan uploads remain deletable so a failed
-- upload/RPC transaction can clean up its object.
drop policy if exists "Heavy equipment evidence update" on storage.objects;
drop policy if exists "Heavy equipment evidence delete" on storage.objects;
create policy "Heavy equipment evidence update" on storage.objects
  for update to authenticated using (
    bucket_id = 'heavy-equipment-evidence'
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = (storage.foldername(name))[1])
    and not exists (select 1 from public.heavy_equipment_loans l where (
      l.data->>'pickupEvidencePath' = name
      or l.data->>'returnEvidencePath' = name
      or exists (select 1 from jsonb_array_elements(coalesce(l.data->'returnEvents', '[]'::jsonb)) event where event->>'evidencePath' = name)
    ))
  ) with check (
    bucket_id = 'heavy-equipment-evidence'
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = (storage.foldername(name))[1])
  );
create policy "Heavy equipment evidence delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'heavy-equipment-evidence'
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = (storage.foldername(name))[1])
    and not exists (select 1 from public.heavy_equipment_loans l where (
      l.data->>'pickupEvidencePath' = name
      or l.data->>'returnEvidencePath' = name
      or exists (select 1 from jsonb_array_elements(coalesce(l.data->'returnEvents', '[]'::jsonb)) event where event->>'evidencePath' = name)
    ))
  );

create or replace function public.checkout_heavy_equipment_batch_v2(
  p_items jsonb, p_borrower jsonb, p_job jsonb, p_pickup_evidence_path text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor profiles%rowtype;
  v_equipment heavy_equipment%rowtype;
  v_item jsonb;
  v_owner_id text;
  v_requester_id text := nullif(trim(coalesce(p_borrower->>'borrowerRefId', '')), '');
  v_type text := upper(coalesce(p_borrower->>'borrowerType', 'UPT'));
  v_batch_id text := coalesce(nullif(trim(p_job->>'batchId'), ''), 'HE-BATCH-' || replace(gen_random_uuid()::text, '-', ''));
  v_status text := case when v_type = 'UPT' then 'PENDING_OWNER_ASMAN' else 'DIPINJAM' end;
  v_count integer := 0;
  v_quantity integer;
  v_available integer;
  v_loans jsonb := '[]'::jsonb;
  v_assets jsonb := '[]'::jsonb;
  v_loan_id text;
  v_row jsonb;
begin
  select * into v_actor from profiles where id = auth.uid();
  if not found or v_actor.role <> 'TL' then raise exception 'Hanya TL UPT pemilik alat yang boleh mencatat peminjaman.' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or nullif(trim(p_pickup_evidence_path), '') is null then raise exception 'Alat, jumlah, dan bukti serah-terima wajib diisi.' using errcode = '23514'; end if;
  if (select count(*) from jsonb_array_elements(p_items) x) <> (select count(distinct x.value->>'equipmentId') from jsonb_array_elements(p_items) x) then raise exception 'Daftar alat tidak boleh duplikat.' using errcode = '23514'; end if;
  if v_type not in ('UPT','ULTG','GI','VENDOR','UNIT_LAIN') then raise exception 'Jenis peminjam tidak valid.' using errcode = '22023'; end if;
  if nullif(trim(p_job->>'namaPekerjaan'), '') is null or nullif(trim(p_job->>'tanggalAmbil'), '') is null or nullif(trim(p_job->>'tanggalKembali'), '') is null or nullif(trim(p_job->>'keperluan'), '') is null then raise exception 'Pekerjaan, tanggal, dan keperluan wajib diisi.' using errcode = '23514'; end if;
  if (p_job->>'tanggalKembali')::date < (p_job->>'tanggalAmbil')::date then raise exception 'Tanggal kembali tidak boleh sebelum tanggal ambil.' using errcode = '22007'; end if;
  v_owner_id := (select e.upt_id from public.heavy_equipment e where e.id = p_items->0->>'equipmentId');
  if v_owner_id is null or v_actor.upt_id <> v_owner_id then raise exception 'Actor bukan TL UPT pemilik alat.' using errcode = '42501'; end if;
  if left(p_pickup_evidence_path, length(v_owner_id) + 1) <> v_owner_id || '/' then raise exception 'Path bukti tidak sesuai UPT pemilik.' using errcode = '42501'; end if;
  for v_equipment in
    select e.* from public.heavy_equipment e
    where e.id in (select x.value->>'equipmentId' from jsonb_array_elements(p_items) x)
    order by e.id for update
  loop
    v_count := v_count + 1;
    v_quantity := (select nullif(trim(x.value->>'quantity'), '')::integer from jsonb_array_elements(p_items) x where x.value->>'equipmentId' = v_equipment.id);
    if v_equipment.upt_id <> v_owner_id or v_quantity is null or v_quantity < 1 then raise exception 'Alat dan jumlah tidak valid.' using errcode = '23514'; end if;
    if v_equipment.tracking_mode = 'UNIT' and v_quantity <> 1 then raise exception 'Alat individual hanya dapat dipinjam dengan jumlah 1.' using errcode = '23514'; end if;
    if v_equipment.tracking_mode = 'QUANTITY' then
      select greatest(0, v_equipment.quantity_total - coalesce(sum(case when l.status in ('PENDING_OWNER_ASMAN','DIPINJAM','APPROVED','OVERDUE') then greatest(0, l.quantity_borrowed - l.quantity_returned_good - l.quantity_returned_damaged - l.quantity_returned_lost) else 0 end), 0) - coalesce(sum(case when l.status <> 'REJECTED' then l.quantity_returned_damaged else 0 end), 0) - coalesce(sum(case when l.status <> 'REJECTED' then l.quantity_returned_lost else 0 end), 0))
        into v_available from public.heavy_equipment_loans l where l.equipment_id = v_equipment.id;
      if v_quantity > v_available then raise exception 'Saldo alat bantu tidak mencukupi.' using errcode = '40001'; end if;
    else
      if v_equipment.data->>'availabilityStatus' = 'DIPINJAM' or exists (select 1 from public.heavy_equipment_loans l where l.equipment_id = v_equipment.id and l.status in ('PENDING_OWNER_ASMAN','DIPINJAM','APPROVED','OVERDUE')) then raise exception 'Alat memiliki peminjaman aktif.' using errcode = '40001'; end if;
    end if;
    if v_equipment.data->>'statusAlat' in ('MAINTENANCE','KIR') then raise exception 'Alat tidak layak dipinjam.' using errcode = '40001'; end if;
    if v_type = 'UPT' and not v_equipment.is_cross_upt_borrowable then raise exception 'Alat belum diizinkan untuk peminjaman lintas-UPT.' using errcode = '42501'; end if;
  end loop;
  if v_count <> (select count(*) from jsonb_array_elements(p_items)) then raise exception 'Daftar alat tidak valid.' using errcode = 'P0002'; end if;
  if v_type = 'UPT' and (v_requester_id is null or v_requester_id = v_owner_id) then raise exception 'UPT peminjam tidak valid.' using errcode = '23514'; end if;
  if v_type <> 'UPT' and (nullif(trim(p_borrower->>'borrowerName'), '') is null or nullif(trim(p_borrower->>'borrowerPic'), '') is null or nullif(trim(p_borrower->>'borrowerContact'), '') is null) then raise exception 'Nama organisasi, PIC, dan kontak wajib diisi.' using errcode = '23514'; end if;
  for v_item in select value from jsonb_array_elements(p_items) order by value->>'equipmentId' loop
    select * into v_equipment from public.heavy_equipment where id = v_item->>'equipmentId' for update;
    v_quantity := (v_item->>'quantity')::integer;
    v_loan_id := 'HLOAN-' || replace(gen_random_uuid()::text, '-', '');
    insert into public.heavy_equipment_loans (id, data, created_at, equipment_id, status, owner_upt, requester_upt, owner_upt_id, requester_upt_id, quantity_borrowed, quantity_returned_good, quantity_returned_damaged, quantity_returned_lost)
    values (v_loan_id, jsonb_build_object(
      'id', v_loan_id, 'equipmentId', v_equipment.id, 'loanBatchId', v_batch_id, 'ownerUptId', v_owner_id, 'requesterUptId', v_requester_id,
      'ownerUpt', v_equipment.upt, 'requesterUpt', coalesce((select u.data->>'nama' from public.upt u where u.id = v_requester_id), p_borrower->>'borrowerName'),
      'borrowerType', v_type, 'borrowerName', p_borrower->>'borrowerName', 'borrowerPic', p_borrower->>'borrowerPic', 'borrowerContact', p_borrower->>'borrowerContact',
      'namaPekerjaan', p_job->>'namaPekerjaan', 'tanggalAmbil', p_job->>'tanggalAmbil', 'tanggalKembali', p_job->>'tanggalKembali', 'keperluan', p_job->>'keperluan', 'catatan', p_job->>'catatan',
      'quantityBorrowed', v_quantity, 'quantityReturnedGood', 0, 'quantityReturnedDamaged', 0, 'quantityReturnedLost', 0, 'returnEvents', '[]'::jsonb,
      'pickupEvidencePath', p_pickup_evidence_path, 'requestedBy', auth.uid()::text, 'requestedAt', floor(extract(epoch from clock_timestamp()) * 1000)::bigint, 'status', v_status
    ), floor(extract(epoch from clock_timestamp()) * 1000)::bigint, v_equipment.id, v_status, v_equipment.upt, coalesce((select u.data->>'nama' from public.upt u where u.id = v_requester_id), p_borrower->>'borrowerName'), v_owner_id, v_requester_id, v_quantity, 0, 0, 0);
    perform public.refresh_heavy_equipment_quantity_state(v_equipment.id);
    select data || jsonb_build_object('id', id, 'ownerUptId', owner_upt_id, 'requesterUptId', requester_upt_id, 'quantityBorrowed', quantity_borrowed, 'quantityReturnedGood', quantity_returned_good, 'quantityReturnedDamaged', quantity_returned_damaged, 'quantityReturnedLost', quantity_returned_lost) into v_row from public.heavy_equipment_loans where id = v_loan_id;
    v_loans := v_loans || jsonb_build_array(v_row);
    select data || jsonb_build_object('id', id, 'uptId', upt_id, 'isCrossUptBorrowable', is_cross_upt_borrowable, 'trackingMode', tracking_mode, 'quantityTotal', quantity_total) into v_row from public.heavy_equipment where id = v_equipment.id;
    v_assets := v_assets || jsonb_build_array(v_row);
  end loop;
  return jsonb_build_object('batchId', v_batch_id, 'loans', v_loans, 'equipment', v_assets);
end $$;
revoke all on function public.checkout_heavy_equipment_batch_v2(jsonb, jsonb, jsonb, text) from public;
grant execute on function public.checkout_heavy_equipment_batch_v2(jsonb, jsonb, jsonb, text) to authenticated;

create or replace function public.approve_heavy_equipment_batch(p_loan_id text, p_decision text default 'APPROVED', p_catatan text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor profiles%rowtype;
  v_loan heavy_equipment_loans%rowtype;
  v_batch_loan heavy_equipment_loans%rowtype;
  v_status text := upper(coalesce(p_decision, 'APPROVED'));
  v_batch_id text;
  v_loans jsonb;
  v_assets jsonb;
  v_equipment_id text;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if not found or v_actor.role <> 'ASMAN' then raise exception 'Hanya Asman UPT pemilik alat yang boleh memutuskan.' using errcode = '42501'; end if;
  select * into v_loan from public.heavy_equipment_loans where id = p_loan_id for update;
  if not found or v_loan.status <> 'PENDING_OWNER_ASMAN' then raise exception 'Peminjaman tidak menunggu approval.' using errcode = 'P0001'; end if;
  if v_actor.upt_id <> v_loan.owner_upt_id then raise exception 'Hanya Asman UPT pemilik alat yang boleh memutuskan.' using errcode = '42501'; end if;
  if v_status not in ('APPROVED','REJECTED') then raise exception 'Keputusan approval tidak valid.' using errcode = '22023'; end if;
  v_batch_id := nullif(v_loan.data->>'loanBatchId', '');
  if v_batch_id is null then raise exception 'Batch peminjaman tidak valid.' using errcode = '23514'; end if;
  for v_batch_loan in select * from public.heavy_equipment_loans where data->>'loanBatchId' = v_batch_id order by id for update loop
    if v_batch_loan.status <> 'PENDING_OWNER_ASMAN' or v_batch_loan.owner_upt_id <> v_loan.owner_upt_id then raise exception 'Status atau UPT dalam batch tidak konsisten.' using errcode = '40001'; end if;
  end loop;
  update public.heavy_equipment_loans set status = case when v_status = 'APPROVED' then 'DIPINJAM' else 'REJECTED' end, data = data || jsonb_build_object('status', case when v_status = 'APPROVED' then 'DIPINJAM' else 'REJECTED' end, 'approvedBy', case when v_status = 'APPROVED' then auth.uid()::text else null end, 'approvedAt', case when v_status = 'APPROVED' then floor(extract(epoch from clock_timestamp()) * 1000)::bigint else null end, 'rejectReason', case when v_status = 'REJECTED' then p_catatan else null end, 'catatanApproval', p_catatan) where data->>'loanBatchId' = v_batch_id;
  for v_equipment_id in select distinct equipment_id from public.heavy_equipment_loans where data->>'loanBatchId' = v_batch_id order by equipment_id loop perform public.refresh_heavy_equipment_quantity_state(v_equipment_id); end loop;
  select jsonb_agg(data || jsonb_build_object('id', id, 'ownerUptId', owner_upt_id, 'requesterUptId', requester_upt_id, 'quantityBorrowed', quantity_borrowed, 'quantityReturnedGood', quantity_returned_good, 'quantityReturnedDamaged', quantity_returned_damaged, 'quantityReturnedLost', quantity_returned_lost) order by id) into v_loans from public.heavy_equipment_loans where data->>'loanBatchId' = v_batch_id;
  select jsonb_agg(data || jsonb_build_object('id', id, 'uptId', upt_id, 'isCrossUptBorrowable', is_cross_upt_borrowable, 'trackingMode', tracking_mode, 'quantityTotal', quantity_total) order by id) into v_assets from public.heavy_equipment where id in (select equipment_id from public.heavy_equipment_loans where data->>'loanBatchId' = v_batch_id);
  return jsonb_build_object('loans', coalesce(v_loans,'[]'::jsonb), 'equipment', coalesce(v_assets,'[]'::jsonb));
end $$;

create or replace function public.complete_heavy_equipment_quantity_loan(
  p_loan_id text, p_good integer, p_damaged integer, p_lost integer, p_return_evidence_path text, p_condition_note text default ''
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor profiles%rowtype;
  v_loan heavy_equipment_loans%rowtype;
  v_equipment heavy_equipment%rowtype;
  v_owner text;
  v_remaining integer;
  v_new_remaining integer;
  v_occurred_at bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_event jsonb;
  v_loan_json jsonb;
  v_equipment_json jsonb;
  v_balance jsonb;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if not found or v_actor.role <> 'TL' then raise exception 'Hanya TL UPT pemilik alat yang boleh menandai pengembalian.' using errcode = '42501'; end if;
  select * into v_loan from public.heavy_equipment_loans where id = p_loan_id for update;
  if not found then raise exception 'Peminjaman alat tidak ditemukan.' using errcode = 'P0002'; end if;
  if v_loan.status not in ('DIPINJAM','APPROVED','OVERDUE') then raise exception 'Peminjaman alat sudah tidak aktif.' using errcode = 'P0001'; end if;
  select * into v_equipment from public.heavy_equipment where id = v_loan.equipment_id for update;
  if not found or v_equipment.tracking_mode <> 'QUANTITY' then raise exception 'Loan bukan pool kuantitas.' using errcode = '23514'; end if;
  v_owner := v_loan.owner_upt_id;
  if v_actor.upt_id <> v_owner then raise exception 'Pengembalian harus dilakukan TL UPT pemilik alat.' using errcode = '42501'; end if;
  if nullif(trim(p_return_evidence_path), '') is null or left(p_return_evidence_path, length(v_owner) + 1) <> v_owner || '/' then raise exception 'Bukti pengembalian wajib berada pada folder UPT pemilik.' using errcode = '42501'; end if;
  if coalesce(p_good, 0) < 0 or coalesce(p_damaged, 0) < 0 or coalesce(p_lost, 0) < 0 then raise exception 'Jumlah pengembalian tidak valid.' using errcode = '23514'; end if;
  v_remaining := greatest(0, v_loan.quantity_borrowed - v_loan.quantity_returned_good - v_loan.quantity_returned_damaged - v_loan.quantity_returned_lost);
  if coalesce(p_good, 0) + coalesce(p_damaged, 0) + coalesce(p_lost, 0) < 1 or coalesce(p_good, 0) + coalesce(p_damaged, 0) + coalesce(p_lost, 0) > v_remaining then raise exception 'Jumlah pengembalian melebihi sisa pinjaman.' using errcode = '40001'; end if;
  if (coalesce(p_damaged, 0) + coalesce(p_lost, 0)) > 0 and nullif(trim(coalesce(p_condition_note, '')), '') is null then raise exception 'Catatan kondisi wajib untuk barang rusak atau hilang.' using errcode = '23514'; end if;
  v_new_remaining := v_remaining - coalesce(p_good, 0) - coalesce(p_damaged, 0) - coalesce(p_lost, 0);
  v_event := jsonb_build_object('id', 'HRETURN-' || replace(gen_random_uuid()::text, '-', ''), 'good', coalesce(p_good, 0), 'damaged', coalesce(p_damaged, 0), 'lost', coalesce(p_lost, 0), 'remainingAfter', v_new_remaining, 'evidencePath', p_return_evidence_path, 'conditionNote', coalesce(p_condition_note, ''), 'actorId', auth.uid()::text, 'occurredAt', v_occurred_at);
  update public.heavy_equipment_loans
     set quantity_returned_good = quantity_returned_good + coalesce(p_good, 0), quantity_returned_damaged = quantity_returned_damaged + coalesce(p_damaged, 0), quantity_returned_lost = quantity_returned_lost + coalesce(p_lost, 0),
         status = case when v_new_remaining = 0 then 'SELESAI' else status end,
         data = data || jsonb_build_object('quantityReturnedGood', quantity_returned_good + coalesce(p_good, 0), 'quantityReturnedDamaged', quantity_returned_damaged + coalesce(p_damaged, 0), 'quantityReturnedLost', quantity_returned_lost + coalesce(p_lost, 0), 'returnEvents', coalesce(data->'returnEvents', '[]'::jsonb) || jsonb_build_array(v_event), 'status', case when v_new_remaining = 0 then 'SELESAI' else status end)
   where id = p_loan_id;
  perform public.refresh_heavy_equipment_quantity_state(v_equipment.id);
  select data || jsonb_build_object('id', id, 'ownerUptId', owner_upt_id, 'requesterUptId', requester_upt_id, 'quantityBorrowed', quantity_borrowed, 'quantityReturnedGood', quantity_returned_good, 'quantityReturnedDamaged', quantity_returned_damaged, 'quantityReturnedLost', quantity_returned_lost) into v_loan_json from public.heavy_equipment_loans where id = p_loan_id;
  select data || jsonb_build_object('id', id, 'uptId', upt_id, 'isCrossUptBorrowable', is_cross_upt_borrowable, 'trackingMode', tracking_mode, 'quantityTotal', quantity_total) into v_equipment_json from public.heavy_equipment where id = v_equipment.id;
  v_balance := jsonb_build_object('total', v_equipment.quantity_total, 'available', (v_equipment_json->>'quantityAvailable')::integer, 'reserved', (v_equipment_json->>'quantityReserved')::integer, 'damaged', (v_equipment_json->>'quantityDamaged')::integer, 'lost', (v_equipment_json->>'quantityLost')::integer);
  return jsonb_build_object('loan', v_loan_json, 'equipment', v_equipment_json, 'balance', v_balance);
end $$;
revoke all on function public.complete_heavy_equipment_quantity_loan(text, integer, integer, integer, text, text) from public;
grant execute on function public.complete_heavy_equipment_quantity_loan(text, integer, integer, integer, text, text) to authenticated;

notify pgrst, 'reload schema';

-- Final HAR_UIT policy parity must remain after the legacy heavy-equipment
-- snapshot blocks above. Checkout RPC bodies are supplied by the 20260921
-- migration so fresh and upgraded self-host installations use one contract.
drop policy if exists "Heavy equipment scoped read" on public.heavy_equipment;
create policy "Heavy equipment scoped read" on public.heavy_equipment
  for select to authenticated using (
    exists (select 1 from public.profiles actor where actor.id = auth.uid() and (
      actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT')
      or actor.upt_id = heavy_equipment.upt_id
      or (heavy_equipment.is_cross_upt_borrowable and actor.upt_id is not null)
      or (actor.role = 'HAR_UIT' and actor.uit_id is not null and exists (
        select 1 from public.upt owner_upt where owner_upt.id = heavy_equipment.upt_id and owner_upt.uit_id = actor.uit_id
      ))
    ))
  );
drop policy if exists "Heavy equipment loan scoped read" on public.heavy_equipment_loans;
create policy "Heavy equipment loan scoped read" on public.heavy_equipment_loans
  for select to authenticated using (
    exists (select 1 from public.profiles actor where actor.id = auth.uid() and (
      actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT')
      or actor.upt_id = owner_upt_id
      or actor.upt_id = requester_upt_id
      or (actor.role = 'HAR_UIT' and actor.uit_id is not null and (
        requester_uit_id = actor.uit_id
        or exists (select 1 from public.upt owner_upt where owner_upt.id = owner_upt_id and owner_upt.uit_id = actor.uit_id)
        or exists (select 1 from public.upt requester_upt where requester_upt.id = requester_upt_id and requester_upt.uit_id = actor.uit_id)
      ))
    ))
  );
notify pgrst, 'reload schema';
-- HAR_UIT direct borrower for heavy equipment.
-- Proposal only. Apply to self-host after explicit approval and backup.

alter table public.heavy_equipment_loans
  add column if not exists requester_uit_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'heavy_equipment_loans_requester_uit_id_fkey') then
    alter table public.heavy_equipment_loans
      add constraint heavy_equipment_loans_requester_uit_id_fkey
      foreign key (requester_uit_id) references public.uit(id);
  end if;
end $$;

create index if not exists idx_heavy_equipment_loans_requester_uit_id
  on public.heavy_equipment_loans(requester_uit_id);

-- HAR_UIT sees canonical registry rows for UPTs in its UIT. Existing UPT
-- cross-borrow visibility remains unchanged.
drop policy if exists "Heavy equipment scoped read" on public.heavy_equipment;
create policy "Heavy equipment scoped read" on public.heavy_equipment
  for select to authenticated using (
    exists (
      select 1 from public.profiles actor
      where actor.id = auth.uid()
        and (
          actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT')
          or actor.upt_id = heavy_equipment.upt_id
          or (heavy_equipment.is_cross_upt_borrowable and actor.upt_id is not null)
          or (
            actor.role = 'HAR_UIT'
            and actor.uit_id is not null
            and exists (select 1 from public.upt owner_upt where owner_upt.id = heavy_equipment.upt_id and owner_upt.uit_id = actor.uit_id)
          )
        )
    )
  );

drop policy if exists "Heavy equipment loan scoped read" on public.heavy_equipment_loans;
create policy "Heavy equipment loan scoped read" on public.heavy_equipment_loans
  for select to authenticated using (
    exists (
      select 1 from public.profiles actor
      where actor.id = auth.uid()
        and (
          actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT')
          or actor.upt_id = owner_upt_id
          or actor.upt_id = requester_upt_id
          or (
            actor.role = 'HAR_UIT'
            and actor.uit_id is not null
            and (
              requester_uit_id = actor.uit_id
              or exists (select 1 from public.upt scoped_upt where scoped_upt.id = owner_upt_id and scoped_upt.uit_id = actor.uit_id)
              or exists (select 1 from public.upt scoped_upt where scoped_upt.id = requester_upt_id and scoped_upt.uit_id = actor.uit_id)
            )
          )
        )
    )
  );

drop policy if exists "Heavy equipment evidence read" on storage.objects;
drop policy if exists "Heavy equipment evidence insert" on storage.objects;
drop policy if exists "Heavy equipment evidence update" on storage.objects;
drop policy if exists "Heavy equipment evidence delete" on storage.objects;
create policy "Heavy equipment evidence read" on storage.objects
  for select to authenticated using (
    bucket_id = 'heavy-equipment-evidence'
    and exists (
      select 1 from public.profiles actor
      where actor.id = auth.uid()
        and (
          actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT')
          or actor.upt_id = (storage.foldername(name))[1]
          or exists (
            select 1 from public.heavy_equipment_loans l
            where (
              l.data->>'pickupEvidencePath' = name
              or l.data->>'returnEvidencePath' = name
              or exists (select 1 from jsonb_array_elements(coalesce(l.data->'returnEvents', '[]'::jsonb)) event where event->>'evidencePath' = name)
            )
            and (
              actor.upt_id = l.requester_upt_id
              or (actor.role = 'HAR_UIT' and actor.uit_id = l.requester_uit_id)
              or (actor.role = 'HAR_UIT' and exists (select 1 from public.upt scoped_upt where scoped_upt.id = l.owner_upt_id and scoped_upt.uit_id = actor.uit_id))
            )
          )
        )
    )
  );
create policy "Heavy equipment evidence insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'heavy-equipment-evidence'
    and exists (
      select 1 from public.profiles actor
      where actor.id = auth.uid()
        and (
          (actor.role = 'TL' and actor.upt_id = (storage.foldername(name))[1])
          or (
            actor.role = 'HAR_UIT'
            and actor.uit_id is not null
            and exists (select 1 from public.upt scoped_upt where scoped_upt.id = (storage.foldername(name))[1] and scoped_upt.uit_id = actor.uit_id)
          )
        )
    )
  );
-- Referenced evidence is immutable. Only orphan cleanup is allowed.
create policy "Heavy equipment evidence update" on storage.objects
  for update to authenticated using (
    bucket_id = 'heavy-equipment-evidence'
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = (storage.foldername(name))[1])
    and not exists (select 1 from public.heavy_equipment_loans l where l.data->>'pickupEvidencePath' = name or l.data->>'returnEvidencePath' = name or exists (select 1 from jsonb_array_elements(coalesce(l.data->'returnEvents', '[]'::jsonb)) event where event->>'evidencePath' = name))
  ) with check (
    bucket_id = 'heavy-equipment-evidence'
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role = 'TL' and actor.upt_id = (storage.foldername(name))[1])
  );
create policy "Heavy equipment evidence delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'heavy-equipment-evidence'
    and owner_id = auth.uid()::text
    and not exists (select 1 from public.heavy_equipment_loans l where l.data->>'pickupEvidencePath' = name or l.data->>'returnEvidencePath' = name or exists (select 1 from jsonb_array_elements(coalesce(l.data->'returnEvents', '[]'::jsonb)) event where event->>'evidencePath' = name))
    and exists (
      select 1 from public.profiles actor
      where actor.id = auth.uid()
        and (
          (actor.role = 'TL' and actor.upt_id = (storage.foldername(name))[1])
          or (
            actor.role = 'HAR_UIT'
            and actor.uit_id is not null
            and exists (select 1 from public.upt scoped_upt where scoped_upt.id = (storage.foldername(name))[1] and scoped_upt.uit_id = actor.uit_id)
          )
        )
    )
  );

-- Keep the established RPC signatures. TL validation stays the same; HAR_UIT
-- is a separate server-derived branch and cannot spoof it.
create or replace function public.checkout_heavy_equipment_batch(
  p_equipment_ids text[], p_borrower jsonb, p_job jsonb, p_pickup_evidence_path text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor profiles%rowtype;
  v_equipment heavy_equipment%rowtype;
  v_owner_id text;
  v_requester_id text := nullif(trim(coalesce(p_borrower->>'borrowerRefId', '')), '');
  v_requester_uit_id text;
  v_type text := upper(coalesce(p_borrower->>'borrowerType', 'UPT'));
  v_batch_id text := coalesce(nullif(trim(p_job->>'batchId'), ''), 'HE-BATCH-' || replace(gen_random_uuid()::text, '-', ''));
  v_status text := case when v_type in ('UPT','HAR_UIT') then 'PENDING_OWNER_ASMAN' else 'DIPINJAM' end;
  v_count integer := 0;
  v_loans jsonb := '[]'::jsonb;
  v_assets jsonb := '[]'::jsonb;
  v_loan_id text;
  v_row jsonb;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if not found or (v_actor.role <> 'TL' and v_actor.role <> 'HAR_UIT') then raise exception 'Hanya TL UPT pemilik atau HAR UIT yang boleh mencatat peminjaman.' using errcode = '42501'; end if;
  if coalesce(array_length(p_equipment_ids, 1), 0) = 0 or nullif(trim(p_pickup_evidence_path), '') is null then raise exception 'Alat dan bukti serah-terima wajib diisi.' using errcode = '23514'; end if;
  if v_type not in ('UPT','ULTG','GI','VENDOR','UNIT_LAIN','HAR_UIT') then raise exception 'Jenis peminjam tidak valid.' using errcode = '22023'; end if;
  if v_actor.role = 'HAR_UIT' and v_type <> 'HAR_UIT' then raise exception 'Akun HAR UIT hanya dapat mengajukan sebagai HAR_UIT.' using errcode = '42501'; end if;
  if v_actor.role = 'TL' and v_type = 'HAR_UIT' then raise exception 'TL tidak dapat mengajukan sebagai HAR_UIT.' using errcode = '42501'; end if;
  if v_type = 'HAR_UIT' and v_actor.role <> 'HAR_UIT' then raise exception 'Hanya akun HAR UIT yang dapat membuat peminjaman HAR_UIT.' using errcode = '42501'; end if;
  if v_type = 'HAR_UIT' and (v_actor.uit_id is null or nullif(trim(p_borrower->>'borrowerUitId'), '') <> v_actor.uit_id) then raise exception 'UIT peminjam tidak valid.' using errcode = '42501'; end if;
  if nullif(trim(p_job->>'namaPekerjaan'), '') is null or nullif(trim(p_job->>'tanggalAmbil'), '') is null or nullif(trim(p_job->>'tanggalKembali'), '') is null or nullif(trim(p_job->>'keperluan'), '') is null then raise exception 'Pekerjaan, tanggal, dan keperluan wajib diisi.' using errcode = '23514'; end if;
  if (p_job->>'tanggalKembali')::date < (p_job->>'tanggalAmbil')::date then raise exception 'Tanggal kembali tidak boleh sebelum tanggal ambil.' using errcode = '22007'; end if;
  select e.upt_id into v_owner_id from public.heavy_equipment e where e.id = p_equipment_ids[1];
  if v_owner_id is null then raise exception 'Alat tidak ditemukan.' using errcode = 'P0002'; end if;
  if v_actor.role = 'TL' and v_actor.upt_id <> v_owner_id then raise exception 'Actor bukan TL UPT pemilik alat.' using errcode = '42501'; end if;
  if v_actor.role = 'HAR_UIT' and not exists (select 1 from public.upt owner_upt where owner_upt.id = v_owner_id and owner_upt.uit_id = v_actor.uit_id) then raise exception 'UPT pemilik berada di luar UIT akun.' using errcode = '42501'; end if;
  if left(p_pickup_evidence_path, length(v_owner_id) + 1) <> v_owner_id || '/' then raise exception 'Path bukti tidak sesuai UPT pemilik.' using errcode = '42501'; end if;
  if (select count(*) from public.heavy_equipment where id = any(p_equipment_ids)) <> (select count(distinct x) from unnest(p_equipment_ids) x) then raise exception 'Daftar alat tidak valid.' using errcode = 'P0002'; end if;
  for v_equipment in select * from public.heavy_equipment where id = any(p_equipment_ids) order by id for update loop
    v_count := v_count + 1;
    if v_equipment.upt_id <> v_owner_id or v_equipment.data->>'availabilityStatus' = 'DIPINJAM' or v_equipment.data->>'statusAlat' in ('MAINTENANCE','KIR') then raise exception 'Semua alat harus tersedia dan milik satu UPT.' using errcode = '40001'; end if;
    if v_type in ('UPT','HAR_UIT') and not v_equipment.is_cross_upt_borrowable then raise exception 'Ada alat yang belum diizinkan untuk peminjaman lintas-UPT.' using errcode = '42501'; end if;
    if exists (select 1 from public.heavy_equipment_loans l where l.equipment_id = v_equipment.id and l.status in ('PENDING_OWNER_ASMAN','DIPINJAM','APPROVED','OVERDUE')) then raise exception 'Alat memiliki peminjaman aktif.' using errcode = '40001'; end if;
  end loop;
  if v_count <> array_length(p_equipment_ids, 1) then raise exception 'Daftar alat tidak valid.' using errcode = 'P0002'; end if;
  if v_type = 'UPT' and (v_requester_id is null or v_requester_id = v_owner_id) then raise exception 'UPT peminjam tidak valid.' using errcode = '23514'; end if;
  if v_type = 'HAR_UIT' and (v_requester_id is not null or v_actor.uit_id is null) then raise exception 'Requester UPT HAR_UIT tidak valid.' using errcode = '23514'; end if;
  if v_type = 'HAR_UIT' and (nullif(trim(p_borrower->>'borrowerPic'), '') is null or nullif(trim(p_borrower->>'borrowerContact'), '') is null) then raise exception 'PIC dan kontak HAR_UIT wajib diisi.' using errcode = '23514'; end if;
  if v_type not in ('UPT','HAR_UIT') and (nullif(trim(p_borrower->>'borrowerName'), '') is null or nullif(trim(p_borrower->>'borrowerPic'), '') is null or nullif(trim(p_borrower->>'borrowerContact'), '') is null) then raise exception 'Nama organisasi, PIC, dan kontak wajib diisi.' using errcode = '23514'; end if;
  v_requester_uit_id := case when v_type = 'HAR_UIT' then v_actor.uit_id else null end;
  for v_equipment in select * from public.heavy_equipment where id = any(p_equipment_ids) order by id loop
    v_loan_id := 'HLOAN-' || replace(gen_random_uuid()::text, '-', '');
    insert into public.heavy_equipment_loans (id, data, created_at, equipment_id, status, owner_upt, requester_upt, owner_upt_id, requester_upt_id, requester_uit_id)
    values (v_loan_id, jsonb_build_object(
      'id', v_loan_id, 'equipmentId', v_equipment.id, 'loanBatchId', v_batch_id, 'ownerUptId', v_owner_id, 'requesterUptId', v_requester_id, 'requesterUitId', v_requester_uit_id,
      'ownerUpt', v_equipment.upt, 'requesterUpt', case when v_type = 'HAR_UIT' then 'HAR UIT ' || coalesce((select u.data->>'nama' from public.uit u where u.id = v_requester_uit_id), v_requester_uit_id) else coalesce((select u.data->>'nama' from public.upt u where u.id = v_requester_id), p_borrower->>'borrowerName') end,
      'borrowerType', v_type, 'borrowerName', case when v_type = 'HAR_UIT' then 'HAR UIT ' || coalesce((select u.data->>'nama' from public.uit u where u.id = v_requester_uit_id), v_requester_uit_id) else p_borrower->>'borrowerName' end, 'borrowerUitId', v_requester_uit_id, 'borrowerPic', p_borrower->>'borrowerPic', 'borrowerContact', p_borrower->>'borrowerContact',
      'namaPekerjaan', p_job->>'namaPekerjaan', 'tanggalAmbil', p_job->>'tanggalAmbil', 'tanggalKembali', p_job->>'tanggalKembali', 'keperluan', p_job->>'keperluan', 'catatan', p_job->>'catatan',
      'pickupEvidencePath', p_pickup_evidence_path, 'requestedBy', auth.uid()::text, 'requestedAt', floor(extract(epoch from clock_timestamp()) * 1000)::bigint, 'status', v_status
    ), floor(extract(epoch from clock_timestamp()) * 1000)::bigint, v_equipment.id, v_status, v_equipment.upt, case when v_type = 'HAR_UIT' then 'HAR UIT ' || coalesce((select u.data->>'nama' from public.uit u where u.id = v_requester_uit_id), v_requester_uit_id) else coalesce((select u.data->>'nama' from public.upt u where u.id = v_requester_id), p_borrower->>'borrowerName') end, v_owner_id, v_requester_id, v_requester_uit_id);
    select data || jsonb_build_object('id', id, 'ownerUptId', owner_upt_id, 'requesterUptId', requester_upt_id, 'requesterUitId', requester_uit_id) into v_row from public.heavy_equipment_loans where id = v_loan_id;
    v_loans := v_loans || jsonb_build_array(v_row);
    update public.heavy_equipment set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('availabilityStatus', 'DIPINJAM', 'activeLoanId', v_loan_id, 'loanBatchId', v_batch_id) where id = v_equipment.id returning data || jsonb_build_object('id', id, 'uptId', upt_id, 'isCrossUptBorrowable', is_cross_upt_borrowable) into v_row;
    v_assets := v_assets || jsonb_build_array(v_row);
  end loop;
  return jsonb_build_object('batchId', v_batch_id, 'loans', v_loans, 'equipment', v_assets);
end $$;
revoke all on function public.checkout_heavy_equipment_batch(text[], jsonb, jsonb, text) from public;
grant execute on function public.checkout_heavy_equipment_batch(text[], jsonb, jsonb, text) to authenticated;

create or replace function public.checkout_heavy_equipment_batch_v2(
  p_items jsonb, p_borrower jsonb, p_job jsonb, p_pickup_evidence_path text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor profiles%rowtype;
  v_item jsonb;
  v_equipment heavy_equipment%rowtype;
  v_owner_id text;
  v_requester_id text := nullif(trim(coalesce(p_borrower->>'borrowerRefId', '')), '');
  v_requester_uit_id text;
  v_type text := upper(coalesce(p_borrower->>'borrowerType', 'UPT'));
  v_batch_id text := coalesce(nullif(trim(p_job->>'batchId'), ''), 'HE-BATCH-' || replace(gen_random_uuid()::text, '-', ''));
  v_status text := case when v_type in ('UPT','HAR_UIT') then 'PENDING_OWNER_ASMAN' else 'DIPINJAM' end;
  v_count integer := 0;
  v_quantity integer;
  v_available integer;
  v_loans jsonb := '[]'::jsonb;
  v_assets jsonb := '[]'::jsonb;
  v_loan_id text;
  v_row jsonb;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if not found or (v_actor.role <> 'TL' and v_actor.role <> 'HAR_UIT') then raise exception 'Hanya TL UPT pemilik atau HAR UIT yang boleh mencatat peminjaman.' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or nullif(trim(p_pickup_evidence_path), '') is null then raise exception 'Alat, jumlah, dan bukti serah-terima wajib diisi.' using errcode = '23514'; end if;
  if (select count(*) from jsonb_array_elements(p_items) x) <> (select count(distinct x.value->>'equipmentId') from jsonb_array_elements(p_items) x) then raise exception 'Daftar alat tidak boleh duplikat.' using errcode = '23514'; end if;
  if v_type not in ('UPT','ULTG','GI','VENDOR','UNIT_LAIN','HAR_UIT') then raise exception 'Jenis peminjam tidak valid.' using errcode = '22023'; end if;
  if v_actor.role = 'HAR_UIT' and v_type <> 'HAR_UIT' then raise exception 'Akun HAR UIT hanya dapat mengajukan sebagai HAR_UIT.' using errcode = '42501'; end if;
  if v_actor.role = 'TL' and v_type = 'HAR_UIT' then raise exception 'TL tidak dapat mengajukan sebagai HAR_UIT.' using errcode = '42501'; end if;
  if v_type = 'HAR_UIT' and (v_actor.role <> 'HAR_UIT' or v_actor.uit_id is null or nullif(trim(p_borrower->>'borrowerUitId'), '') <> v_actor.uit_id) then raise exception 'UIT peminjam tidak valid.' using errcode = '42501'; end if;
  if nullif(trim(p_job->>'namaPekerjaan'), '') is null or nullif(trim(p_job->>'tanggalAmbil'), '') is null or nullif(trim(p_job->>'tanggalKembali'), '') is null or nullif(trim(p_job->>'keperluan'), '') is null then raise exception 'Pekerjaan, tanggal, dan keperluan wajib diisi.' using errcode = '23514'; end if;
  if (p_job->>'tanggalKembali')::date < (p_job->>'tanggalAmbil')::date then raise exception 'Tanggal kembali tidak boleh sebelum tanggal ambil.' using errcode = '22007'; end if;
  v_owner_id := (select e.upt_id from public.heavy_equipment e where e.id = p_items->0->>'equipmentId');
  if v_owner_id is null then raise exception 'Alat tidak ditemukan.' using errcode = 'P0002'; end if;
  if v_actor.role = 'TL' and v_actor.upt_id <> v_owner_id then raise exception 'Actor bukan TL UPT pemilik alat.' using errcode = '42501'; end if;
  if v_actor.role = 'HAR_UIT' and not exists (select 1 from public.upt owner_upt where owner_upt.id = v_owner_id and owner_upt.uit_id = v_actor.uit_id) then raise exception 'UPT pemilik berada di luar UIT akun.' using errcode = '42501'; end if;
  if left(p_pickup_evidence_path, length(v_owner_id) + 1) <> v_owner_id || '/' then raise exception 'Path bukti tidak sesuai UPT pemilik.' using errcode = '42501'; end if;
  for v_equipment in select e.* from public.heavy_equipment e where e.id in (select x.value->>'equipmentId' from jsonb_array_elements(p_items) x) order by e.id for update loop
    v_count := v_count + 1;
    v_quantity := (select nullif(trim(x.value->>'quantity'), '')::integer from jsonb_array_elements(p_items) x where x.value->>'equipmentId' = v_equipment.id);
    if v_equipment.upt_id <> v_owner_id or v_quantity is null or v_quantity < 1 then raise exception 'Alat dan jumlah tidak valid.' using errcode = '23514'; end if;
    if v_equipment.tracking_mode = 'UNIT' and v_quantity <> 1 then raise exception 'Alat individual hanya dapat dipinjam dengan jumlah 1.' using errcode = '23514'; end if;
    if v_equipment.tracking_mode = 'QUANTITY' then
      select greatest(0, v_equipment.quantity_total - coalesce(sum(case when l.status in ('PENDING_OWNER_ASMAN','DIPINJAM','APPROVED','OVERDUE') then greatest(0, l.quantity_borrowed - l.quantity_returned_good - l.quantity_returned_damaged - l.quantity_returned_lost) else 0 end), 0) - coalesce(sum(case when l.status <> 'REJECTED' then l.quantity_returned_damaged else 0 end), 0) - coalesce(sum(case when l.status <> 'REJECTED' then l.quantity_returned_lost else 0 end), 0)) into v_available from public.heavy_equipment_loans l where l.equipment_id = v_equipment.id;
      if v_quantity > v_available then raise exception 'Saldo alat bantu tidak mencukupi.' using errcode = '40001'; end if;
    else
      if v_equipment.data->>'availabilityStatus' = 'DIPINJAM' or exists (select 1 from public.heavy_equipment_loans l where l.equipment_id = v_equipment.id and l.status in ('PENDING_OWNER_ASMAN','DIPINJAM','APPROVED','OVERDUE')) then raise exception 'Alat memiliki peminjaman aktif.' using errcode = '40001'; end if;
    end if;
    if v_equipment.data->>'statusAlat' in ('MAINTENANCE','KIR') then raise exception 'Alat tidak layak dipinjam.' using errcode = '40001'; end if;
    if v_type in ('UPT','HAR_UIT') and not v_equipment.is_cross_upt_borrowable then raise exception 'Alat belum diizinkan untuk peminjaman lintas-UPT.' using errcode = '42501'; end if;
  end loop;
  if v_count <> (select count(*) from jsonb_array_elements(p_items)) then raise exception 'Daftar alat tidak valid.' using errcode = 'P0002'; end if;
  if v_type = 'UPT' and (v_requester_id is null or v_requester_id = v_owner_id) then raise exception 'UPT peminjam tidak valid.' using errcode = '23514'; end if;
  if v_type = 'HAR_UIT' and v_requester_id is not null then raise exception 'Requester UPT HAR_UIT tidak valid.' using errcode = '23514'; end if;
  if v_type = 'HAR_UIT' and (nullif(trim(p_borrower->>'borrowerPic'), '') is null or nullif(trim(p_borrower->>'borrowerContact'), '') is null) then raise exception 'PIC dan kontak HAR_UIT wajib diisi.' using errcode = '23514'; end if;
  if v_type not in ('UPT','HAR_UIT') and (nullif(trim(p_borrower->>'borrowerName'), '') is null or nullif(trim(p_borrower->>'borrowerPic'), '') is null or nullif(trim(p_borrower->>'borrowerContact'), '') is null) then raise exception 'Nama organisasi, PIC, dan kontak wajib diisi.' using errcode = '23514'; end if;
  v_requester_uit_id := case when v_type = 'HAR_UIT' then v_actor.uit_id else null end;
  for v_item in select value from jsonb_array_elements(p_items) order by value->>'equipmentId' loop
    select * into v_equipment from public.heavy_equipment where id = v_item->>'equipmentId' for update;
    v_quantity := (v_item->>'quantity')::integer;
    v_loan_id := 'HLOAN-' || replace(gen_random_uuid()::text, '-', '');
    insert into public.heavy_equipment_loans (id, data, created_at, equipment_id, status, owner_upt, requester_upt, owner_upt_id, requester_upt_id, requester_uit_id, quantity_borrowed, quantity_returned_good, quantity_returned_damaged, quantity_returned_lost)
    values (v_loan_id, jsonb_build_object('id', v_loan_id, 'equipmentId', v_equipment.id, 'loanBatchId', v_batch_id, 'ownerUptId', v_owner_id, 'requesterUptId', v_requester_id, 'requesterUitId', v_requester_uit_id, 'ownerUpt', v_equipment.upt, 'requesterUpt', case when v_type = 'HAR_UIT' then 'HAR UIT ' || coalesce((select u.data->>'nama' from public.uit u where u.id = v_requester_uit_id), v_requester_uit_id) else coalesce((select u.data->>'nama' from public.upt u where u.id = v_requester_id), p_borrower->>'borrowerName') end, 'borrowerType', v_type, 'borrowerName', case when v_type = 'HAR_UIT' then 'HAR UIT ' || coalesce((select u.data->>'nama' from public.uit u where u.id = v_requester_uit_id), v_requester_uit_id) else p_borrower->>'borrowerName' end, 'borrowerUitId', v_requester_uit_id, 'borrowerPic', p_borrower->>'borrowerPic', 'borrowerContact', p_borrower->>'borrowerContact', 'namaPekerjaan', p_job->>'namaPekerjaan', 'tanggalAmbil', p_job->>'tanggalAmbil', 'tanggalKembali', p_job->>'tanggalKembali', 'keperluan', p_job->>'keperluan', 'catatan', p_job->>'catatan', 'quantityBorrowed', v_quantity, 'quantityReturnedGood', 0, 'quantityReturnedDamaged', 0, 'quantityReturnedLost', 0, 'returnEvents', '[]'::jsonb, 'pickupEvidencePath', p_pickup_evidence_path, 'requestedBy', auth.uid()::text, 'requestedAt', floor(extract(epoch from clock_timestamp()) * 1000)::bigint, 'status', v_status), floor(extract(epoch from clock_timestamp()) * 1000)::bigint, v_equipment.id, v_status, v_equipment.upt, case when v_type = 'HAR_UIT' then 'HAR UIT ' || coalesce((select u.data->>'nama' from public.uit u where u.id = v_requester_uit_id), v_requester_uit_id) else coalesce((select u.data->>'nama' from public.upt u where u.id = v_requester_id), p_borrower->>'borrowerName') end, v_owner_id, v_requester_id, v_requester_uit_id, v_quantity, 0, 0, 0);
    perform public.refresh_heavy_equipment_quantity_state(v_equipment.id);
    select data || jsonb_build_object('id', id, 'ownerUptId', owner_upt_id, 'requesterUptId', requester_upt_id, 'requesterUitId', requester_uit_id, 'quantityBorrowed', quantity_borrowed, 'quantityReturnedGood', quantity_returned_good, 'quantityReturnedDamaged', quantity_returned_damaged, 'quantityReturnedLost', quantity_returned_lost) into v_row from public.heavy_equipment_loans where id = v_loan_id;
    v_loans := v_loans || jsonb_build_array(v_row);
    select data || jsonb_build_object('id', id, 'uptId', upt_id, 'isCrossUptBorrowable', is_cross_upt_borrowable, 'trackingMode', tracking_mode, 'quantityTotal', quantity_total) into v_row from public.heavy_equipment where id = v_equipment.id;
    v_assets := v_assets || jsonb_build_array(v_row);
  end loop;
  return jsonb_build_object('batchId', v_batch_id, 'loans', v_loans, 'equipment', v_assets);
end $$;
revoke all on function public.checkout_heavy_equipment_batch_v2(jsonb, jsonb, jsonb, text) from public;
grant execute on function public.checkout_heavy_equipment_batch_v2(jsonb, jsonb, jsonb, text) to authenticated;

-- HAR_UIT loan letter override (migration 20260921b): optional document at
-- owner UPT / batch / loan-letter.ext. Legacy pickup evidence remains valid
-- for existing loans and non-HAR_UIT flows; return evidence stays required.
do $migration$
declare
  v_sql text;
  v_before text;
begin
  select pg_get_functiondef('public.checkout_heavy_equipment_batch(text[],jsonb,jsonb,text)'::regprocedure) into v_sql;
  v_before := v_sql;
  v_sql := replace(v_sql,
    $old$  if coalesce(array_length(p_equipment_ids, 1), 0) = 0 or nullif(trim(p_pickup_evidence_path), '') is null then raise exception 'Alat dan bukti serah-terima wajib diisi.' using errcode = '23514'; end if;$old$,
    $new$  if coalesce(array_length(p_equipment_ids, 1), 0) = 0 then raise exception 'Alat wajib dipilih.' using errcode = '23514'; end if;
  if v_type <> 'HAR_UIT' and nullif(trim(p_pickup_evidence_path), '') is null then raise exception 'Bukti serah-terima wajib diisi.' using errcode = '23514'; end if;$new$);
  if v_sql = v_before then raise exception 'HAR_UIT optional letter override gagal: checkout_heavy_equipment_batch validation tidak ditemukan.'; end if;
  v_before := v_sql;
  v_sql := replace(v_sql,
    $old$  if left(p_pickup_evidence_path, length(v_owner_id) + 1) <> v_owner_id || '/' then raise exception 'Path bukti tidak sesuai UPT pemilik.' using errcode = '42501'; end if;$old$,
    $new$  if nullif(trim(p_pickup_evidence_path), '') is not null and left(p_pickup_evidence_path, length(v_owner_id) + 1) <> v_owner_id || '/' then raise exception 'Path bukti tidak sesuai UPT pemilik.' using errcode = '42501'; end if;
  if v_type = 'HAR_UIT' and nullif(trim(p_pickup_evidence_path), '') is not null and p_pickup_evidence_path !~ ('^' || v_owner_id || '/' || v_batch_id || '/loan-letter[.](pdf|jpg|jpeg|png|webp)$') then raise exception 'Path surat peminjaman tidak valid.' using errcode = '42501'; end if;$new$);
  if v_sql = v_before then raise exception 'HAR_UIT optional letter override gagal: checkout_heavy_equipment_batch path guard tidak ditemukan.'; end if;
  execute v_sql;
  select pg_get_functiondef('public.checkout_heavy_equipment_batch_v2(jsonb,jsonb,jsonb,text)'::regprocedure) into v_sql;
  v_before := v_sql;
  v_sql := replace(v_sql,
    $old$  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or nullif(trim(p_pickup_evidence_path), '') is null then raise exception 'Alat, jumlah, dan bukti serah-terima wajib diisi.' using errcode = '23514'; end if;$old$,
    $new$  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Alat dan jumlah wajib diisi.' using errcode = '23514'; end if;
  if v_type <> 'HAR_UIT' and nullif(trim(p_pickup_evidence_path), '') is null then raise exception 'Bukti serah-terima wajib diisi.' using errcode = '23514'; end if;$new$);
  if v_sql = v_before then raise exception 'HAR_UIT optional letter override gagal: checkout_heavy_equipment_batch_v2 validation tidak ditemukan.'; end if;
  v_before := v_sql;
  v_sql := replace(v_sql,
    $old$  if left(p_pickup_evidence_path, length(v_owner_id) + 1) <> v_owner_id || '/' then raise exception 'Path bukti tidak sesuai UPT pemilik.' using errcode = '42501'; end if;$old$,
    $new$  if nullif(trim(p_pickup_evidence_path), '') is not null and left(p_pickup_evidence_path, length(v_owner_id) + 1) <> v_owner_id || '/' then raise exception 'Path bukti tidak sesuai UPT pemilik.' using errcode = '42501'; end if;
  if v_type = 'HAR_UIT' and nullif(trim(p_pickup_evidence_path), '') is not null and p_pickup_evidence_path !~ ('^' || v_owner_id || '/' || v_batch_id || '/loan-letter[.](pdf|jpg|jpeg|png|webp)$') then raise exception 'Path surat peminjaman tidak valid.' using errcode = '42501'; end if;$new$);
  if v_sql = v_before then raise exception 'HAR_UIT optional letter override gagal: checkout_heavy_equipment_batch_v2 path guard tidak ditemukan.'; end if;
  execute v_sql;
end
$migration$;

notify pgrst, 'reload schema';

-- Official UIT read scope (final policy parity).
drop policy if exists "Heavy equipment scoped read" on public.heavy_equipment;
create policy "Heavy equipment scoped read" on public.heavy_equipment for select to authenticated using (exists (select 1 from public.profiles actor where actor.id = auth.uid() and (actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT') or actor.upt_id = heavy_equipment.upt_id or (heavy_equipment.is_cross_upt_borrowable and actor.upt_id is not null) or (actor.role in ('ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT') and actor.uit_id is not null and exists (select 1 from public.upt u where u.id = heavy_equipment.upt_id and u.uit_id = actor.uit_id)))));
drop policy if exists "Heavy equipment loan scoped read" on public.heavy_equipment_loans;
create policy "Heavy equipment loan scoped read" on public.heavy_equipment_loans for select to authenticated using (exists (select 1 from public.profiles actor where actor.id = auth.uid() and (actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT') or actor.upt_id = owner_upt_id or actor.upt_id = requester_upt_id or (actor.role in ('ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT') and actor.uit_id is not null and (exists (select 1 from public.upt u where u.id = owner_upt_id and u.uit_id = actor.uit_id) or exists (select 1 from public.upt u where u.id = requester_upt_id and u.uit_id = actor.uit_id))))));
drop policy if exists "Heavy equipment evidence read" on storage.objects;
create policy "Heavy equipment evidence read" on storage.objects for select to authenticated using (bucket_id = 'heavy-equipment-evidence' and exists (select 1 from public.profiles actor where actor.id = auth.uid() and (actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT') or actor.upt_id = (storage.foldername(name))[1] or exists (select 1 from public.heavy_equipment_loans l where (l.data->>'pickupEvidencePath' = name or l.data->>'returnEvidencePath' = name or exists (select 1 from jsonb_array_elements(coalesce(l.data->'returnEvents', '[]'::jsonb)) event where event->>'evidencePath' = name)) and (actor.upt_id = l.requester_upt_id or (actor.role in ('ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT') and actor.uit_id is not null and (exists (select 1 from public.upt u where u.id = l.owner_upt_id and u.uit_id = actor.uit_id) or exists (select 1 from public.upt u where u.id = l.requester_upt_id and u.uit_id = actor.uit_id))))))));
notify pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- CANONICAL TUG-3 + MTU KHS FINAL STATE
-- Bootstrap-only final DDL. Production upgrades remain immutable migrations.
-- This section is intentionally topological: shared TUG dependencies, TUG-3,
-- MTU masters/records, lifecycle, operations, then scoped access controls.
-- ────────────────────────────────────────────────────────────────────────────
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm;

create table if not exists public.tug_global_document_counters (
  upt_id text primary key,
  document_unit_code text not null,
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now()
);
create index if not exists tug_global_document_counters_unit_idx
  on public.tug_global_document_counters(document_unit_code);

create table if not exists public.supplier (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at bigint
);

create table if not exists public.tug_transactions (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  doc_type text not null check (doc_type in ('TUG3','TUG5','TUG7','TUG8','TUG9','TUG10')),
  doc_number text not null unique,
  doc_sequence bigint not null,
  upt_id text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','PENDING','FINAL_APPROVED','REJECTED','CANCELLED','BASELINE_ACCOUNTED','LEGACY_UNVERIFIED')),
  stage text not null,
  version integer not null default 1 check (version > 0),
  document jsonb not null default '{}'::jsonb,
  document_hash text not null,
  identity_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  final_approved_at timestamptz,
  rejected_at timestamptz,
  baseline_accounted_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists tug_transactions_queue_idx on public.tug_transactions(status, stage, upt_id, created_at desc);
create index if not exists tug_transactions_legacy_idx on public.tug_transactions(legacy_id) where legacy_id is not null;

create table if not exists public.tug_items (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.tug_transactions(id) on delete restrict,
  line_no integer not null check (line_no > 0),
  stock_id text references public.stocks(id) on delete restrict,
  katalog_id text references public.katalog(id) on delete restrict,
  lokasi_id text,
  qty numeric(18,4) not null check (qty > 0),
  unit text,
  snapshot jsonb not null default '{}'::jsonb,
  source_snapshot jsonb not null default '{}'::jsonb,
  unique (transaction_id, line_no)
);
create index if not exists tug_items_transaction_idx on public.tug_items(transaction_id);
create index if not exists tug_items_stock_idx on public.tug_items(stock_id) where stock_id is not null;

create table if not exists public.tug_approvals (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.tug_transactions(id) on delete restrict,
  event_type text not null check (event_type in ('CREATED','SUBMITTED','PREPARED','REVIEWED','APPROVED','REJECTED','DRAWN_ACK','AMENDED')),
  decision text check (decision in ('APPROVE','REJECT')),
  stage text,
  actor_id uuid references public.profiles(id),
  actor_snapshot jsonb not null default '{}'::jsonb,
  document_hash text,
  transaction_version integer,
  review_token uuid,
  reason text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists tug_approvals_once_per_decision on public.tug_approvals(transaction_id, stage, actor_id, decision) where decision is not null;
create unique index if not exists tug_approvals_review_token_idx on public.tug_approvals(review_token) where review_token is not null and event_type = 'REVIEWED';
create index if not exists tug_approvals_transaction_idx on public.tug_approvals(transaction_id, created_at);

create table if not exists public.tug_review_tokens (
  token uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.tug_transactions(id) on delete restrict,
  actor_id uuid not null references public.profiles(id),
  transaction_version integer not null,
  document_hash text not null,
  stock_snapshot jsonb not null default '[]'::jsonb,
  attestations jsonb,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tug_review_tokens_transaction_idx on public.tug_review_tokens(transaction_id, actor_id, expires_at);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.tug_transactions(id) on delete restrict,
  tug_item_id uuid not null references public.tug_items(id) on delete restrict,
  stock_id text not null references public.stocks(id) on delete restrict,
  direction text not null check (direction = 'OUT'),
  qty numeric(18,4) not null check (qty > 0),
  before_qty numeric(18,4) not null,
  after_qty numeric(18,4) not null,
  actor_id uuid not null references public.profiles(id),
  xact_id bigint not null default txid_current(),
  created_at timestamptz not null default now(),
  unique (transaction_id, tug_item_id, direction)
);
create index if not exists stock_movements_stock_idx on public.stock_movements(stock_id, created_at desc);

alter table public.tug_idempotency_keys drop constraint if exists tug_idempotency_keys_operation_check;
alter table public.tug_idempotency_keys add constraint tug_idempotency_keys_operation_check
  check (operation in ('CREATE','SUBMIT','DECIDE','AMEND','TUG10_FINAL_APPROVE','TUG3_FINAL_APPROVE'));

create table if not exists public.tug3_transactions (
  id text primary key,
  upt_id text not null,
  created_by uuid references auth.users(id) on delete restrict,
  doc_number text,
  stage text not null default 'DRAFT' check (stage in ('DRAFT','PENDING_TL','MENUNGGU_TUG4','PENDING_ASMAN','APPROVED','REJECTED')),
  status text not null default 'DRAFT',
  mtu_record_id text,
  data jsonb not null default '{}'::jsonb,
  created_at bigint,
  updated_at bigint
);
create index if not exists idx_tug3_transactions_upt on public.tug3_transactions(upt_id);
create index if not exists idx_tug3_transactions_mtu_record on public.tug3_transactions(mtu_record_id);

create table if not exists public.mtu_khs_gardu_induk (
  id text primary key,
  upt_id text not null references public.upt(id) on delete restrict,
  ultg_id text not null references public.ultg(id) on delete restrict,
  normalized_name text not null,
  data jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_mtu_khs_gi_upt_name on public.mtu_khs_gardu_induk(upt_id, normalized_name);
create index if not exists idx_mtu_khs_gi_ultg on public.mtu_khs_gardu_induk(ultg_id);
create index if not exists idx_mtu_khs_gi_upt on public.mtu_khs_gardu_induk(upt_id);

create table if not exists public.mtu_khs_gardu_induk_bay (
  id text primary key,
  gardu_induk_id text not null references public.mtu_khs_gardu_induk(id) on delete restrict,
  normalized_name text not null,
  data jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_mtu_khs_bay_gi_name on public.mtu_khs_gardu_induk_bay(gardu_induk_id, normalized_name);
create index if not exists idx_mtu_khs_bay_gi on public.mtu_khs_gardu_induk_bay(gardu_induk_id);

create table if not exists public.mtu_khs_specs (
  id text primary key,
  procurement_year integer not null,
  mtu_code text not null,
  vendor text,
  katalog_id text references public.katalog(id) on delete set null,
  mapping_status text not null default 'CANDIDATE' check (mapping_status in ('CANDIDATE','APPROVED','REJECTED')),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (procurement_year, mtu_code, vendor)
);
create index if not exists idx_mtu_khs_specs_code on public.mtu_khs_specs(mtu_code);

create table if not exists public.mtu_khs_records (
  id text primary key,
  upt_id text not null references public.upt(id) on delete restrict,
  ultg_id text references public.ultg(id) on delete restrict,
  gardu_induk_id text references public.mtu_khs_gardu_induk(id) on delete restrict,
  bay_id text references public.mtu_khs_gardu_induk_bay(id) on delete restrict,
  gudang_id text references public.gudang(id) on delete restrict,
  lokasi_id text references public.lokasi(id) on delete set null,
  mtu_spec_id text references public.mtu_khs_specs(id) on delete set null,
  katalog_id text references public.katalog(id) on delete set null,
  supplier_id text references public.supplier(id) on delete set null,
  procurement_year integer not null,
  lifecycle_status text not null default 'VENDOR' check (lifecycle_status in ('VENDOR','IN_TRANSIT','WAREHOUSE','ON_SITE','INSTALLED','CANCELLED')),
  sifat_pekerjaan text not null default 'MATERIAL' check (sifat_pekerjaan in ('MATERIAL','SUPERVISI')),
  qty numeric not null default 0 check (qty >= 0),
  search_text text not null default '',
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);
create index if not exists idx_mtu_khs_records_upt on public.mtu_khs_records(upt_id);
create index if not exists idx_mtu_khs_records_year on public.mtu_khs_records(procurement_year);
create index if not exists idx_mtu_khs_records_status on public.mtu_khs_records(lifecycle_status);
create index if not exists idx_mtu_khs_records_lokasi on public.mtu_khs_records(lokasi_id);
create index if not exists idx_mtu_khs_records_search_trgm on public.mtu_khs_records using gin(search_text gin_trgm_ops);

create table if not exists public.mtu_khs_units (
  id text primary key,
  record_id text not null references public.mtu_khs_records(id) on delete cascade,
  serial_number text,
  lifecycle_status text not null default 'VENDOR' check (lifecycle_status in ('VENDOR','IN_TRANSIT','WAREHOUSE','ON_SITE','INSTALLED','CANCELLED')),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_mtu_khs_units_record on public.mtu_khs_units(record_id);

create table if not exists public.mtu_khs_documents (
  id text primary key,
  vendor text not null,
  procurement_year integer not null,
  mtu_code text not null,
  document_type text not null check (document_type in ('DRAWING','CATALOG','TPG','TYPE_TEST','SCHEMATIC','NAMEPLATE','OTHER')),
  revision text not null default '',
  title text not null,
  url text not null check (url ~* '^https://'),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (vendor, procurement_year, mtu_code, document_type, revision, url)
);
create index if not exists idx_mtu_khs_documents_match on public.mtu_khs_documents(vendor, procurement_year, mtu_code);

create table if not exists public.mtu_khs_record_documents (
  record_id text not null references public.mtu_khs_records(id) on delete cascade,
  document_id text not null references public.mtu_khs_documents(id) on delete restrict,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (record_id, document_id)
);
create table if not exists public.mtu_khs_usage_links (
  id text primary key,
  mtu_record_id text not null references public.mtu_khs_records(id) on delete cascade,
  tug_item_id text not null,
  qty numeric not null check (qty > 0),
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create table if not exists public.mtu_khs_change_requests (
  id text primary key,
  record_id text not null references public.mtu_khs_records(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  requester_role text not null,
  approver_role text not null check (approver_role in ('ASMAN','ASMAN_LOG_UIT')),
  approver_upt_id text references public.upt(id),
  approver_uit_id text references public.uit(id),
  patch jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
  decision_note text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_mtu_khs_changes_status on public.mtu_khs_change_requests(status);

create table if not exists public.mtu_khs_sheet_sync_jobs (
  id text primary key,
  change_request_id text not null references public.mtu_khs_change_requests(id) on delete restrict,
  record_id text not null references public.mtu_khs_records(id) on delete restrict,
  status text not null default 'PENDING' check (status in ('PENDING','SYNCING','SYNCED','CONFLICT','FAILED','SKIPPED')),
  attempts integer not null default 0 check (attempts >= 0),
  sheet_id text not null,
  sheet_name text not null,
  source_row integer,
  source_row_sha256 text not null default '',
  source_key jsonb not null default '{}'::jsonb,
  patch jsonb not null default '{}'::jsonb,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  before_sheet jsonb not null default '{}'::jsonb,
  after_sheet jsonb not null default '{}'::jsonb,
  last_error text,
  started_at timestamptz,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (change_request_id)
);
create index if not exists idx_mtu_khs_sheet_jobs_status on public.mtu_khs_sheet_sync_jobs(status, updated_at);
create index if not exists idx_mtu_khs_sheet_jobs_record on public.mtu_khs_sheet_sync_jobs(record_id);

create table if not exists public.mtu_khs_import_batches (
  id text primary key,
  procurement_year integer not null,
  uit_id text references public.uit(id),
  source_file text not null,
  status text not null default 'STAGED' check (status in ('STAGED','REVIEW','APPROVED','REJECTED')),
  summary jsonb not null default '{}'::jsonb,
  file_sha256 text not null default '',
  sheet_name text not null default '',
  committed_at timestamptz,
  commit_idempotency_key text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table if not exists public.mtu_khs_import_rows (
  id text primary key,
  batch_id text not null references public.mtu_khs_import_batches(id) on delete cascade,
  source_row integer not null,
  raw_data jsonb not null default '{}'::jsonb,
  normalized_data jsonb not null default '{}'::jsonb,
  validation_errors jsonb not null default '[]'::jsonb,
  duplicate_candidate boolean not null default false,
  raw_row_sha256 text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_mtu_khs_import_rows_batch on public.mtu_khs_import_rows(batch_id);

create table if not exists public.mtu_khs_reconciliations (
  record_id text primary key references public.mtu_khs_records(id) on delete cascade,
  status text not null check (status in ('BELUM_DICEK','BELUM_TUG','SEBAGIAN','SUDAH_TUG')),
  note text not null default '',
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
create table if not exists public.mtu_khs_stock_links (
  id uuid primary key default gen_random_uuid(),
  mtu_record_id text not null references public.mtu_khs_records(id) on delete cascade,
  stock_id text not null references public.stocks(id) on delete restrict,
  qty numeric(18,4) not null check (qty > 0),
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mtu_record_id, stock_id)
);
create table if not exists public.mtu_khs_receipts (
  id uuid primary key default gen_random_uuid(),
  mtu_record_id text not null references public.mtu_khs_records(id) on delete restrict,
  tug3_transaction_id text not null references public.tug3_transactions(id) on delete restrict,
  qty numeric(18,4) not null check (qty > 0),
  items jsonb not null default '[]'::jsonb,
  applied_by uuid not null references auth.users(id),
  applied_at timestamptz not null default now(),
  idempotency_key text not null,
  unique (tug3_transaction_id),
  unique (idempotency_key)
);
create index if not exists idx_mtu_khs_receipts_record on public.mtu_khs_receipts(mtu_record_id, applied_at);

create table if not exists public.mtu_khs_record_events (
  id uuid primary key default gen_random_uuid(),
  record_id text not null references public.mtu_khs_records(id) on delete cascade,
  event_type text not null,
  actor_id uuid references auth.users(id),
  source_upt_id text references public.upt(id),
  target_upt_id text references public.upt(id),
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text,
  created_at timestamptz not null default now(),
  unique (record_id, idempotency_key)
);
create index if not exists idx_mtu_khs_record_events_record on public.mtu_khs_record_events(record_id, created_at desc);
create table if not exists public.mtu_khs_record_evidence (
  id uuid primary key default gen_random_uuid(),
  record_id text not null references public.mtu_khs_records(id) on delete cascade,
  kind text not null check (kind in ('ITEM','NAMEPLATE')),
  object_path text not null,
  mime_type text not null,
  size_bytes bigint not null,
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  inherited_from uuid references public.mtu_khs_record_evidence(id)
);
create unique index if not exists uq_mtu_khs_evidence_active on public.mtu_khs_record_evidence(record_id, kind) where superseded_at is null;
create index if not exists idx_mtu_khs_evidence_record on public.mtu_khs_record_evidence(record_id, kind, created_at desc);
create table if not exists public.mtu_khs_transfer_requests (
  id uuid primary key default gen_random_uuid(),
  source_record_id text not null references public.mtu_khs_records(id) on delete restrict,
  source_version integer not null,
  idempotency_key text not null,
  source_upt_id text not null references public.upt(id),
  target_upt_id text not null references public.upt(id),
  target_ultg_id text,
  target_gardu_induk_id text,
  target_bay_id text,
  target_gudang_id text,
  target_lokasi_id text,
  qty numeric not null check (qty > 0),
  note text not null default '',
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text not null default '',
  target_record_id text,
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb
);
create unique index if not exists uq_mtu_khs_transfer_idempotency on public.mtu_khs_transfer_requests(source_record_id, idempotency_key);
create index if not exists idx_mtu_khs_transfer_scope on public.mtu_khs_transfer_requests(source_upt_id, target_upt_id, status);

create or replace function public.mtu_khs_can_access_upt(p_upt_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and (
    p.role in ('SUPERADMIN','ADMIN_LOG_PUSAT','PENGADAAN') or public.can_access_upt(p_upt_id)
    or (p.role in ('ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT') and exists (select 1 from public.upt u where u.id = p_upt_id and u.uit_id = p.uit_id))
  ));
$$;
create or replace function public.mtu_khs_search_text(p_data jsonb)
returns text language sql immutable as $$
  select lower(regexp_replace(regexp_replace(coalesce(p_data::text,''), '[^[:alnum:]]+', ' ', 'g'), '\s+', ' ', 'g'));
$$;
create or replace function public.mtu_khs_refresh_search_text()
returns trigger language plpgsql as $$
begin
  new.search_text := public.mtu_khs_search_text(coalesce(new.data,'{}'::jsonb) || jsonb_build_object('id',new.id,'uptId',new.upt_id,'katalogId',new.katalog_id));
  return new;
end;
$$;
drop trigger if exists trg_mtu_khs_refresh_search_text on public.mtu_khs_records;
create trigger trg_mtu_khs_refresh_search_text before insert or update of data, katalog_id, upt_id on public.mtu_khs_records for each row execute function public.mtu_khs_refresh_search_text();

alter table public.supplier enable row level security;
drop policy if exists "Authenticated read supplier" on public.supplier;
drop policy if exists "Authenticated write supplier" on public.supplier;
create policy "Authenticated read supplier" on public.supplier for select to authenticated using (auth.role() = 'authenticated');
create policy "Authenticated write supplier" on public.supplier for all to authenticated using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
grant select, insert, update, delete on public.supplier to authenticated, service_role;

alter table public.tug_global_document_counters enable row level security;
drop policy if exists "Scoped read tug_global_document_counters" on public.tug_global_document_counters;
create policy "Scoped read tug_global_document_counters" on public.tug_global_document_counters
  for select to authenticated using (public.can_access_upt(upt_id));

alter table public.tug_transactions enable row level security;
alter table public.tug_items enable row level security;
alter table public.tug_approvals enable row level security;
alter table public.tug_review_tokens enable row level security;
alter table public.stock_movements enable row level security;
alter table public.tug3_transactions enable row level security;
alter table public.mtu_khs_gardu_induk enable row level security;
alter table public.mtu_khs_gardu_induk_bay enable row level security;
alter table public.mtu_khs_specs enable row level security;
alter table public.mtu_khs_records enable row level security;
alter table public.mtu_khs_units enable row level security;
alter table public.mtu_khs_documents enable row level security;
alter table public.mtu_khs_record_documents enable row level security;
alter table public.mtu_khs_usage_links enable row level security;
alter table public.mtu_khs_change_requests enable row level security;
alter table public.mtu_khs_sheet_sync_jobs enable row level security;
alter table public.mtu_khs_import_batches enable row level security;
alter table public.mtu_khs_import_rows enable row level security;
alter table public.mtu_khs_reconciliations enable row level security;
alter table public.mtu_khs_stock_links enable row level security;
alter table public.mtu_khs_receipts enable row level security;
alter table public.mtu_khs_record_events enable row level security;
alter table public.mtu_khs_record_evidence enable row level security;
alter table public.mtu_khs_transfer_requests enable row level security;

drop policy if exists "Scoped read tug3_transactions" on public.tug3_transactions;
create policy "Scoped read tug3_transactions" on public.tug3_transactions for select to authenticated using (public.can_access_upt(upt_id));
drop policy if exists "Scoped read tug_transactions" on public.tug_transactions;
create policy "Scoped read tug_transactions" on public.tug_transactions for select to authenticated using (public.can_access_upt(upt_id));
drop policy if exists "Scoped read tug_items" on public.tug_items;
create policy "Scoped read tug_items" on public.tug_items for select to authenticated using (exists (select 1 from public.tug_transactions t where t.id = transaction_id and public.can_access_upt(t.upt_id)));
drop policy if exists "Scoped read tug_approvals" on public.tug_approvals;
create policy "Scoped read tug_approvals" on public.tug_approvals for select to authenticated using (exists (select 1 from public.tug_transactions t where t.id = transaction_id and public.can_access_upt(t.upt_id)));
drop policy if exists "Scoped read tug_review_tokens" on public.tug_review_tokens;
create policy "Scoped read tug_review_tokens" on public.tug_review_tokens for select to authenticated using (actor_id = auth.uid());
drop policy if exists "Scoped read stock_movements" on public.stock_movements;
create policy "Scoped read stock_movements" on public.stock_movements for select to authenticated using (exists (select 1 from public.tug_transactions t where t.id = transaction_id and public.can_access_upt(t.upt_id)));
drop policy if exists "MTU KHS GI scoped" on public.mtu_khs_gardu_induk;
create policy "MTU KHS GI scoped" on public.mtu_khs_gardu_induk for select to authenticated using (public.mtu_khs_can_access_upt(upt_id));
drop policy if exists "MTU KHS Bay scoped" on public.mtu_khs_gardu_induk_bay;
create policy "MTU KHS Bay scoped" on public.mtu_khs_gardu_induk_bay for select to authenticated using (exists (select 1 from public.mtu_khs_gardu_induk gi where gi.id = gardu_induk_id and public.mtu_khs_can_access_upt(gi.upt_id)));
drop policy if exists "MTU KHS specs read" on public.mtu_khs_specs;
create policy "MTU KHS specs read" on public.mtu_khs_specs for select to authenticated using (auth.uid() is not null);
drop policy if exists "MTU KHS records scoped" on public.mtu_khs_records;
create policy "MTU KHS records scoped" on public.mtu_khs_records for select to authenticated using (public.mtu_khs_can_access_upt(upt_id));
drop policy if exists "MTU KHS records controlled write" on public.mtu_khs_records;
create policy "MTU KHS records controlled write" on public.mtu_khs_records for insert to authenticated with check (false);
drop policy if exists "MTU KHS records no direct update" on public.mtu_khs_records;
create policy "MTU KHS records no direct update" on public.mtu_khs_records for update to authenticated using (false) with check (false);
drop policy if exists "MTU KHS records no direct delete" on public.mtu_khs_records;
create policy "MTU KHS records no direct delete" on public.mtu_khs_records for delete to authenticated using (false);
drop policy if exists "MTU KHS units scoped" on public.mtu_khs_units;
create policy "MTU KHS units scoped" on public.mtu_khs_units for select to authenticated using (exists (select 1 from public.mtu_khs_records r where r.id = record_id and public.mtu_khs_can_access_upt(r.upt_id)));
drop policy if exists "MTU KHS documents read" on public.mtu_khs_documents;
create policy "MTU KHS documents read" on public.mtu_khs_documents for select to authenticated using (auth.uid() is not null);
drop policy if exists "MTU KHS record documents scoped" on public.mtu_khs_record_documents;
create policy "MTU KHS record documents scoped" on public.mtu_khs_record_documents for select to authenticated using (exists (select 1 from public.mtu_khs_records r where r.id = record_id and public.mtu_khs_can_access_upt(r.upt_id)));
drop policy if exists "MTU KHS usage scoped" on public.mtu_khs_usage_links;
create policy "MTU KHS usage scoped" on public.mtu_khs_usage_links for select to authenticated using (exists (select 1 from public.mtu_khs_records r where r.id = mtu_record_id and public.mtu_khs_can_access_upt(r.upt_id)));
drop policy if exists "MTU KHS changes scoped" on public.mtu_khs_change_requests;
create policy "MTU KHS changes scoped" on public.mtu_khs_change_requests for select to authenticated using (exists (select 1 from public.mtu_khs_records r where r.id = record_id and public.mtu_khs_can_access_upt(r.upt_id)));
drop policy if exists "MTU KHS import batches" on public.mtu_khs_import_batches;
create policy "MTU KHS import batches" on public.mtu_khs_import_batches for select to authenticated using (auth.uid() is not null and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role in ('SUPERADMIN', 'PENGADAAN', 'ADMIN_LOG_PUSAT') or (p.role = 'ASMAN_LOG_UIT' and p.uit_id = mtu_khs_import_batches.uit_id))));
drop policy if exists "MTU KHS import rows" on public.mtu_khs_import_rows;
create policy "MTU KHS import rows" on public.mtu_khs_import_rows for select to authenticated using (exists (select 1 from public.mtu_khs_import_batches b where b.id = batch_id and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role in ('SUPERADMIN', 'PENGADAAN', 'ADMIN_LOG_PUSAT') or (p.role = 'ASMAN_LOG_UIT' and p.uit_id = b.uit_id)))));
drop policy if exists "MTU KHS sheet sync scoped" on public.mtu_khs_sheet_sync_jobs;
create policy "MTU KHS sheet sync scoped" on public.mtu_khs_sheet_sync_jobs for select to authenticated using (exists (select 1 from public.mtu_khs_records r where r.id = record_id and public.mtu_khs_can_access_upt(r.upt_id)));
drop policy if exists "MTU KHS reconciliation scoped" on public.mtu_khs_reconciliations;
create policy "MTU KHS reconciliation scoped" on public.mtu_khs_reconciliations for select to authenticated using (exists (select 1 from public.mtu_khs_records r where r.id = record_id and public.mtu_khs_can_access_upt(r.upt_id)));
drop policy if exists "MTU KHS stock links scoped" on public.mtu_khs_stock_links;
create policy "MTU KHS stock links scoped" on public.mtu_khs_stock_links for select to authenticated using (exists (select 1 from public.mtu_khs_records r where r.id = mtu_record_id and public.mtu_khs_can_access_upt(r.upt_id)));
drop policy if exists "MTU KHS receipts scoped" on public.mtu_khs_receipts;
create policy "MTU KHS receipts scoped" on public.mtu_khs_receipts for select to authenticated using (exists (select 1 from public.mtu_khs_records r where r.id = mtu_record_id and public.mtu_khs_can_access_upt(r.upt_id)));
drop policy if exists "MTU KHS events scoped" on public.mtu_khs_record_events;
create policy "MTU KHS events scoped" on public.mtu_khs_record_events for select to authenticated using (public.mtu_khs_can_access_upt(source_upt_id) or (event_type = 'TRANSFER_APPROVED' and public.mtu_khs_can_access_upt(target_upt_id)));
drop policy if exists "MTU KHS evidence scoped" on public.mtu_khs_record_evidence;
create policy "MTU KHS evidence scoped" on public.mtu_khs_record_evidence for select to authenticated using (exists (select 1 from public.mtu_khs_records r where r.id = record_id and public.mtu_khs_can_access_upt(r.upt_id)));
drop policy if exists "MTU KHS transfers scoped" on public.mtu_khs_transfer_requests;
create policy "MTU KHS transfers scoped" on public.mtu_khs_transfer_requests for select to authenticated using (public.mtu_khs_can_access_upt(source_upt_id) or (status = 'APPROVED' and public.mtu_khs_can_access_upt(target_upt_id)));

revoke all on public.tug_global_document_counters, public.tug_transactions, public.tug_items, public.tug_approvals, public.tug_review_tokens, public.stock_movements from anon, authenticated;
grant select on public.tug_global_document_counters, public.tug_transactions, public.tug_items, public.tug_approvals, public.stock_movements to authenticated;
grant select, insert, update, delete on public.tug3_transactions to authenticated, service_role;
grant select on public.mtu_khs_gardu_induk, public.mtu_khs_gardu_induk_bay, public.mtu_khs_specs, public.mtu_khs_records, public.mtu_khs_units, public.mtu_khs_documents, public.mtu_khs_record_documents, public.mtu_khs_usage_links, public.mtu_khs_change_requests, public.mtu_khs_sheet_sync_jobs, public.mtu_khs_import_batches, public.mtu_khs_import_rows, public.mtu_khs_reconciliations, public.mtu_khs_stock_links, public.mtu_khs_receipts, public.mtu_khs_record_events, public.mtu_khs_record_evidence, public.mtu_khs_transfer_requests to authenticated;
revoke insert, update, delete on public.mtu_khs_gardu_induk, public.mtu_khs_gardu_induk_bay, public.mtu_khs_specs, public.mtu_khs_records, public.mtu_khs_units, public.mtu_khs_documents, public.mtu_khs_record_documents, public.mtu_khs_usage_links, public.mtu_khs_change_requests, public.mtu_khs_sheet_sync_jobs, public.mtu_khs_import_batches, public.mtu_khs_import_rows, public.mtu_khs_reconciliations, public.mtu_khs_stock_links, public.mtu_khs_receipts, public.mtu_khs_record_events, public.mtu_khs_record_evidence, public.mtu_khs_transfer_requests from authenticated;

-- Canonical TUG helper functions used by the application RPCs.
create or replace function public.tug_actor()
returns public.profiles language plpgsql stable security definer set search_path = public
as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then raise exception 'TUG_AUTH_REQUIRED' using errcode = '42501'; end if;
  return p;
end $$;

create or replace function public.tug_assert_upt_scope(p_actor public.profiles, p_upt_id text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_actor.role <> 'SUPERADMIN' and (p_actor.upt_id is null or p_actor.upt_id <> p_upt_id) then
    raise exception 'TUG_UPT_SCOPE_FORBIDDEN' using errcode = '42501';
  end if;
end $$;

create or replace function public.tug_hash(p_document jsonb, p_items jsonb, p_doc_number text, p_identity_snapshot jsonb)
returns text language sql immutable as $$
  select encode(extensions.digest(coalesce(p_document, '{}'::jsonb)::text || '|' || coalesce(p_items, '[]'::jsonb)::text || '|' || coalesce(p_doc_number,'') || '|' || coalesce(p_identity_snapshot,'{}'::jsonb)::text, 'sha256'), 'hex')
$$;

create or replace function public.tug_doc_code(p_doc_type text)
returns text language sql immutable as $$
  select case when p_doc_type in ('TUG3','TUG10') then 'LOG.00.01' else 'LOG.00.02' end
$$;

create or replace function public.tug_doc_number(p_seq bigint, p_doc_type text, p_upt_id text, p_at timestamptz default now())
returns text language plpgsql stable as $$
declare suffix text; u text := nullif(p_upt_id,'');
begin
  if u is null then raise exception 'TUG_UPT_REQUIRED'; end if;
  suffix := to_char(p_at at time zone 'Asia/Jakarta', 'FMRM/YYYY');
  if p_doc_type = 'TUG5' then return p_seq::text || '.TUG-5/LOG-' || u || '/' || suffix; end if;
  if p_doc_type = 'TUG7' then return lpad(p_seq::text, 3, '0') || '.TUG7/LOG/UIT-JBM/' || suffix; end if;
  return p_seq::text || '.' || replace(p_doc_type, 'TUG', 'TUG-') || '/' || public.tug_doc_code(p_doc_type) || '/' || u || '/' || suffix;
end $$;

create or replace function public.tug_initial_stage(p_doc_type text, p_actor_role text)
returns text language plpgsql immutable as $$
begin
  if p_doc_type = 'TUG3' then return 'PENDING_TL'; end if;
  if p_doc_type = 'TUG5' then return 'PENDING_ASMAN'; end if;
  if p_doc_type = 'TUG7' then return 'PENDING_MGR_LOGISTIK'; end if;
  if p_doc_type in ('TUG8','TUG9') then return case when p_actor_role='TL' then 'PENDING_ASMAN' else 'PENDING_TL' end; end if;
  return case when p_actor_role = 'ADMIN' then 'PENDING_TL' else 'PENDING_ASMAN' end;
end $$;

create or replace function public.tug_required_role(p_stage text)
returns text language sql immutable as $$
  select case p_stage
    when 'PENDING_TL' then 'TL'
    when 'PENDING_ASMAN' then 'ASMAN'
    when 'PENDING_MANAGER' then 'MANAGER'
    when 'PENDING_MGR_LOGISTIK' then 'MGR_LOGISTIK_UIT'
    when 'PENDING_MGR_ULTG' then 'MGR_ULTG'
    else null end
$$;

create or replace function public.tug_next_stage(p_doc_type text, p_stage text)
returns text language plpgsql immutable as $$
begin
  if p_doc_type = 'TUG3' and p_stage = 'PENDING_TL' then return 'PENDING_MANAGER'; end if;
  if p_doc_type = 'TUG3' and p_stage = 'PENDING_MANAGER' then return 'PENDING_ASMAN'; end if;
  if p_doc_type = 'TUG5' and p_stage = 'PENDING_ASMAN' then return 'PENDING_MANAGER'; end if;
  if p_doc_type in ('TUG8','TUG9') and p_stage = 'PENDING_TL' then return 'PENDING_ASMAN'; end if;
  return 'FINAL_APPROVED';
end $$;

create or replace function public.tug_stock_direction(p_doc_type text)
returns text language sql immutable as $$
  select case when p_doc_type in ('TUG8','TUG9') then 'OUT' else 'NONE' end
$$;

create or replace function public.tug_assert_items(p_items jsonb, p_require_stock boolean default false)
returns void language plpgsql immutable as $$
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'TUG_ITEMS_REQUIRED';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) x(value)
    where jsonb_typeof(x.value) <> 'object'
       or nullif(btrim(x.value->>'qty'),'') is null
       or btrim(x.value->>'qty') !~ '^[0-9]+([.][0-9]{1,4})?$'
       or case when btrim(x.value->>'qty') ~ '^[0-9]+([.][0-9]{1,4})?$'
               then (btrim(x.value->>'qty'))::numeric <= 0 else false end
       or (p_require_stock and nullif(btrim(x.value->>'stockId'),'') is null)
  ) then raise exception 'TUG_ITEMS_INVALID'; end if;
end $$;

create or replace function public.tug_assert_canonical_item_refs(p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from jsonb_array_elements(p_items) x(value) left join public.stocks st on st.id=nullif(btrim(x.value->>'stockId'),'') where st.id is null) then
    raise exception 'TUG_STOCK_NOT_FOUND';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) x(value)
    join public.stocks st on st.id=nullif(btrim(x.value->>'stockId'),'')
    where (nullif(btrim(x.value->>'katalogId'),'') is not null and nullif(btrim(x.value->>'katalogId'),'') is distinct from st.katalog_id)
       or (nullif(btrim(x.value->>'lokasiId'),'') is not null and nullif(btrim(x.value->>'lokasiId'),'') is distinct from st.lokasi_id)
  ) then raise exception 'TUG_ITEM_REFERENCE_MISMATCH'; end if;
end $$;

create or replace function public.tug_stock_snapshot(p_transaction_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('stock_id',s.id,'katalog_id',s.katalog_id,'lokasi_id',s.lokasi_id,'qty',coalesce((s.data->>'qty')::numeric,0)) order by s.id),'[]'::jsonb)
  from public.stocks s where exists (select 1 from public.tug_items i where i.transaction_id=p_transaction_id and i.stock_id=s.id)
$$;

create or replace function public.tug_request_hash(p_operation text, p_payload jsonb)
returns text language sql immutable as $$
  select encode(extensions.digest(p_operation || '|' || coalesce(p_payload, 'null'::jsonb)::text, 'sha256'), 'hex')
$$;

create or replace function public.tug_idempotency_response(p_key uuid, p_operation text, p_actor_id uuid, p_request_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare existing public.tug_idempotency_keys;
begin
  if p_key is null then raise exception 'TUG_IDEMPOTENCY_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_key::text, 0));
  select * into existing from public.tug_idempotency_keys where key=p_key;
  if existing.key is null then return null; end if;
  if existing.operation <> p_operation or existing.actor_id <> p_actor_id or existing.request_hash is distinct from p_request_hash then
    raise exception 'TUG_IDEMPOTENCY_REUSE_FORBIDDEN' using errcode='42501';
  end if;
  return existing.response;
end $$;

create or replace function public.tug_assert_outgoing_stock_scope(p_transaction_id uuid, p_upt_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_item record;
begin
  for v_item in select stock_id from public.tug_items where transaction_id=p_transaction_id loop
    if v_item.stock_id is null then raise exception 'TUG_LOCATION_REQUIRED'; end if;
    if exists (select 1 from public.stocks st where st.id=v_item.stock_id and st.lokasi_id is null) then raise exception 'TUG_LOCATION_REQUIRED'; end if;
    if not exists (
      select 1 from public.stocks st join public.lokasi loc on loc.id=st.lokasi_id join public.gudang gd on gd.id=loc.gudang_id
      where st.id=v_item.stock_id and gd.upt_id=p_upt_id
    ) then raise exception 'TUG_STOCK_UPT_MISMATCH'; end if;
  end loop;
end $$;

revoke all on function public.tug_actor(), public.tug_assert_upt_scope(public.profiles,text), public.tug_hash(jsonb,jsonb,text,jsonb), public.tug_doc_code(text), public.tug_doc_number(bigint,text,text,timestamptz), public.tug_initial_stage(text,text), public.tug_required_role(text), public.tug_next_stage(text,text), public.tug_stock_direction(text), public.tug_assert_items(jsonb,boolean), public.tug_assert_canonical_item_refs(jsonb), public.tug_stock_snapshot(uuid), public.tug_request_hash(text,jsonb), public.tug_idempotency_response(uuid,text,uuid,text), public.tug_assert_outgoing_stock_scope(uuid,text) from public, anon, authenticated;
grant execute on function public.tug_actor(), public.tug_assert_upt_scope(public.profiles,text), public.tug_hash(jsonb,jsonb,text,jsonb), public.tug_doc_code(text), public.tug_doc_number(bigint,text,text,timestamptz), public.tug_initial_stage(text,text), public.tug_required_role(text), public.tug_next_stage(text,text), public.tug_stock_direction(text), public.tug_assert_items(jsonb,boolean), public.tug_assert_canonical_item_refs(jsonb), public.tug_stock_snapshot(uuid), public.tug_request_hash(text,jsonb), public.tug_idempotency_response(uuid,text,uuid,text), public.tug_assert_outgoing_stock_scope(uuid,text) to authenticated;

-- The final MTU RPC implementations follow the same signatures as the
-- immutable migrations; their definitions are installed below this section.


-- Final MTU KHS RPCs: same public signatures and server-side invariants as the
-- ordered production migrations, composed into the bootstrap section.
create or replace function public.mtu_khs_submit_change(p_record_id text, p_expected_version integer, p_patch jsonb, p_idempotency_key text)
returns public.mtu_khs_change_requests
language plpgsql security definer set search_path = public
as $$
declare r public.mtu_khs_records; requester public.profiles; result public.mtu_khs_change_requests; target_role text; target_upt text; target_uit text; effective_gi text; effective_bay text;
begin
  select * into r from public.mtu_khs_records where id = p_record_id for update;
  if not found or not public.mtu_khs_can_access_upt(r.upt_id) then raise exception 'MTU_SCOPE_DENIED'; end if;
  if p_expected_version is null or p_expected_version <> r.version then raise exception 'MTU_VERSION_CONFLICT'; end if;
  effective_gi := case when p_patch ? 'garduIndukId' then nullif(p_patch->>'garduIndukId','') else r.gardu_induk_id end;
  effective_bay := case when p_patch ? 'bayId' then nullif(p_patch->>'bayId','') else r.bay_id end;
  if effective_gi is not null and not exists (select 1 from public.mtu_khs_gardu_induk gi where gi.id = effective_gi and gi.upt_id = r.upt_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if effective_bay is not null and not exists (select 1 from public.mtu_khs_gardu_induk_bay bay join public.mtu_khs_gardu_induk gi on gi.id = bay.gardu_induk_id where bay.id = effective_bay and gi.upt_id = r.upt_id and gi.id = effective_gi) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if p_patch ? 'gudangId' and not exists (select 1 from public.gudang g where g.id = p_patch->>'gudangId' and g.upt_id = r.upt_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if coalesce(p_patch, '{}'::jsonb) ? 'katalogId'
     and not exists (select 1 from public.katalog k where k.id = nullif(btrim(p_patch->>'katalogId'), '')) then
    raise exception 'MTU_MAPPING_REQUIRED';
  end if;
  if exists (select 1 from public.mtu_khs_change_requests where record_id = r.id and patch->>'_idempotency_key' = p_idempotency_key) then select * into result from public.mtu_khs_change_requests where record_id = r.id and patch->>'_idempotency_key' = p_idempotency_key limit 1; return result; end if;
  select * into requester from public.profiles where id = auth.uid();
  if requester.role not in ('TL', 'PENGADAAN', 'SUPERADMIN') then raise exception 'Role tidak boleh mengajukan perubahan MTU'; end if;
  if requester.role = 'TL' and exists (select 1 from jsonb_object_keys(coalesce(p_patch,'{}'::jsonb)) key where key not in ('location','onsiteDate','garduIndukId','bayId','gudangId','serialNumber','installationStatus','installationPlanDate','installationDate','reason')) then raise exception 'MTU_FIELD_FORBIDDEN'; end if;
  if requester.role = 'PENGADAAN' and exists (select 1 from jsonb_object_keys(coalesce(p_patch,'{}'::jsonb)) key where key not in ('vendor','noKontrak','tanggalKontrak','noSpmk','tanggalSerahTerima','price','documentId','mtuCode','katalogId','reason')) then raise exception 'MTU_FIELD_FORBIDDEN'; end if;
  select u.uit_id into target_uit from public.upt u where u.id = r.upt_id;
  if requester.role = 'PENGADAAN' then target_role := 'ASMAN_LOG_UIT'; target_upt := null; else target_role := 'ASMAN'; target_upt := r.upt_id; end if;
  insert into public.mtu_khs_change_requests(id, record_id, requested_by, requester_role, approver_role, approver_upt_id, approver_uit_id, patch)
  values ('MTU-CHG-' || gen_random_uuid()::text, r.id, auth.uid(), requester.role, target_role, target_upt, target_uit, coalesce(p_patch, '{}'::jsonb) || jsonb_build_object('_idempotency_key', p_idempotency_key))
  returning * into result;
  return result;
end;
$$;
create or replace function public.mtu_khs_decide_change(p_change_id text, p_decision text, p_note text default '')
returns public.mtu_khs_change_requests
language plpgsql security definer set search_path = public
as $$
declare c public.mtu_khs_change_requests; r public.mtu_khs_records; p public.profiles; result public.mtu_khs_change_requests;
  new_data jsonb; source_row integer; source_hash text; source_key jsonb; sheet_name text;
begin
  if p_decision not in ('APPROVED', 'REJECTED') then raise exception 'Keputusan approval tidak valid'; end if;
  select * into c from public.mtu_khs_change_requests where id = p_change_id and status = 'PENDING' for update;
  if not found then raise exception 'Perubahan MTU tidak ditemukan atau sudah diputus'; end if;
  select * into r from public.mtu_khs_records where id = c.record_id for update;
  select * into p from public.profiles where id = auth.uid();
  if p.role <> 'SUPERADMIN' and c.approver_role = 'ASMAN' and not (p.role = 'ASMAN' and p.upt_id = c.approver_upt_id) then raise exception 'Bukan ASMAN UPT tujuan'; end if;
  if p.role <> 'SUPERADMIN' and c.approver_role = 'ASMAN_LOG_UIT' and not (p.role = 'ASMAN_LOG_UIT' and p.uit_id = c.approver_uit_id) then raise exception 'Bukan ASMAN_LOG_UIT tujuan'; end if;
  update public.mtu_khs_change_requests set status = p_decision, decision_note = p_note, decided_by = auth.uid(), decided_at = now() where id = c.id returning * into result;
  if p_decision = 'APPROVED' then
    new_data := r.data || (c.patch - '_idempotency_key');
    update public.mtu_khs_records set data = new_data, updated_at = now(), version = version + 1,
      katalog_id = case when c.patch ? 'katalogId' then nullif(btrim(c.patch->>'katalogId'), '') else katalog_id end,
      lifecycle_status = case when c.patch ? 'lifecycleStatus' then nullif(c.patch->>'lifecycleStatus','') else lifecycle_status end,
      gardu_induk_id = case when c.patch ? 'garduIndukId' then nullif(c.patch->>'garduIndukId','') else gardu_induk_id end,
      bay_id = case when c.patch ? 'bayId' then nullif(c.patch->>'bayId','') else bay_id end,
      gudang_id = case when c.patch ? 'gudangId' then nullif(c.patch->>'gudangId','') else gudang_id end
    where id = r.id and version = r.version;
    if not found then raise exception 'MTU_VERSION_CONFLICT'; end if;
    source_row := nullif(r.data->'_migration'->>'sourceRow','')::integer;
    source_hash := coalesce(r.data->'_migration'->>'rawRowSha256','');
    source_key := jsonb_build_object(
      'procurementYear', r.procurement_year,
      'provider', coalesce(r.data->>'vendor',r.data->>'provider',''),
      'uptName', coalesce(r.data->>'uptName',''), 'ultgName', coalesce(r.data->>'ultgName',''),
      'giName', coalesce(r.data->>'giName',''), 'bayName', coalesce(r.data->>'bayName',''),
      'mtuCode', coalesce(r.data->>'mtuCode',''), 'sifatPekerjaan', r.sifat_pekerjaan
    );
    sheet_name := case when r.procurement_year = 2024 then 'Input KHS 2024' when r.procurement_year = 2026 then 'Input KHS 2026' else '' end;
    insert into public.mtu_khs_sheet_sync_jobs(id, change_request_id, record_id, sheet_id, sheet_name, source_row, source_row_sha256, source_key, patch, before_data, after_data)
    values ('MTU-SHEET-' || gen_random_uuid()::text, c.id, r.id, '1Fd978ThcVpCmGEbADILLbjpsGfpWtdKlJdnNdvnzOiw', sheet_name, source_row, source_hash, source_key, c.patch - '_idempotency_key', to_jsonb(r.data), new_data)
    on conflict (change_request_id) do nothing;
  end if;
  return result;
end;
$$;
create or replace function public.mtu_khs_commit_import(p_batch_id text, p_idempotency_key text)
returns integer language plpgsql security definer set search_path = public
as $$
declare b public.mtu_khs_import_batches; row_item record; inserted_count integer := 0;
begin
  select * into b from public.mtu_khs_import_batches where id = p_batch_id for update;
  if not found then raise exception 'MTU_IMPORT_NOT_FOUND'; end if;
  if b.committed_at is not null then
    if b.commit_idempotency_key = p_idempotency_key then return coalesce((b.summary->>'committedCount')::integer, 0); end if;
    raise exception 'MTU_IMPORT_ALREADY_COMMITTED';
  end if;
  if b.status <> 'APPROVED' then raise exception 'MTU_APPROVER_INVALID'; end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('SUPERADMIN','PENGADAAN','ADMIN_LOG_PUSAT')) then raise exception 'MTU_APPROVER_INVALID'; end if;
  if exists (select 1 from public.mtu_khs_import_rows where batch_id = b.id and jsonb_array_length(validation_errors) > 0) then raise exception 'MTU_MAPPING_REQUIRED'; end if;
  for row_item in select * from public.mtu_khs_import_rows where batch_id = b.id order by source_row loop
    if nullif(row_item.normalized_data->>'uptId', '') is null or not exists (select 1 from public.upt where id = row_item.normalized_data->>'uptId' and (b.uit_id is null or uit_id = b.uit_id)) then raise exception 'MTU_MAPPING_REQUIRED'; end if;
    if coalesce((row_item.normalized_data->>'qty')::numeric,0) < 0 then raise exception 'MTU_QTY_INVALID'; end if;
    if nullif(row_item.normalized_data->>'ultgId','') is not null and not exists (select 1 from public.ultg where id = row_item.normalized_data->>'ultgId' and upt_id = row_item.normalized_data->>'uptId') then raise exception 'MTU_HIERARCHY_INVALID'; end if;
    if nullif(row_item.normalized_data->>'garduIndukId','') is not null and not exists (select 1 from public.mtu_khs_gardu_induk gi where gi.id = row_item.normalized_data->>'garduIndukId' and gi.upt_id = row_item.normalized_data->>'uptId') then raise exception 'MTU_HIERARCHY_INVALID'; end if;
    if nullif(row_item.normalized_data->>'bayId','') is not null and not exists (select 1 from public.mtu_khs_gardu_induk_bay bay join public.mtu_khs_gardu_induk gi on gi.id = bay.gardu_induk_id where bay.id = row_item.normalized_data->>'bayId' and gi.upt_id = row_item.normalized_data->>'uptId' and (row_item.normalized_data->>'garduIndukId') = gi.id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
    if nullif(row_item.normalized_data->>'gudangId','') is not null and not exists (select 1 from public.gudang where id = row_item.normalized_data->>'gudangId' and upt_id = row_item.normalized_data->>'uptId') then raise exception 'MTU_HIERARCHY_INVALID'; end if;
    if nullif(row_item.normalized_data->>'mtuSpecId','') is not null and not exists (select 1 from public.mtu_khs_specs where id = row_item.normalized_data->>'mtuSpecId') then raise exception 'MTU_MAPPING_REQUIRED'; end if;
    if nullif(row_item.normalized_data->>'katalogId','') is not null and not exists (select 1 from public.katalog where id = row_item.normalized_data->>'katalogId') then raise exception 'MTU_MAPPING_REQUIRED'; end if;
    if nullif(row_item.normalized_data->>'supplierId','') is not null and not exists (select 1 from public.supplier where id = row_item.normalized_data->>'supplierId') then raise exception 'MTU_MAPPING_REQUIRED'; end if;
    insert into public.mtu_khs_records(id, upt_id, ultg_id, gardu_induk_id, bay_id, gudang_id, mtu_spec_id, katalog_id, supplier_id, procurement_year, sifat_pekerjaan, qty, data, created_by)
    values ('MTU-' || gen_random_uuid()::text, row_item.normalized_data->>'uptId', nullif(row_item.normalized_data->>'ultgId',''), nullif(row_item.normalized_data->>'garduIndukId',''), nullif(row_item.normalized_data->>'bayId',''), nullif(row_item.normalized_data->>'gudangId',''), nullif(row_item.normalized_data->>'mtuSpecId',''), nullif(row_item.normalized_data->>'katalogId',''), nullif(row_item.normalized_data->>'supplierId',''), b.procurement_year, coalesce(row_item.normalized_data->>'sifatPekerjaan','MATERIAL'), case when coalesce(row_item.normalized_data->>'sifatPekerjaan','MATERIAL') = 'SUPERVISI' then 0 else coalesce((row_item.normalized_data->>'qty')::numeric,0) end, row_item.normalized_data, auth.uid());
    inserted_count := inserted_count + 1;
  end loop;
  update public.mtu_khs_import_batches set status = 'APPROVED', committed_at = now(), commit_idempotency_key = p_idempotency_key, summary = summary || jsonb_build_object('committedCount', inserted_count) where id = b.id;
  return inserted_count;
end;
$$;
create or replace function public.mtu_khs_decide_import(p_batch_id text, p_decision text, p_note text default '')
returns public.mtu_khs_import_batches language plpgsql security definer set search_path = public
as $$
declare b public.mtu_khs_import_batches; p public.profiles; result public.mtu_khs_import_batches;
begin
  select * into b from public.mtu_khs_import_batches where id = p_batch_id for update;
  if not found then raise exception 'MTU_IMPORT_NOT_FOUND'; end if;
  select * into p from public.profiles where id = auth.uid();
  if not found or p_decision not in ('APPROVED','REJECTED') then raise exception 'MTU_APPROVER_INVALID'; end if;
  -- SUPERADMIN is the project-wide emergency approver; normal approvals stay UIT-scoped.
  if p.role <> 'SUPERADMIN' and (p.role <> 'ASMAN_LOG_UIT' or p.uit_id is distinct from b.uit_id) then raise exception 'MTU_APPROVER_INVALID'; end if;
  update public.mtu_khs_import_batches set status = p_decision, summary = summary || jsonb_build_object('approvalNote', p_note), committed_at = case when p_decision = 'REJECTED' then null else committed_at end where id = b.id returning * into result;
  return result;
end;
$$;
create or replace function public.mtu_khs_attach_document(p_record_id text, p_document_id text)
returns boolean language plpgsql security definer set search_path = public
as $$
declare r public.mtu_khs_records; d public.mtu_khs_documents;
begin
  select * into r from public.mtu_khs_records where id = p_record_id for update;
  select * into d from public.mtu_khs_documents where id = p_document_id;
  if not found or not public.mtu_khs_can_access_upt(r.upt_id) or not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('SUPERADMIN','PENGADAAN')) then raise exception 'MTU_SCOPE_DENIED'; end if;
  if d.procurement_year <> r.procurement_year or upper(d.vendor) <> upper(coalesce(r.data->>'vendor','')) or d.mtu_code <> coalesce(r.data->>'mtuCode','') then raise exception 'MTU_DRAWING_YEAR_MISMATCH'; end if;
  insert into public.mtu_khs_record_documents(record_id, document_id, created_by) values (r.id, d.id, auth.uid()) on conflict do nothing;
  return true;
end;
$$;
create or replace function public.mtu_khs_register_document(p_id text, p_record_id text, p_document_type text, p_title text, p_url text, p_revision text default '')
returns public.mtu_khs_documents language plpgsql security definer set search_path = public
as $$
declare r public.mtu_khs_records; result public.mtu_khs_documents; vendor_name text; code text;
begin
  select * into r from public.mtu_khs_records where id = p_record_id;
  if not found or not public.mtu_khs_can_access_upt(r.upt_id) or p_url !~* '^https://' or not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('SUPERADMIN','PENGADAAN')) then raise exception 'MTU_SCOPE_DENIED'; end if;
  vendor_name := coalesce(r.data->>'vendor',''); code := coalesce(r.data->>'mtuCode','');
  insert into public.mtu_khs_documents(id, vendor, procurement_year, mtu_code, document_type, revision, title, url, data) values (p_id, vendor_name, r.procurement_year, code, p_document_type, coalesce(p_revision,''), p_title, p_url, jsonb_build_object('recordId', r.id)) on conflict (id) do update set title = excluded.title, url = excluded.url, revision = excluded.revision returning * into result;
  insert into public.mtu_khs_record_documents(record_id, document_id, created_by) values (r.id, result.id, auth.uid()) on conflict do nothing;
  return result;
end;
$$;
create or replace function public.mtu_khs_link_approved_tug(p_record_id text, p_tug_item_id uuid, p_qty numeric)
returns public.mtu_khs_usage_links language plpgsql security definer set search_path = public
as $$
declare r public.mtu_khs_records; i public.tug_items; t public.tug_transactions; result public.mtu_khs_usage_links;
begin
  select * into r from public.mtu_khs_records where id = p_record_id for update;
  select * into i from public.tug_items where id = p_tug_item_id;
  select * into t from public.tug_transactions where id = i.transaction_id;
  if r.id is null or i.id is null or t.id is null or r.sifat_pekerjaan = 'SUPERVISI' or not public.mtu_khs_can_access_upt(r.upt_id)
     or t.upt_id <> r.upt_id or t.doc_type not in ('TUG8','TUG9') or t.status <> 'FINAL_APPROVED'
     or i.katalog_id is distinct from r.katalog_id
     or not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('SUPERADMIN','PENGADAAN','TL')) then
    raise exception 'MTU_TUG_NOT_APPROVED';
  end if;
  if p_qty is null or p_qty <= 0 or p_qty > i.qty then raise exception 'MTU_TUG_NOT_APPROVED'; end if;
  if exists (select 1 from public.mtu_khs_usage_links where mtu_record_id = r.id and tug_item_id = p_tug_item_id::text) then raise exception 'MTU_TUG_NOT_APPROVED'; end if;
  if coalesce((select sum(qty) from public.mtu_khs_usage_links where mtu_record_id = r.id and status = 'APPROVED'),0) + p_qty > r.qty then raise exception 'MTU_TUG_NOT_APPROVED'; end if;
  insert into public.mtu_khs_usage_links(id, mtu_record_id, tug_item_id, qty, status, created_by, data)
  values ('MTU-USE-' || gen_random_uuid()::text, r.id, p_tug_item_id::text, p_qty, 'APPROVED', auth.uid(),
    jsonb_build_object('docNumber', t.doc_number, 'docType', t.doc_type, 'finalApprovedAt', t.final_approved_at,
      'katalogId', i.katalog_id, 'uptId', t.upt_id)) returning * into result;
  return result;
end;
$$;
create or replace function public.mtu_khs_upsert_gardu_induk(p_id text, p_ultg_id text, p_data jsonb)
returns public.mtu_khs_gardu_induk language plpgsql security definer set search_path = public
as $$
declare result public.mtu_khs_gardu_induk; target_upt text; target_name text;
begin
  select u.upt_id into target_upt from public.ultg u where u.id = p_ultg_id;
  target_name := upper(regexp_replace(btrim(coalesce(p_data->>'normalizedName', p_data->>'nama', p_data->>'name', p_id)), '\s+', ' ', 'g'));
  if target_upt is null or target_name = '' then raise exception 'MTU_MASTER_INVALID'; end if;
  if not public.mtu_khs_can_access_upt(target_upt) then raise exception 'MTU_SCOPE_DENIED'; end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('SUPERADMIN','ADMIN_LOG_PUSAT','ADMIN_UIT','TL')) then raise exception 'MTU_SCOPE_DENIED'; end if;
  insert into public.mtu_khs_gardu_induk(id, upt_id, ultg_id, normalized_name, data, created_by) values (p_id, target_upt, p_ultg_id, target_name, coalesce(p_data,'{}'::jsonb) || jsonb_build_object('normalizedName', target_name), auth.uid()) on conflict (id) do update set upt_id = excluded.upt_id, ultg_id = excluded.ultg_id, normalized_name = excluded.normalized_name, data = excluded.data, updated_at = now() returning * into result;
  return result;
end;
$$;
create or replace function public.mtu_khs_upsert_bay(p_id text, p_gardu_induk_id text, p_data jsonb)
returns public.mtu_khs_gardu_induk_bay language plpgsql security definer set search_path = public
as $$
declare result public.mtu_khs_gardu_induk_bay; target_upt text; target_name text;
begin
  select gi.upt_id into target_upt from public.mtu_khs_gardu_induk gi where gi.id = p_gardu_induk_id;
  target_name := upper(regexp_replace(btrim(coalesce(p_data->>'normalizedName', p_data->>'nama', p_data->>'name', p_id)), '\s+', ' ', 'g'));
  if target_upt is null or target_name = '' then raise exception 'MTU_MASTER_INVALID'; end if;
  if not public.mtu_khs_can_access_upt(target_upt) then raise exception 'MTU_SCOPE_DENIED'; end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('SUPERADMIN','ADMIN_LOG_PUSAT','ADMIN_UIT','TL')) then raise exception 'MTU_SCOPE_DENIED'; end if;
  insert into public.mtu_khs_gardu_induk_bay(id, gardu_induk_id, normalized_name, data, created_by) values (p_id, p_gardu_induk_id, target_name, coalesce(p_data,'{}'::jsonb) || jsonb_build_object('normalizedName', target_name), auth.uid()) on conflict (id) do update set gardu_induk_id = excluded.gardu_induk_id, normalized_name = excluded.normalized_name, data = excluded.data, updated_at = now() returning * into result;
  return result;
end;
$$;
create or replace function public.mtu_khs_deactivate_site_master(p_table_name text, p_id text)
returns boolean language plpgsql security definer set search_path = public
as $$
declare target_upt text; in_use boolean := false;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('SUPERADMIN','ADMIN_LOG_PUSAT','ADMIN_UIT','TL')) then raise exception 'MTU_SCOPE_DENIED'; end if;
  if p_table_name = 'mtu_khs_gardu_induk' then
    select gi.upt_id into target_upt from public.mtu_khs_gardu_induk gi where gi.id = p_id;
    if not public.mtu_khs_can_access_upt(target_upt) then raise exception 'MTU_SCOPE_DENIED'; end if;
    select exists (select 1 from public.mtu_khs_records where gardu_induk_id = p_id) into in_use;
    if in_use then raise exception 'MTU_MASTER_IN_USE'; end if;
    update public.mtu_khs_gardu_induk set active = false, updated_at = now() where id = p_id;
  elsif p_table_name = 'mtu_khs_gardu_induk_bay' then
    select gi.upt_id into target_upt from public.mtu_khs_gardu_induk_bay bay join public.mtu_khs_gardu_induk gi on gi.id = bay.gardu_induk_id where bay.id = p_id;
    if not public.mtu_khs_can_access_upt(target_upt) then raise exception 'MTU_SCOPE_DENIED'; end if;
    select exists (select 1 from public.mtu_khs_records where bay_id = p_id) into in_use;
    if in_use then raise exception 'MTU_MASTER_IN_USE'; end if;
    update public.mtu_khs_gardu_induk_bay set active = false, updated_at = now() where id = p_id;
  else raise exception 'MTU_MASTER_INVALID'; end if;
  return true;
end;
$$;
create or replace function public.mtu_khs_stage_import(p_batch_id text, p_procurement_year integer, p_uit_id text, p_source_file text, p_file_sha256 text, p_sheet_name text, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public
as $$
declare actor public.profiles; row_item jsonb; n integer := 0;
begin
  select * into actor from public.profiles where id = auth.uid();
  if actor.role not in ('SUPERADMIN','PENGADAAN','ADMIN_LOG_PUSAT') then raise exception 'MTU_SCOPE_DENIED'; end if;
  if exists (select 1 from public.mtu_khs_import_batches where file_sha256 = coalesce(p_file_sha256,'') and sheet_name = coalesce(p_sheet_name,'')) then raise exception 'MTU_IMPORT_ALREADY_STAGED'; end if;
  insert into public.mtu_khs_import_batches(id, procurement_year, uit_id, source_file, file_sha256, sheet_name, status, created_by) values (p_batch_id, p_procurement_year, p_uit_id, p_source_file, coalesce(p_file_sha256,''), coalesce(p_sheet_name,''), 'REVIEW', auth.uid());
  for row_item in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    insert into public.mtu_khs_import_rows(id, batch_id, source_row, raw_data, normalized_data, validation_errors, duplicate_candidate, raw_row_sha256) values (p_batch_id || '-' || n::text, p_batch_id, coalesce((row_item->>'rowNumber')::integer,n), coalesce(row_item->'rawData','{}'::jsonb), coalesce(row_item->'source','{}'::jsonb), coalesce(row_item->'validation'->'errors','[]'::jsonb), coalesce((row_item->>'duplicateCandidate')::boolean,false), coalesce(row_item->>'rawRowSha256',''));
    n := n + 1;
  end loop;
  return n;
end;
$$;
create or replace function public.mtu_khs_update_import_row_mapping(p_row_id text, p_mapping jsonb)
returns public.mtu_khs_import_rows language plpgsql security definer set search_path = public
as $$
declare row_item public.mtu_khs_import_rows; batch_item public.mtu_khs_import_batches; actor public.profiles; merged jsonb; errors text[] := ARRAY[]::text[]; target_upt text; target_ultg text; target_gi text; target_bay text; target_gudang text;
begin
  select * into row_item from public.mtu_khs_import_rows where id = p_row_id for update;
  if not found then raise exception 'MTU_IMPORT_ROW_NOT_FOUND'; end if;
  select * into batch_item from public.mtu_khs_import_batches where id = row_item.batch_id;
  select * into actor from public.profiles where id = auth.uid();
  if actor.role not in ('SUPERADMIN','PENGADAAN','ADMIN_LOG_PUSAT','ASMAN_LOG_UIT') then raise exception 'MTU_SCOPE_DENIED'; end if;
  if actor.role = 'ASMAN_LOG_UIT' and actor.uit_id is distinct from batch_item.uit_id then raise exception 'MTU_SCOPE_DENIED'; end if;
  if batch_item.status not in ('STAGED','REVIEW') then raise exception 'MTU_IMPORT_ALREADY_COMMITTED'; end if;
  merged := row_item.normalized_data || coalesce(p_mapping, '{}'::jsonb);
  target_upt := nullif(merged->>'uptId',''); target_ultg := nullif(merged->>'ultgId',''); target_gi := nullif(merged->>'garduIndukId',''); target_bay := nullif(merged->>'bayId',''); target_gudang := nullif(merged->>'gudangId','');
  if target_upt is null or not exists (select 1 from public.upt where id = target_upt) then errors := errors || 'MTU_MAPPING_REQUIRED:UPT'; end if;
  if batch_item.uit_id is not null and target_upt is not null and not exists (select 1 from public.upt where id = target_upt and uit_id = batch_item.uit_id) then errors := errors || 'MTU_HIERARCHY_INVALID:UPT_UIT'; end if;
  if target_ultg is not null and not exists (select 1 from public.ultg where id = target_ultg and upt_id = target_upt) then errors := errors || 'MTU_HIERARCHY_INVALID:ULTG'; end if;
  if nullif(merged->>'giName','') is not null and target_gi is null and target_bay is null and target_gudang is null then errors := errors || 'MTU_MAPPING_REQUIRED:SITE'; end if;
  if target_gi is not null and not exists (select 1 from public.mtu_khs_gardu_induk gi where gi.id = target_gi and gi.upt_id = target_upt) then errors := errors || 'MTU_HIERARCHY_INVALID:GI'; end if;
  if target_bay is not null and not exists (select 1 from public.mtu_khs_gardu_induk_bay bay join public.mtu_khs_gardu_induk gi on gi.id = bay.gardu_induk_id where bay.id = target_bay and gi.upt_id = target_upt and (target_gi is null or gi.id = target_gi)) then errors := errors || 'MTU_HIERARCHY_INVALID:BAY'; end if;
  if target_gudang is not null and not exists (select 1 from public.gudang where id = target_gudang and upt_id = target_upt) then errors := errors || 'MTU_HIERARCHY_INVALID:GUDANG'; end if;
  if nullif(merged->>'provider','') is not null and nullif(merged->>'supplierId','') is null then errors := errors || 'MTU_MAPPING_REQUIRED:SUPPLIER'; end if;
  if nullif(merged->>'supplierId','') is not null and not exists (select 1 from public.supplier where id = merged->>'supplierId') then errors := errors || 'MTU_MAPPING_INVALID:SUPPLIER'; end if;
  if nullif(merged->>'mtuCode','') is not null and nullif(merged->>'mtuSpecId','') is null and nullif(merged->>'katalogId','') is null then errors := errors || 'MTU_MAPPING_REQUIRED:SPEC'; end if;
  if nullif(merged->>'mtuSpecId','') is not null and not exists (select 1 from public.mtu_khs_specs where id = merged->>'mtuSpecId') then errors := errors || 'MTU_MAPPING_INVALID:SPEC'; end if;
  if nullif(merged->>'katalogId','') is not null and not exists (select 1 from public.katalog where id = merged->>'katalogId') then errors := errors || 'MTU_MAPPING_INVALID:KATALOG'; end if;
  update public.mtu_khs_import_rows set normalized_data = merged, validation_errors = to_jsonb(errors) where id = row_item.id returning * into row_item;
  return row_item;
end;
$$;
create or replace function public.mtu_khs_set_reconciliation(
  p_record_id text,
  p_status text,
  p_note text default ''
) returns public.mtu_khs_reconciliations
language plpgsql security definer set search_path = public
as $$
declare r public.mtu_khs_records; a public.profiles; result public.mtu_khs_reconciliations;
begin
  select * into r from public.mtu_khs_records where id = p_record_id for update;
  select * into a from public.profiles where id = auth.uid();
  if not found or r.id is null or r.procurement_year <> 2024 or r.sifat_pekerjaan = 'SUPERVISI'
     or p_status not in ('BELUM_DICEK', 'BELUM_TUG', 'SEBAGIAN', 'SUDAH_TUG')
     or not public.mtu_khs_can_access_upt(r.upt_id)
     or not (a.role = 'SUPERADMIN' or (a.role = 'TL' and a.upt_id = r.upt_id)) then
    raise exception 'MTU_RECONCILIATION_FORBIDDEN' using errcode = '42501';
  end if;
  insert into public.mtu_khs_reconciliations(record_id, status, note, updated_by, updated_at)
  values (r.id, p_status, left(coalesce(p_note, ''), 2000), a.id, now())
  on conflict (record_id) do update set status = excluded.status, note = excluded.note,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at
  returning * into result;
  return result;
end;
$$;
create or replace function public.mtu_khs_link_stock(
  p_record_id text,
  p_stock_id text,
  p_qty numeric
) returns public.mtu_khs_stock_links
language plpgsql security definer set search_path = public
as $$
declare r public.mtu_khs_records; s public.stocks; a public.profiles; result public.mtu_khs_stock_links;
  max_qty numeric; linked_qty numeric;
begin
  select * into r from public.mtu_khs_records where id = p_record_id for update;
  select * into s from public.stocks where id = p_stock_id;
  select * into a from public.profiles where id = auth.uid();
  if r.id is null or s.id is null or p_qty is null or p_qty <= 0
     or r.procurement_year <> 2024 or r.sifat_pekerjaan = 'SUPERVISI'
     or r.katalog_id is null or s.katalog_id is distinct from r.katalog_id
     or coalesce(s.upt_id, (select g.upt_id from public.lokasi l join public.gudang g on g.id = l.gudang_id where l.id = s.lokasi_id)) <> r.upt_id
     or not exists (
       select 1 from public.lokasi l join public.gudang g on g.id = l.gudang_id
       where l.id = s.lokasi_id and g.upt_id = r.upt_id
     )
     or not public.mtu_khs_can_access_upt(r.upt_id)
     or not (a.role = 'SUPERADMIN' or (a.role = 'TL' and a.upt_id = r.upt_id)) then
    raise exception 'MTU_STOCK_REFERENCE_INVALID';
  end if;
  max_qty := greatest(0, coalesce(nullif(r.data->>'remainingQty','')::numeric,
    r.qty - coalesce(nullif(r.data->>'installedQty','')::numeric, 0)));
  select coalesce(sum(qty), 0) into linked_qty from public.mtu_khs_stock_links where mtu_record_id = r.id and stock_id <> s.id;
  if linked_qty + p_qty > max_qty then raise exception 'MTU_STOCK_REFERENCE_QTY_EXCEEDED'; end if;
  insert into public.mtu_khs_stock_links(mtu_record_id, stock_id, qty, created_by, updated_by)
  values (r.id, s.id, p_qty, a.id, a.id)
  on conflict (mtu_record_id, stock_id) do update set qty = excluded.qty, updated_by = excluded.updated_by, updated_at = now()
  returning * into result;
  return result;
end;
$$;
create or replace function public.mtu_khs_update_operational(p_record_id text, p_expected_version integer, p_patch jsonb, p_idempotency_key text)
returns public.mtu_khs_records language plpgsql security definer set search_path = public as $$
declare r public.mtu_khs_records; actor public.profiles; result public.mtu_khs_records; patch jsonb := coalesce(p_patch, '{}'::jsonb); effective_ultg text; effective_gi text; effective_bay text; effective_gudang text; effective_lokasi text; selected_katalog text; katalog_snapshot jsonb;
begin
  select * into actor from public.profiles where id = auth.uid();
  if actor.role not in ('TL','SUPERADMIN') then raise exception 'MTU_ROLE_DENIED'; end if;
  select * into r from public.mtu_khs_records where id = p_record_id for update;
  if not found or not public.mtu_khs_can_access_upt(r.upt_id) then raise exception 'MTU_SCOPE_DENIED'; end if;
  if exists (select 1 from public.mtu_khs_record_events where record_id = r.id and idempotency_key = p_idempotency_key and event_type = 'OPERATIONAL_UPDATE') then select * into result from public.mtu_khs_records where id = r.id; return result; end if;
  if p_expected_version is distinct from r.version then raise exception 'MTU_VERSION_CONFLICT'; end if;
  if exists (select 1 from jsonb_object_keys(patch) k where k not in ('katalogId','lifecycleStatus','gudangId','lokasiId','ultgId','garduIndukId','bayId')) then raise exception 'MTU_FIELD_FORBIDDEN'; end if;
  if patch ? 'katalogId' and nullif(patch->>'katalogId','') is null then raise exception 'MTU_CATALOG_REQUIRED'; end if;
  if patch ? 'katalogId' and nullif(patch->>'katalogId','') is not null and not exists (select 1 from public.katalog where id = patch->>'katalogId') then raise exception 'MTU_CATALOG_INVALID'; end if;
  if patch ? 'katalogId' and nullif(patch->>'katalogId','') is distinct from r.katalog_id and (exists (select 1 from public.mtu_khs_receipts where mtu_record_id=r.id) or exists (select 1 from public.mtu_khs_usage_links where mtu_record_id=r.id and status='APPROVED') or exists (select 1 from public.mtu_khs_stock_links where mtu_record_id=r.id)) then raise exception 'MTU_CATALOG_LOCKED'; end if;
  if patch ? 'lifecycleStatus' and (patch->>'lifecycleStatus') not in ('VENDOR','IN_TRANSIT','WAREHOUSE','ON_SITE','INSTALLED','PLANNED_ARRIVAL','CANCELLED') then raise exception 'MTU_STATUS_INVALID'; end if;
  effective_ultg := case when patch ? 'ultgId' then nullif(patch->>'ultgId','') else r.ultg_id end;
  effective_gi := case when patch ? 'garduIndukId' then nullif(patch->>'garduIndukId','') else r.gardu_induk_id end;
  effective_bay := case when patch ? 'bayId' then nullif(patch->>'bayId','') else r.bay_id end;
  effective_gudang := case when patch ? 'gudangId' then nullif(patch->>'gudangId','') else r.gudang_id end;
  effective_lokasi := case when patch ? 'lokasiId' then nullif(patch->>'lokasiId','') else r.lokasi_id end;
  if effective_ultg is not null and not exists (select 1 from public.ultg where id = effective_ultg and upt_id = r.upt_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if effective_gi is not null and not exists (select 1 from public.mtu_khs_gardu_induk where id = effective_gi and upt_id = r.upt_id and (effective_ultg is null or ultg_id = effective_ultg)) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if effective_bay is not null and not exists (select 1 from public.mtu_khs_gardu_induk_bay b join public.mtu_khs_gardu_induk g on g.id=b.gardu_induk_id where b.id=effective_bay and g.upt_id=r.upt_id and g.id=effective_gi) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if effective_gudang is not null and not exists (select 1 from public.gudang where id=effective_gudang and upt_id=r.upt_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if effective_lokasi is not null and not exists (select 1 from public.lokasi l join public.gudang g on g.id=l.gudang_id where l.id=effective_lokasi and g.upt_id=r.upt_id and (effective_gudang is null or g.id=effective_gudang)) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  selected_katalog := case when patch ? 'katalogId' then nullif(patch->>'katalogId','') else r.katalog_id end;
  select coalesce(data,'{}'::jsonb) into katalog_snapshot from public.katalog where id=selected_katalog;
  if selected_katalog is not null and (
    nullif(coalesce(katalog_snapshot->>'katalog',katalog_snapshot->>'kode',katalog_snapshot->>'kode_material',katalog_snapshot->>'code',katalog_snapshot->'mara'->>'katalog',katalog_snapshot->'mara'->>'kode_material'),'') is null or
    nullif(coalesce(katalog_snapshot->>'name',katalog_snapshot->>'nama',katalog_snapshot->>'nama_material',katalog_snapshot->>'materialDescription',katalog_snapshot->'mara'->>'name',katalog_snapshot->'mara'->>'nama'),'') is null or
    nullif(coalesce(katalog_snapshot->>'description',katalog_snapshot->>'deskripsi',katalog_snapshot->>'materialDescription',katalog_snapshot->>'name',katalog_snapshot->>'nama',katalog_snapshot->'mara'->>'description',katalog_snapshot->'mara'->>'deskripsi',katalog_snapshot->'mara'->>'name',katalog_snapshot->'mara'->>'nama'),'') is null or
    nullif(coalesce(katalog_snapshot->>'satuan',katalog_snapshot->>'unit',katalog_snapshot->'mara'->>'satuan',katalog_snapshot->'mara'->>'unit'),'') is null
  ) then raise exception 'MTU_CATALOG_SNAPSHOT_INVALID'; end if;
  update public.mtu_khs_records set katalog_id = selected_katalog, lifecycle_status = case when patch ? 'lifecycleStatus' then patch->>'lifecycleStatus' else lifecycle_status end, ultg_id = effective_ultg, gudang_id = effective_gudang, lokasi_id = effective_lokasi, gardu_induk_id = effective_gi, bay_id = effective_bay, data = data || patch || jsonb_strip_nulls(jsonb_build_object('katalogId',selected_katalog,'catalogNumber',coalesce(katalog_snapshot->>'katalog',katalog_snapshot->>'kode',katalog_snapshot->>'kode_material',katalog_snapshot->>'code',katalog_snapshot->'mara'->>'katalog',katalog_snapshot->'mara'->>'kode_material'), 'materialName',coalesce(katalog_snapshot->>'name',katalog_snapshot->>'nama',katalog_snapshot->>'nama_material',katalog_snapshot->>'materialDescription',katalog_snapshot->'mara'->>'name',katalog_snapshot->'mara'->>'nama'), 'materialDescription',coalesce(katalog_snapshot->>'description',katalog_snapshot->>'deskripsi',katalog_snapshot->>'materialDescription',katalog_snapshot->>'name',katalog_snapshot->>'nama',katalog_snapshot->'mara'->>'description',katalog_snapshot->'mara'->>'deskripsi',katalog_snapshot->'mara'->>'name',katalog_snapshot->'mara'->>'nama'), 'unit',coalesce(katalog_snapshot->>'satuan',katalog_snapshot->>'unit',katalog_snapshot->'mara'->>'satuan',katalog_snapshot->'mara'->>'unit'), 'satuan',coalesce(katalog_snapshot->>'satuan',katalog_snapshot->>'unit',katalog_snapshot->'mara'->>'satuan',katalog_snapshot->'mara'->>'unit'), 'qty',qty,'physicalQty',qty)), version = version + 1, updated_at = now() where id=r.id returning * into result;
  insert into public.mtu_khs_record_events(record_id,event_type,actor_id,source_upt_id,before_data,after_data,metadata,idempotency_key) values (r.id,'OPERATIONAL_UPDATE',auth.uid(),r.upt_id,to_jsonb(r),to_jsonb(result),jsonb_build_object('patch',patch),p_idempotency_key);
  return result;
end; $$;
create or replace function public.mtu_khs_request_transfer(p_record_id text, p_expected_version integer, p_qty numeric, p_target_upt_id text, p_target_ultg_id text, p_target_gardu_induk_id text, p_target_bay_id text, p_target_gudang_id text, p_target_lokasi_id text, p_note text, p_idempotency_key text)
returns public.mtu_khs_transfer_requests language plpgsql security definer set search_path = public as $$
declare r public.mtu_khs_records; actor public.profiles; result public.mtu_khs_transfer_requests; available numeric;
begin
  select * into actor from public.profiles where id=auth.uid(); if actor.role not in ('TL','SUPERADMIN') then raise exception 'MTU_ROLE_DENIED'; end if;
  select * into r from public.mtu_khs_records where id=p_record_id for update; if not found or not public.mtu_khs_can_access_upt(r.upt_id) then raise exception 'MTU_SCOPE_DENIED'; end if;
  select * into result from public.mtu_khs_transfer_requests where source_record_id=r.id and idempotency_key=p_idempotency_key; if found then return result; end if;
  if r.version is distinct from p_expected_version then raise exception 'MTU_VERSION_CONFLICT'; end if;
  if r.sifat_pekerjaan = 'SUPERVISI' or p_qty is null or p_qty <= 0 then raise exception 'MTU_QTY_INVALID'; end if;
  if r.upt_id = p_target_upt_id then raise exception 'MTU_TRANSFER_SAME_UPT'; end if;
  if not exists (select 1 from public.upt a join public.upt b on b.id=p_target_upt_id where a.id=r.upt_id and a.uit_id is not null and a.uit_id=b.uit_id) then raise exception 'MTU_TRANSFER_CROSS_UIT'; end if;
  if (p_target_gudang_id is null) <> (p_target_lokasi_id is null) then raise exception 'MTU_TARGET_LOCATION_REQUIRED'; end if;
  if (p_target_ultg_id is not null or p_target_gardu_induk_id is not null or p_target_bay_id is not null) and (p_target_ultg_id is null or p_target_gardu_induk_id is null or p_target_bay_id is null) then raise exception 'MTU_TARGET_HIERARCHY_REQUIRED'; end if;
  if (p_target_gardu_induk_id is null or p_target_bay_id is null) and p_target_gudang_id is null then raise exception 'MTU_TARGET_LOCATION_REQUIRED'; end if;
  if p_target_gudang_id is not null and not exists (select 1 from public.gudang where id=p_target_gudang_id and upt_id=p_target_upt_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if p_target_lokasi_id is not null and not exists (select 1 from public.lokasi l join public.gudang g on g.id=l.gudang_id where l.id=p_target_lokasi_id and g.upt_id=p_target_upt_id and g.id=p_target_gudang_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if p_target_ultg_id is not null and not exists (select 1 from public.ultg where id=p_target_ultg_id and upt_id=p_target_upt_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if p_target_gardu_induk_id is not null and not exists (select 1 from public.mtu_khs_gardu_induk where id=p_target_gardu_induk_id and upt_id=p_target_upt_id and (p_target_ultg_id is null or ultg_id=p_target_ultg_id)) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if p_target_bay_id is not null and not exists (select 1 from public.mtu_khs_gardu_induk_bay where id=p_target_bay_id and gardu_induk_id=p_target_gardu_induk_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  available := r.qty - greatest(coalesce((select sum(qty) from public.mtu_khs_receipts where mtu_record_id=r.id),0), coalesce((select sum(qty) from public.mtu_khs_usage_links where mtu_record_id=r.id and status='APPROVED'),0), coalesce((select sum(qty) from public.mtu_khs_stock_links where mtu_record_id=r.id),0));
  if p_qty > available then raise exception 'MTU_QTY_BOUND'; end if;
  insert into public.mtu_khs_record_events(record_id,event_type,actor_id,source_upt_id,target_upt_id,metadata,idempotency_key) values (r.id,'TRANSFER_REQUESTED',auth.uid(),r.upt_id,p_target_upt_id,jsonb_build_object('qty',p_qty,'targetGudangId',p_target_gudang_id,'targetLokasiId',p_target_lokasi_id),p_idempotency_key);
  insert into public.mtu_khs_transfer_requests(source_record_id,source_version,idempotency_key,source_upt_id,target_upt_id,target_ultg_id,target_gardu_induk_id,target_bay_id,target_gudang_id,target_lokasi_id,qty,note,requested_by,before_snapshot) values (r.id,r.version,p_idempotency_key,r.upt_id,p_target_upt_id,p_target_ultg_id,p_target_gardu_induk_id,p_target_bay_id,p_target_gudang_id,p_target_lokasi_id,p_qty,coalesce(p_note,''),auth.uid(),to_jsonb(r)) returning * into result;
  return result;
end; $$;
create or replace function public.mtu_khs_decide_transfer(p_request_id uuid, p_decision text, p_note text default '')
returns public.mtu_khs_transfer_requests language plpgsql security definer set search_path = public as $$
declare t public.mtu_khs_transfer_requests; r public.mtu_khs_records; actor public.profiles; result public.mtu_khs_transfer_requests; available numeric; new_id text; target_data jsonb;
begin
  if p_decision not in ('APPROVED','REJECTED') then raise exception 'MTU_TRANSFER_DECISION_INVALID'; end if;
  select * into t from public.mtu_khs_transfer_requests where id=p_request_id for update; if not found then raise exception 'MTU_TRANSFER_NOT_FOUND'; end if;
  select * into actor from public.profiles where id=auth.uid(); if actor.role <> 'SUPERADMIN' and not (actor.role='ASMAN' and actor.upt_id=t.source_upt_id) then raise exception 'MTU_TRANSFER_APPROVER_INVALID'; end if;
  if t.status <> 'PENDING' then return t; end if;
  if p_decision = 'REJECTED' then update public.mtu_khs_transfer_requests set status='REJECTED',decision_note=coalesce(p_note,''),decided_by=auth.uid(),decided_at=now() where id=t.id returning * into result; insert into public.mtu_khs_record_events(record_id,event_type,actor_id,source_upt_id,target_upt_id,metadata,idempotency_key) values (t.source_record_id,'TRANSFER_REJECTED',auth.uid(),t.source_upt_id,t.target_upt_id,jsonb_build_object('transferId',t.id,'note',p_note),t.id::text); return result; end if;
  select * into r from public.mtu_khs_records where id=t.source_record_id for update; if not found or r.version is distinct from t.source_version then raise exception 'MTU_VERSION_CONFLICT'; end if;
  if not exists (select 1 from public.upt a join public.upt b on b.id=t.target_upt_id where a.id=r.upt_id and a.uit_id is not null and a.uit_id=b.uit_id) then raise exception 'MTU_TRANSFER_CROSS_UIT'; end if;
  if (t.target_gudang_id is null) <> (t.target_lokasi_id is null) then raise exception 'MTU_TARGET_LOCATION_REQUIRED'; end if;
  if (t.target_ultg_id is not null or t.target_gardu_induk_id is not null or t.target_bay_id is not null) and (t.target_ultg_id is null or t.target_gardu_induk_id is null or t.target_bay_id is null) then raise exception 'MTU_TARGET_HIERARCHY_REQUIRED'; end if;
  if (t.target_gardu_induk_id is null or t.target_bay_id is null) and t.target_gudang_id is null then raise exception 'MTU_TARGET_LOCATION_REQUIRED'; end if;
  if t.target_gudang_id is not null and not exists (select 1 from public.gudang where id=t.target_gudang_id and upt_id=t.target_upt_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if t.target_lokasi_id is not null and not exists (select 1 from public.lokasi l join public.gudang g on g.id=l.gudang_id where l.id=t.target_lokasi_id and g.upt_id=t.target_upt_id and g.id=t.target_gudang_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if t.target_ultg_id is not null and not exists (select 1 from public.ultg where id=t.target_ultg_id and upt_id=t.target_upt_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if t.target_gardu_induk_id is not null and not exists (select 1 from public.mtu_khs_gardu_induk where id=t.target_gardu_induk_id and upt_id=t.target_upt_id and ultg_id=t.target_ultg_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if t.target_bay_id is not null and not exists (select 1 from public.mtu_khs_gardu_induk_bay where id=t.target_bay_id and gardu_induk_id=t.target_gardu_induk_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  select r.data || jsonb_strip_nulls(jsonb_build_object(
    'uptId',t.target_upt_id,
    'uptName',coalesce(u.data->>'nama',u.data->>'name',u.id),
    'ultgId',t.target_ultg_id,
    'ultgName',(select coalesce(x.data->>'nama',x.data->>'name',x.id) from public.ultg x where x.id=t.target_ultg_id),
    'garduIndukId',t.target_gardu_induk_id,
    'giName',(select coalesce(x.data->>'nama',x.data->>'name',x.id) from public.mtu_khs_gardu_induk x where x.id=t.target_gardu_induk_id),
    'bayId',t.target_bay_id,
    'bayName',(select coalesce(x.data->>'nama',x.data->>'name',x.id) from public.mtu_khs_gardu_induk_bay x where x.id=t.target_bay_id),
    'gudangId',t.target_gudang_id,
    'gudangName',(select coalesce(x.data->>'nama',x.data->>'name',x.id) from public.gudang x where x.id=t.target_gudang_id),
    'lokasiId',t.target_lokasi_id,
    'lokasiName',(select coalesce(x.data->>'nama',x.data->>'name',x.data->>'kode',x.id) from public.lokasi x where x.id=t.target_lokasi_id),
    'qty',t.qty,'physicalQty',t.qty,'remainingQty',t.qty,'transferId',t.id,'transferredFrom',r.id
  )) into target_data from public.upt u where u.id=t.target_upt_id;
  available := r.qty - greatest(coalesce((select sum(qty) from public.mtu_khs_receipts where mtu_record_id=r.id),0), coalesce((select sum(qty) from public.mtu_khs_usage_links where mtu_record_id=r.id and status='APPROVED'),0), coalesce((select sum(qty) from public.mtu_khs_stock_links where mtu_record_id=r.id),0)); if t.qty > available then raise exception 'MTU_QTY_BOUND'; end if;
  if t.qty = r.qty then
    update public.mtu_khs_records set upt_id=t.target_upt_id,ultg_id=t.target_ultg_id,gardu_induk_id=t.target_gardu_induk_id,bay_id=t.target_bay_id,gudang_id=t.target_gudang_id,lokasi_id=t.target_lokasi_id,version=version+1,updated_at=now(),data=target_data where id=r.id returning id into new_id;
    update public.mtu_khs_transfer_requests set target_record_id=new_id,after_snapshot=(select to_jsonb(x) from public.mtu_khs_records x where x.id=new_id) where id=t.id;
  else
    new_id := 'MTU-KHS-TRANSFER-' || gen_random_uuid()::text;
    insert into public.mtu_khs_records(id,upt_id,ultg_id,gardu_induk_id,bay_id,gudang_id,lokasi_id,mtu_spec_id,katalog_id,supplier_id,procurement_year,lifecycle_status,sifat_pekerjaan,qty,data,created_by) select new_id,t.target_upt_id,t.target_ultg_id,t.target_gardu_induk_id,t.target_bay_id,t.target_gudang_id,t.target_lokasi_id,r.mtu_spec_id,r.katalog_id,r.supplier_id,r.procurement_year,r.lifecycle_status,r.sifat_pekerjaan,t.qty,target_data,auth.uid();
    insert into public.mtu_khs_record_evidence(record_id,kind,object_path,mime_type,size_bytes,uploaded_by,inherited_from) select new_id,kind,object_path,mime_type,size_bytes,auth.uid(),id from public.mtu_khs_record_evidence where record_id=r.id and superseded_at is null;
    update public.mtu_khs_records set qty=qty-t.qty,version=version+1,updated_at=now(),data=coalesce(data,'{}'::jsonb)||jsonb_build_object('qty',qty-t.qty,'physicalQty',qty-t.qty,'remainingQty',qty-t.qty) where id=r.id;
    update public.mtu_khs_transfer_requests set target_record_id=new_id,after_snapshot=(select to_jsonb(x) from public.mtu_khs_records x where x.id=new_id) where id=t.id;
    insert into public.mtu_khs_record_events(record_id,event_type,actor_id,source_upt_id,target_upt_id,before_data,after_data,metadata,idempotency_key) values (r.id,'TRANSFER_SPLIT',auth.uid(),t.source_upt_id,t.target_upt_id,to_jsonb(r),(select to_jsonb(x) from public.mtu_khs_records x where x.id=r.id),jsonb_build_object('transferId',t.id,'targetRecordId',new_id,'qty',t.qty),t.id::text || ':split');
  end if;
  update public.mtu_khs_transfer_requests set status='APPROVED',decision_note=coalesce(p_note,''),decided_by=auth.uid(),decided_at=now() where id=t.id returning * into result;
  insert into public.mtu_khs_record_events(record_id,event_type,actor_id,source_upt_id,target_upt_id,before_data,after_data,metadata,idempotency_key) values (r.id,'TRANSFER_APPROVED',auth.uid(),t.source_upt_id,t.target_upt_id,to_jsonb(r),(select to_jsonb(x) from public.mtu_khs_records x where x.id=r.id),jsonb_build_object('transferId',t.id,'targetRecordId',new_id),t.id::text);
  return result;
end; $$;
create or replace function public.mtu_khs_transfer_destinations(p_target_upt_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare actor public.profiles; target_uit text; result jsonb;
begin
  select * into actor from public.profiles where id=auth.uid();
  select uit_id into target_uit from public.upt where id=p_target_upt_id;
  if target_uit is null then raise exception 'MTU_TARGET_UPT_INVALID'; end if;
  if actor.role not in ('SUPERADMIN','ADMIN_LOG_PUSAT','PENGADAAN') and not exists (select 1 from public.upt own where own.id=actor.upt_id and own.uit_id=target_uit) and actor.uit_id is distinct from target_uit then raise exception 'MTU_SCOPE_DENIED'; end if;
  select jsonb_build_object(
    'ultg', coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(u.data->>'nama',u.data->>'name',u.id),'uptId',u.upt_id) order by u.id) from public.ultg u where u.upt_id=p_target_upt_id and lower(coalesce(u.data->>'active','true')) <> 'false'),'[]'::jsonb),
    'gis', coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',coalesce(g.data->>'nama',g.data->>'name',g.id),'uptId',g.upt_id,'ultgId',g.ultg_id) order by g.id) from public.mtu_khs_gardu_induk g where g.upt_id=p_target_upt_id and g.active),'[]'::jsonb),
    'bays', coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',coalesce(b.data->>'nama',b.data->>'name',b.id),'garduIndukId',b.gardu_induk_id) order by b.id) from public.mtu_khs_gardu_induk_bay b join public.mtu_khs_gardu_induk g on g.id=b.gardu_induk_id where g.upt_id=p_target_upt_id and b.active),'[]'::jsonb),
    'gudangs', coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',coalesce(g.data->>'nama',g.data->>'name',g.id),'uptId',g.upt_id) order by g.id) from public.gudang g where g.upt_id=p_target_upt_id and lower(coalesce(g.data->>'active','true')) <> 'false'),'[]'::jsonb),
    'lokasis', coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'name',coalesce(l.data->>'nama',l.data->>'name',l.data->>'kode',l.id),'gudangId',l.gudang_id) order by l.id) from public.lokasi l join public.gudang g on g.id=l.gudang_id where g.upt_id=p_target_upt_id and lower(coalesce(l.data->>'active','true')) <> 'false' and lower(coalesce(g.data->>'active','true')) <> 'false'),'[]'::jsonb)
  ) into result;
  return result;
end; $$;
create or replace function public.mtu_khs_register_evidence(p_record_id text, p_kind text, p_object_path text, p_mime_type text, p_size_bytes bigint, p_idempotency_key text)
returns public.mtu_khs_record_evidence language plpgsql security definer set search_path = public, storage as $$
declare r public.mtu_khs_records; result public.mtu_khs_record_evidence; old public.mtu_khs_record_evidence;
begin
  select * into r from public.mtu_khs_records where id=p_record_id; if not found or not public.mtu_khs_can_access_upt(r.upt_id) then raise exception 'MTU_SCOPE_DENIED'; end if;
  if not exists (select 1 from public.profiles where id=auth.uid() and role in ('TL','SUPERADMIN')) then raise exception 'MTU_ROLE_DENIED'; end if;
  if p_kind not in ('ITEM','NAMEPLATE') or p_mime_type not like 'image/%' or p_size_bytes <= 0 or p_size_bytes > 2097152 or p_object_path not like r.upt_id || '/' || r.id || '/%' then raise exception 'MTU_EVIDENCE_INVALID'; end if;
  if not exists (select 1 from storage.objects where bucket_id='mtu-khs-evidence' and name=p_object_path and lower(coalesce(metadata->>'mimetype','')) = lower(p_mime_type) and (metadata->>'size') ~ '^[0-9]+$' and case when (metadata->>'size') ~ '^[0-9]+$' then (metadata->>'size')::bigint else 0 end = p_size_bytes and case when (metadata->>'size') ~ '^[0-9]+$' then (metadata->>'size')::bigint else 0 end <= 2097152) then raise exception 'MTU_EVIDENCE_OBJECT_MISSING'; end if;
  select * into result from public.mtu_khs_record_evidence where record_id=r.id and kind=p_kind and superseded_at is null order by created_at desc limit 1;
  if found and result.object_path = p_object_path then return result; end if;
  update public.mtu_khs_record_evidence set superseded_at=now() where record_id=r.id and kind=p_kind and superseded_at is null returning * into old;
  insert into public.mtu_khs_record_evidence(record_id,kind,object_path,mime_type,size_bytes,uploaded_by,inherited_from) values (r.id,p_kind,p_object_path,p_mime_type,p_size_bytes,auth.uid(),old.id) returning * into result;
  insert into public.mtu_khs_record_events(record_id,event_type,actor_id,source_upt_id,after_data,metadata,idempotency_key) values (r.id,'EVIDENCE_REGISTERED',auth.uid(),r.upt_id,to_jsonb(result),jsonb_build_object('kind',p_kind),p_idempotency_key);
  return result;
end; $$;
create or replace function public.mtu_khs_list_records(p_year integer default null, p_lifecycle_status text default null, p_vendor text default null, p_upt_id text default null, p_search text default null, p_rfq text default null, p_contract_kr text default null, p_limit integer default 20, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q text := public.mtu_khs_search_text(to_jsonb(coalesce(p_search,''))); result jsonb;
begin
  with filtered as (
    select r.*, case when q='' then 0 else (case when lower(coalesce(r.data->>'mtuCode',''))=q or lower(coalesce(r.data->>'noKontrak',''))=q or lower(coalesce(r.data->>'contractDetailNumber',''))=q then 100 else 0 end) + (case when r.search_text like q||'%' then 20 else 0 end) + similarity(r.search_text,q)*10 end score
    from public.mtu_khs_records r where public.mtu_khs_can_access_upt(r.upt_id) and (p_year is null or r.procurement_year=p_year) and (p_lifecycle_status is null or r.lifecycle_status=p_lifecycle_status) and (p_vendor is null or lower(coalesce(r.data->>'vendor',''))=lower(p_vendor)) and (p_upt_id is null or r.upt_id=p_upt_id) and (p_rfq is null or lower(coalesce(r.data->>'mtuCode',''))=lower(p_rfq)) and (p_contract_kr is null or lower(coalesce(r.data->>'contractDetailNumber',r.data->>'noKontrak',''))=lower(p_contract_kr)) and (q='' or not exists (select 1 from regexp_split_to_table(q, '\s+') token where token <> '' and r.search_text not like '%' || token || '%' and word_similarity(token, r.search_text) < 0.45))
  ), items as (select coalesce(jsonb_agg(to_jsonb(page_rows) order by score desc, updated_at desc), '[]'::jsonb) value from (select * from filtered order by score desc,updated_at desc limit greatest(1,least(p_limit,1000)) offset greatest(0,p_offset)) page_rows), facets as (select coalesce(jsonb_agg(distinct data->>'mtuCode') filter (where data->>'mtuCode' is not null),'[]'::jsonb) rfqs, coalesce(jsonb_agg(distinct coalesce(data->>'contractDetailNumber',data->>'noKontrak')) filter (where coalesce(data->>'contractDetailNumber',data->>'noKontrak') is not null),'[]'::jsonb) contract_krs from filtered)
  select jsonb_build_object('items',items.value,'total',(select count(*) from filtered),'facets',jsonb_build_object('rfqs',facets.rfqs,'contractKrs',facets.contract_krs),'vendors',(select coalesce(jsonb_agg(distinct data->>'vendor'),'[]'::jsonb) from filtered)) into result from items,facets;
  return result;
end; $$;
revoke all on function public.mtu_khs_can_access_upt(text) from public;
grant execute on function public.mtu_khs_can_access_upt(text) to authenticated;
revoke all on function public.mtu_khs_submit_change(text, integer, jsonb, text) from public;
revoke all on function public.mtu_khs_decide_change(text, text, text) from public;
grant execute on function public.mtu_khs_submit_change(text, integer, jsonb, text) to authenticated;
grant execute on function public.mtu_khs_decide_change(text, text, text) to authenticated;
revoke all on function public.mtu_khs_commit_import(text, text) from public;
grant execute on function public.mtu_khs_commit_import(text, text) to authenticated;
revoke all on function public.mtu_khs_decide_import(text,text,text) from public;
grant execute on function public.mtu_khs_decide_import(text,text,text) to authenticated;
revoke all on function public.mtu_khs_attach_document(text,text) from public;
grant execute on function public.mtu_khs_attach_document(text,text) to authenticated;
revoke all on function public.mtu_khs_register_document(text,text,text,text,text,text) from public;
grant execute on function public.mtu_khs_register_document(text,text,text,text,text,text) to authenticated;
revoke all on function public.mtu_khs_link_approved_tug(text,uuid,numeric) from public;
grant execute on function public.mtu_khs_link_approved_tug(text,uuid,numeric) to authenticated;
revoke all on function public.mtu_khs_upsert_gardu_induk(text,text,jsonb), public.mtu_khs_upsert_bay(text,text,jsonb) from public;
grant execute on function public.mtu_khs_upsert_gardu_induk(text,text,jsonb), public.mtu_khs_upsert_bay(text,text,jsonb) to authenticated;
revoke all on function public.mtu_khs_deactivate_site_master(text,text) from public;
grant execute on function public.mtu_khs_deactivate_site_master(text,text) to authenticated;
revoke all on function public.mtu_khs_stage_import(text,integer,text,text,text,text,jsonb) from public;
grant execute on function public.mtu_khs_stage_import(text,integer,text,text,text,text,jsonb) to authenticated;
revoke all on function public.mtu_khs_update_import_row_mapping(text,jsonb) from public;
grant execute on function public.mtu_khs_update_import_row_mapping(text,jsonb) to authenticated;
grant execute on function public.mtu_khs_set_reconciliation(text,text,text), public.mtu_khs_link_stock(text,text,numeric), public.mtu_khs_link_approved_tug(text,uuid,numeric) to authenticated;
revoke all on function public.mtu_khs_submit_change(text, integer, jsonb, text) from public, anon, authenticated;
revoke all on function public.mtu_khs_decide_change(text, text, text) from public, anon, authenticated;
grant execute on function public.mtu_khs_submit_change(text, integer, jsonb, text), public.mtu_khs_decide_change(text, text, text) to authenticated;
revoke all on function public.mtu_khs_update_operational(text,integer,jsonb,text), public.mtu_khs_request_transfer(text,integer,numeric,text,text,text,text,text,text,text,text), public.mtu_khs_decide_transfer(uuid,text,text), public.mtu_khs_transfer_destinations(text), public.mtu_khs_register_evidence(text,text,text,text,bigint,text), public.mtu_khs_list_records(integer,text,text,text,text,text,text,integer,integer) from public;
grant execute on function public.mtu_khs_update_operational(text,integer,jsonb,text), public.mtu_khs_request_transfer(text,integer,numeric,text,text,text,text,text,text,text,text), public.mtu_khs_decide_transfer(uuid,text,text), public.mtu_khs_transfer_destinations(text), public.mtu_khs_register_evidence(text,text,text,text,bigint,text), public.mtu_khs_list_records(integer,text,text,text,text,text,text,integer,integer) to authenticated;

-- Canonical mirror of migration 20261012_tug_mara_post_guard.sql.
-- TUG MARA posting guard. Apply after 20261001_tug10_target_stock.sql.
-- Applied to self-host production on 2026-10-12 after explicit approval.
begin;

alter table public.tug_idempotency_keys
  drop constraint if exists tug_idempotency_keys_operation_check;
alter table public.tug_idempotency_keys
  add constraint tug_idempotency_keys_operation_check
  check (operation in ('CREATE','SUBMIT','DECIDE','AMEND','TUG10_FINAL_APPROVE','TUG3_FINAL_APPROVE'));

create or replace function public.tug_mara_resolve(
  p_code text,
  p_prefix text default 'TUG'
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_key text := nullif(ltrim(btrim(coalesce(p_code, '')), '0'), '');
  v_count integer;
  v_row public.mara_catalog;
begin
  if v_key is null then
    raise exception '%_MARA_CATALOG_REQUIRED', coalesce(nullif(p_prefix, ''), 'TUG') using errcode = '23514';
  end if;

  select count(*) into v_count
  from public.mara_catalog
  where nullif(ltrim(btrim(coalesce(kode_material, '')), '0'), '') = v_key;
  if v_count = 0 then
    raise exception '%_MARA_CATALOG_NOT_FOUND', coalesce(nullif(p_prefix, ''), 'TUG') using errcode = 'P0002';
  elsif v_count <> 1 then
    raise exception '%_MARA_CATALOG_AMBIGUOUS', coalesce(nullif(p_prefix, ''), 'TUG') using errcode = '23514';
  end if;

  select * into v_row
  from public.mara_catalog
  where nullif(ltrim(btrim(coalesce(kode_material, '')), '0'), '') = v_key
  order by kode_material
  limit 1;
  if nullif(btrim(coalesce(v_row.kode_material, '')), '') is null
     or nullif(btrim(coalesce(v_row.nama, '')), '') is null
     or nullif(btrim(coalesce(v_row.satuan, '')), '') is null then
    raise exception '%_MARA_CATALOG_INVALID', coalesce(nullif(p_prefix, ''), 'TUG') using errcode = '23514';
  end if;
  return jsonb_build_object(
    'kode_material', btrim(v_row.kode_material),
    'nama', coalesce(v_row.nama, ''),
    'satuan', coalesce(v_row.satuan, ''),
    'material_group', coalesce(v_row.material_group, ''),
    'material_group_desc', coalesce(v_row.material_group_desc, ''),
    'status', coalesce(v_row.status, '')
  );
end;
$$;

create or replace function public.tug3_source_part(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select coalesce(
    nullif(
      regexp_replace(
        regexp_replace(lower(btrim(coalesce(p_value, ''))), '[^a-z0-9]+', '-', 'g'),
        '(^-+|-+$)', '', 'g'
      ),
      ''
    ),
    '-'
  )
$$;

create or replace function public.tug_mara_catalog_data(
  p_data jsonb,
  p_prefix text default 'TUG'
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_data jsonb := coalesce(p_data, '{}'::jsonb);
  v_mara jsonb;
  v_category text;
begin
  v_mara := public.tug_mara_resolve(v_data->>'katalog', p_prefix);
  v_category := coalesce(nullif(v_mara->>'material_group_desc', ''), nullif(v_mara->>'material_group', ''), 'Lainnya');
  return v_data || jsonb_build_object(
    'katalog', v_mara->>'kode_material',
    'name', v_mara->>'nama',
    'category', v_category,
    'satuan', v_mara->>'satuan',
    'maraCode', v_mara->>'kode_material',
    '_maraLocked', true
  );
end;
$$;

revoke all on function public.tug_mara_resolve(text,text) from public, anon, authenticated;
revoke all on function public.tug_mara_catalog_data(jsonb,text) from public, anon, authenticated;
revoke all on function public.tug3_source_part(text) from public, anon, authenticated;

create or replace function public.katalog_fill_satuan_from_mara()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_key text := nullif(ltrim(btrim(coalesce(new.data->>'katalog', '')), '0'), '');
  v_count integer;
  v_mara public.mara_catalog;
  v_tug_context boolean := coalesce(current_setting('app.tug3_final_rpc', true), '') = 'on'
    or coalesce(current_setting('app.tug10_final_rpc', true), '') = 'on'
    or coalesce(current_setting('app.mtu_khs_receipt_rpc', true), '') = 'on';
begin
  if v_key is null then
    return new;
  end if;
  select count(*) into v_count
  from public.mara_catalog
  where nullif(ltrim(btrim(coalesce(kode_material, '')), '0'), '') = v_key;
  if v_count > 1 and v_tug_context then
    raise exception '%_MARA_CATALOG_AMBIGUOUS', case
      when coalesce(current_setting('app.tug3_final_rpc', true), '') = 'on' then 'TUG3'
      when coalesce(current_setting('app.mtu_khs_receipt_rpc', true), '') = 'on' then 'MTU'
      else 'TUG10'
    end using errcode = '23514';
  elsif v_count = 1 then
    select * into v_mara
    from public.mara_catalog
    where nullif(ltrim(btrim(coalesce(kode_material, '')), '0'), '') = v_key
    order by kode_material
    limit 1;
    if nullif(btrim(coalesce(v_mara.kode_material, '')), '') is not null
       and nullif(btrim(coalesce(v_mara.nama, '')), '') is not null
       and nullif(btrim(coalesce(v_mara.satuan, '')), '') is not null then
      new.data := coalesce(new.data, '{}'::jsonb) || jsonb_build_object(
        'katalog', btrim(v_mara.kode_material),
        'name', btrim(v_mara.nama),
        'satuan', btrim(v_mara.satuan),
        'maraCode', btrim(v_mara.kode_material),
        '_maraLocked', true,
        'category', coalesce(nullif(btrim(v_mara.material_group_desc), ''), nullif(btrim(v_mara.material_group), ''), 'Lainnya')
      );
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists katalog_fill_satuan on public.katalog;
create trigger katalog_fill_satuan
before insert or update of data on public.katalog
for each row execute function public.katalog_fill_satuan_from_mara();
revoke all on function public.katalog_fill_satuan_from_mara() from public, anon, authenticated;

create or replace function public.tug_mara_catalog_write_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_prefix text := case
    when coalesce(current_setting('app.tug3_final_rpc', true), '') = 'on' then 'TUG3'
    when coalesce(current_setting('app.mtu_khs_receipt_rpc', true), '') = 'on' then 'MTU'
    else 'TUG10'
  end;
begin
  if coalesce(current_setting('app.tug3_final_rpc', true), '') <> 'on'
     and coalesce(current_setting('app.tug10_final_rpc', true), '') <> 'on'
     and coalesce(current_setting('app.mtu_khs_receipt_rpc', true), '') <> 'on' then
    return new;
  end if;
  new.data := public.tug_mara_catalog_data(new.data, v_prefix);
  return new;
end;
$$;

drop trigger if exists trg_tug_mara_catalog_write_guard on public.katalog;
create trigger trg_tug_mara_catalog_write_guard
before insert or update on public.katalog
for each row execute function public.tug_mara_catalog_write_guard();
revoke all on function public.tug_mara_catalog_write_guard() from public, anon, authenticated;

create or replace function public.tug_mara_stock_write_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_prefix text := case
    when coalesce(current_setting('app.tug3_final_rpc', true), '') = 'on' then 'TUG3'
    when coalesce(current_setting('app.mtu_khs_receipt_rpc', true), '') = 'on' then 'MTU'
    else 'TUG10'
  end;
  v_data jsonb := coalesce(new.data, '{}'::jsonb);
  v_catalog_data jsonb;
  v_mara_data jsonb;
  v_code text;
  v_category text;
begin
  if coalesce(current_setting('app.tug3_final_rpc', true), '') <> 'on'
     and coalesce(current_setting('app.tug10_final_rpc', true), '') <> 'on'
     and coalesce(current_setting('app.mtu_khs_receipt_rpc', true), '') <> 'on' then
    return new;
  end if;
  select data into v_catalog_data from public.katalog where id = new.katalog_id;
  v_code := coalesce(nullif(btrim(v_catalog_data->>'katalog'), ''), nullif(btrim(v_data->>'katalog'), ''));
  v_mara_data := public.tug_mara_resolve(v_code, v_prefix);
  v_category := coalesce(nullif(v_mara_data->>'material_group_desc', ''), nullif(v_mara_data->>'material_group', ''), 'Lainnya');
  new.data := v_data || jsonb_build_object(
    'katalogId', new.katalog_id,
    'katalog', v_mara_data->>'kode_material',
    'name', v_mara_data->>'nama',
    'unit', v_mara_data->>'satuan',
    'satuan', v_mara_data->>'satuan',
    'category', v_category,
    'maraCode', v_mara_data->>'kode_material',
    '_maraLocked', true
  );
  if new.katalog_id is not null then
    update public.katalog
    set data = public.tug_mara_catalog_data(
      coalesce(v_catalog_data, jsonb_build_object('katalog', v_code)), v_prefix
    )
    where id = new.katalog_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tug_mara_stock_write_guard on public.stocks;
create trigger trg_tug_mara_stock_write_guard
before insert or update on public.stocks
for each row execute function public.tug_mara_stock_write_guard();
revoke all on function public.tug_mara_stock_write_guard() from public, anon, authenticated;

create or replace function public.tug3_guard_legacy_stock_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_old_qty numeric;
  v_new_qty numeric;
begin
  if coalesce(current_setting('app.tug3_final_rpc', true), '') = 'on'
     or coalesce(current_setting('app.mtu_khs_receipt_rpc', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' and (
       new.data ? '_tug3Applied'
       or new.data->'sourceLot'->>'kind' = 'TUG3_CONTRACT'
     ) then
    raise exception 'TUG3_STOCK_RPC_REQUIRED' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.data->'_tug3Applied' is distinct from old.data->'_tug3Applied' then
    raise exception 'TUG3_STOCK_RPC_REQUIRED' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.data->'sourceLot'->>'kind' = 'TUG3_CONTRACT'
     and (new.data->>'qty' is distinct from old.data->>'qty'
       or new.data->'sourceLot' is distinct from old.data->'sourceLot') then
    v_old_qty := coalesce(nullif(old.data->>'qty', '')::numeric, 0);
    v_new_qty := coalesce(nullif(new.data->>'qty', '')::numeric, 0);
    if new.data->'sourceLot' is distinct from old.data->'sourceLot'
       or v_new_qty >= v_old_qty
       or not exists (
      select 1
      from public.stock_movements m
      join public.tug_transactions t on t.id = m.transaction_id
      join public.tug_items i on i.id = m.tug_item_id and i.transaction_id = m.transaction_id
      where m.xact_id = txid_current()
        and m.direction = 'OUT'
        and t.doc_type in ('TUG8', 'TUG9')
        and t.status = 'PENDING'
        and t.stage = 'PENDING_ASMAN'
        and m.stock_id = old.id
        and i.stock_id = old.id
        and m.before_qty = v_old_qty
        and m.after_qty = v_new_qty
        and m.qty = v_old_qty - v_new_qty
        and m.qty = i.qty
    ) then
      raise exception 'TUG3_STOCK_RPC_REQUIRED' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tug3_guard_legacy_stock_write on public.stocks;
create trigger trg_tug3_guard_legacy_stock_write
before insert or update on public.stocks
for each row execute function public.tug3_guard_legacy_stock_write();
revoke all on function public.tug3_guard_legacy_stock_write() from public, anon, authenticated;

create or replace function public.tug3_guard_legacy_status_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if coalesce(current_setting('app.tug3_final_rpc', true), '') = 'on'
     or coalesce(current_setting('app.mtu_khs_receipt_rpc', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'APPROVED' and new.status <> old.status then
    raise exception 'TUG3_APPROVED_IMMUTABLE' using errcode = '42501';
  end if;
  if new.status = 'APPROVED' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    raise exception 'TUG3_APPROVAL_RPC_REQUIRED' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.data->'_tug3Applied' is distinct from old.data->'_tug3Applied' then
    raise exception 'TUG3_APPROVAL_RPC_REQUIRED' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tug3_guard_legacy_status_write on public.tug3_transactions;
create trigger trg_tug3_guard_legacy_status_write
before insert or update on public.tug3_transactions
for each row execute function public.tug3_guard_legacy_status_write();
revoke all on function public.tug3_guard_legacy_status_write() from public, anon, authenticated;

create or replace function public.approve_tug3_final(
  p_tug3_id text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor public.profiles;
  v_txn public.tug3_transactions;
  v_data jsonb;
  v_items jsonb;
  v_item jsonb;
  v_mara jsonb;
  v_cat_data jsonb;
  v_stock_data jsonb;
  v_stock public.stocks;
  v_code text;
  v_catalog_id text;
  v_location_id text;
  v_location_upt text;
  v_qty numeric;
  v_old_qty numeric;
  v_already numeric;
  v_effect text;
  v_source_key text;
  v_source_lot jsonb;
  v_contract_no text;
  v_document_no text;
  v_supplier text;
  v_identity text;
  v_mara_key text;
  v_candidate_count integer;
  v_now bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_idx integer;
  v_stock_id text;
  v_category text;
  v_response jsonb;
  v_existing public.tug_idempotency_keys;
  v_hash text;
  v_stocks jsonb := '[]'::jsonb;
  v_katalogs jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'TUG_AUTH_REQUIRED' using errcode = '42501'; end if;
  if nullif(btrim(p_tug3_id), '') is null or p_idempotency_key is null then
    raise exception 'TUG3_INPUT_INVALID' using errcode = '23514';
  end if;
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null then raise exception 'TUG_AUTH_REQUIRED' using errcode = '42501'; end if;
  if v_actor.role not in ('ASMAN','SUPERADMIN') then
    raise exception 'TUG3_APPROVAL_ROLE_DENIED' using errcode = '42501';
  end if;

  v_hash := md5('TUG3_FINAL_APPROVE|' || p_tug3_id);
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select * into v_existing from public.tug_idempotency_keys where key = p_idempotency_key;
  if v_existing.key is not null then
    if v_existing.operation <> 'TUG3_FINAL_APPROVE' or v_existing.actor_id <> v_actor.id
       or v_existing.request_hash is distinct from v_hash then
      raise exception 'TUG_IDEMPOTENCY_REUSE_FORBIDDEN' using errcode = '42501';
    end if;
    return v_existing.response || jsonb_build_object('idempotent', true);
  end if;

  select * into v_txn from public.tug3_transactions where id = p_tug3_id for update;
  if v_txn.id is null then raise exception 'TUG3_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_access_upt(v_txn.upt_id) then raise exception 'TUG3_SCOPE_DENIED' using errcode = '42501'; end if;
  if v_txn.status = 'APPROVED' and v_txn.stage = 'APPROVED' then raise exception 'TUG3_ALREADY_APPROVED'; end if;
  if v_txn.status <> 'PENDING' or v_txn.stage <> 'PENDING_ASMAN' then raise exception 'TUG3_STAGE_INVALID'; end if;
  v_data := coalesce(v_txn.data, '{}'::jsonb);
  v_items := v_data->'stockItems';
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then raise exception 'TUG3_ITEMS_REQUIRED'; end if;
  perform set_config('app.tug3_final_rpc', 'on', true);

  for v_item, v_idx in select value, (ordinality - 1)::integer from jsonb_array_elements(v_items) with ordinality loop
    if nullif(btrim(v_item->>'qty'), '') is null or (v_item->>'qty')::numeric <= 0 then raise exception 'TUG3_QTY_INVALID'; end if;
    v_qty := (v_item->>'qty')::numeric;
    v_location_id := nullif(btrim(coalesce(v_item->>'lokasiTujuanId', v_data->>'lokasiTujuanId')), '');
    select g.upt_id into v_location_upt from public.lokasi l join public.gudang g on g.id = l.gudang_id where l.id = v_location_id;
    if v_location_upt is null then raise exception 'TUG3_LOCATION_NOT_FOUND'; end if;
    if v_location_upt <> v_txn.upt_id then raise exception 'TUG3_LOCATION_SCOPE_DENIED' using errcode = '42501'; end if;

    if coalesce(v_item->>'katalogMode', 'existing') = 'existing' then
      v_catalog_id := nullif(btrim(v_item->>'katalogId'), '');
      if v_catalog_id is null then raise exception 'TUG3_MARA_CATALOG_REQUIRED'; end if;
      select data into v_cat_data from public.katalog where id = v_catalog_id;
      if v_cat_data is null then raise exception 'TUG3_CATALOG_NOT_FOUND' using errcode = 'P0002'; end if;
      v_code := nullif(btrim(v_cat_data->>'katalog'), '');
    else
      v_code := nullif(btrim(v_item->>'katalogBaru'), '');
      v_mara := public.tug_mara_resolve(v_code, 'TUG3');
      v_mara_key := nullif(ltrim(btrim(v_mara->>'kode_material'), '0'), '');
      perform pg_advisory_xact_lock(hashtextextended('TUG3:MARA:' || v_mara_key, 0));
      select count(*) into v_candidate_count
      from public.katalog
      where nullif(ltrim(btrim(data->>'katalog'), '0'), '') = v_mara_key;
      if v_candidate_count > 1 then
        raise exception 'TUG3_CATALOG_AMBIGUOUS' using errcode = '23514';
      end if;
      select id, data into v_catalog_id, v_cat_data from public.katalog
      where nullif(ltrim(btrim(data->>'katalog'), '0'), '') = v_mara_key
      order by id limit 1;
    end if;
    v_mara := public.tug_mara_resolve(v_code, 'TUG3');
    v_category := coalesce(nullif(v_mara->>'material_group_desc', ''), nullif(v_mara->>'material_group', ''), 'Lainnya');
    v_cat_data := coalesce(v_cat_data, jsonb_build_object('id', v_catalog_id))
      || jsonb_build_object('id', v_catalog_id, 'katalog', v_mara->>'kode_material', 'name', v_mara->>'nama',
        'category', v_category, 'satuan', v_mara->>'satuan', 'sapStatus', coalesce(v_cat_data->>'sapStatus', 'SAP'),
        'maraCode', v_mara->>'kode_material', '_maraLocked', true, 'updatedAt', v_now);
    if v_catalog_id is null then
      v_catalog_id := 'KAT-TUG3-' || md5(v_txn.id || ':' || v_idx || ':' || (v_mara->>'kode_material'));
      v_cat_data := jsonb_set(v_cat_data, '{id}', to_jsonb(v_catalog_id), true);
      insert into public.katalog(id, data, created_at) values (v_catalog_id, v_cat_data, v_now);
    else
      update public.katalog set data = v_cat_data where id = v_catalog_id;
    end if;
    v_katalogs := v_katalogs || jsonb_build_array(v_cat_data);

    v_effect := v_txn.id || ':' || v_idx;
    v_contract_no := coalesce(v_data->>'judulKontrak', '');
    v_document_no := coalesce(v_data->>'suratPesananNo', '');
    v_supplier := coalesce(v_data->>'dariSupplier', '');
    v_identity := case
      when v_contract_no <> '' then v_contract_no
      when v_document_no <> '' then v_document_no
      else null
    end;
    if v_identity is not null then
      v_source_key := array_to_string(array[
        public.tug3_source_part('TUG3'),
        public.tug3_source_part(v_txn.upt_id),
        public.tug3_source_part(v_location_id),
        public.tug3_source_part(v_catalog_id),
        public.tug3_source_part(v_supplier),
        public.tug3_source_part(v_identity)
      ], '|');
    else
      v_source_key := array_to_string(array[
        public.tug3_source_part('TUG3'),
        public.tug3_source_part(v_txn.upt_id),
        public.tug3_source_part(v_location_id),
        public.tug3_source_part(v_catalog_id),
        public.tug3_source_part(v_txn.id),
        public.tug3_source_part(v_idx::text)
      ], '|');
    end if;
    v_source_lot := jsonb_build_object('key', v_source_key, 'kind', 'TUG3_CONTRACT', 'supplier', coalesce(v_data->>'dariSupplier',''),
      'contractNo', coalesce(v_data->>'judulKontrak',''), 'sourceDocumentNo', coalesce(v_data->'docNumbers'->>'tug3', v_txn.doc_number, v_txn.id),
      'sourceDate', v_now, 'sourceTransactionId', v_txn.id, 'sourceItemIndex', v_idx, 'status', 'ACTIVE');
    select * into v_stock from public.stocks where katalog_id = v_catalog_id and lokasi_id = v_location_id
      and data->'sourceLot'->>'key' = v_source_key for update;
    v_stock_id := coalesce(v_stock.id, 'STK-TUG3-' || md5(v_txn.id || ':' || v_idx));
    if v_stock.id is null then
      insert into public.stocks(id, katalog_id, lokasi_id, upt_id, data, created_at)
      values (v_stock_id, v_catalog_id, v_location_id, v_txn.upt_id,
        jsonb_build_object('id', v_stock_id, 'katalogId', v_catalog_id, 'lokasiId', v_location_id, 'uptId', v_txn.upt_id,
          'qty', v_qty, 'minQty', 0, 'price', coalesce(nullif(v_item->>'hargaSatuan','')::numeric, 0),
          'jenisBarang', case when coalesce(v_item->>'sapStatus','') ilike '%cadang%' then 'Cadang' else 'Persediaan' end,
          'sapStatus', coalesce(v_item->>'sapStatus','SAP'), 'name', v_mara->>'nama', 'katalog', v_mara->>'kode_material',
          'unit', v_mara->>'satuan', 'category', v_category, 'source', 'TUG3', 'sourceLot', v_source_lot,
           'img', v_item->>'fotoBarang', 'fotoKeseluruhan', v_item->>'fotoBarang',
           'kontrakRefs', jsonb_build_array(jsonb_build_object(
             'noKontrak', v_contract_no, 'supplier', v_supplier,
             'suratPesananNo', v_document_no, 'suratPesananTgl', coalesce(v_data->>'suratPesananTgl', ''),
             'amandemenNo', coalesce(v_data->>'amandemenNo', ''), 'tglMasuk', v_now,
             'docNo', coalesce(v_data->'docNumbers'->>'tug3', v_txn.doc_number, v_txn.id)
           )),
           '_tug3Applied', jsonb_build_object(v_effect, v_qty), 'createdAt', v_now), v_now);
    else
      v_old_qty := coalesce(nullif(v_stock.data->>'qty','')::numeric, 0);
      v_already := coalesce(nullif(v_stock.data->'_tug3Applied'->>v_effect,'')::numeric, 0);
      update public.stocks set data = coalesce(v_stock.data, '{}'::jsonb)
        || jsonb_build_object('qty', v_old_qty + greatest(v_qty - v_already, 0), 'katalogId', v_catalog_id, 'katalog', v_mara->>'kode_material',
          'name', v_mara->>'nama', 'unit', v_mara->>'satuan', 'satuan', v_mara->>'satuan', 'category', v_category,
           'sourceLot', v_source_lot,
           'kontrakRefs', jsonb_build_array(jsonb_build_object(
             'noKontrak', v_contract_no, 'supplier', v_supplier,
             'suratPesananNo', v_document_no, 'suratPesananTgl', coalesce(v_data->>'suratPesananTgl', ''),
             'amandemenNo', coalesce(v_data->>'amandemenNo', ''), 'tglMasuk', v_now,
             'docNo', coalesce(v_data->'docNumbers'->>'tug3', v_txn.doc_number, v_txn.id)
           )),
           '_tug3Applied', coalesce(v_stock.data->'_tug3Applied','{}'::jsonb) || jsonb_build_object(v_effect, v_qty))
      where id = v_stock.id;
    end if;
    select data || jsonb_build_object('id', id, 'katalogId', katalog_id, 'lokasiId', lokasi_id) into v_stock_data from public.stocks where id = v_stock_id;
    v_stocks := v_stocks || jsonb_build_array(v_stock_data);
  end loop;

  v_data := v_data || jsonb_build_object('status','APPROVED','stage','APPROVED','approvedBy',v_actor.id,'approvedAt',v_now,
    'approvedByAsman',v_actor.id,'approvedAtAsman',v_now,'requiredApprover',null);
  update public.tug3_transactions set status='APPROVED', stage='APPROVED', data=v_data, updated_at=v_now where id=v_txn.id;
  select * into v_txn from public.tug3_transactions where id=v_txn.id;
  if to_regclass('public.audit_log') is not null then
    execute 'insert into public.audit_log(user_id,user_name,role,action,entity,entity_id,detail) values ($1,$2,$3,$4,$5,$6,$7)'
      using v_actor.id, v_actor.name, v_actor.role, 'APPROVE', 'TUG3', coalesce(v_txn.doc_number,v_txn.id), jsonb_build_object('stage','APPROVED','atomic',true);
  end if;
  v_response := jsonb_build_object('transaction', v_txn.data || jsonb_build_object('id',v_txn.id,'status',v_txn.status,'stage',v_txn.stage,'uptId',v_txn.upt_id),
    'stocks',v_stocks,'katalogs',v_katalogs,'idempotent',false);
  insert into public.tug_idempotency_keys(key,operation,actor_id,request_hash,response) values (p_idempotency_key,'TUG3_FINAL_APPROVE',v_actor.id,v_hash,v_response);
  return v_response;
end;
$$;

revoke all on function public.approve_tug3_final(text, uuid) from public, anon;
grant execute on function public.approve_tug3_final(text, uuid) to authenticated;

-- MTU keeps its public signature; only the MARA precondition and authoritative
-- stock identity are added. The existing photo, quantity, UPT and idempotency
-- checks remain in the deployed function and are amended below by this wrapper.
create or replace function public.mtu_khs_apply_tug3_receipt(
  p_tug3_transaction_id text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  x public.tug3_transactions; r public.mtu_khs_records; a public.profiles; existing public.mtu_khs_receipts;
  item jsonb; items jsonb; item_qty numeric; total_qty numeric := 0; max_qty numeric; stock_row public.stocks;
  stock_id text; location_id text; catalog_id text; catalog_data jsonb; mara_data jsonb; code text; category text;
  before_qty numeric; after_qty numeric; applied_items jsonb := '[]'::jsonb; item_index integer; foto_barang text; foto_path text;
begin
  select * into x from public.tug3_transactions where id=p_tug3_transaction_id for update;
  select * into a from public.profiles where id=auth.uid();
  if x.id is null or x.mtu_record_id is null or a.role not in ('ASMAN','SUPERADMIN') then raise exception 'MTU_RECEIPT_FORBIDDEN' using errcode='42501'; end if;
  select * into existing from public.mtu_khs_receipts where tug3_transaction_id=x.id or idempotency_key=p_idempotency_key limit 1;
  if existing.id is not null then return jsonb_build_object('receiptId',existing.id,'deduped',true,'qty',existing.qty); end if;
  select * into r from public.mtu_khs_records where id=x.mtu_record_id for update;
  if r.id is null or r.procurement_year <> 2026 or r.sifat_pekerjaan='SUPERVISI' or x.stage <> 'PENDING_ASMAN'
     or not public.mtu_khs_can_access_upt(r.upt_id) or (a.role <> 'SUPERADMIN' and a.upt_id <> r.upt_id) then raise exception 'MTU_RECEIPT_INVALID'; end if;
  items := x.data->'stockItems';
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items)=0 then raise exception 'TUG_ITEMS_REQUIRED'; end if;
  for item,item_index in select value,(ordinality-1)::integer from jsonb_array_elements(items) with ordinality loop
    catalog_id := nullif(btrim(item->>'katalogId'),''); location_id := nullif(btrim(coalesce(item->>'lokasiTujuanId',item->>'lokasiId','')),'');
    foto_barang := nullif(btrim(coalesce(item->>'fotoBarang','')),''); foto_path := x.id || '/item' || item_index || '-fotoBarang.jpg';
    if foto_barang is null or foto_barang like 'data:%' or foto_barang not in ('https://warnoto.com/storage/v1/object/public/tug-photos/'||foto_path,'https://api-staging.warnoto.com/storage/v1/object/public/tug-photos/'||foto_path)
       or not exists (select 1 from storage.objects where bucket_id='tug-photos' and name=foto_path) then raise exception 'MTU_RECEIPT_PHOTO_REQUIRED'; end if;
    if btrim(coalesce(item->>'qty','')) !~ '^[0-9]+([.][0-9]{1,4})?$' then raise exception 'MTU_RECEIPT_ITEM_INVALID'; end if;
    item_qty := (item->>'qty')::numeric;
    select data into catalog_data from public.katalog where id=catalog_id;
    code := coalesce(nullif(btrim(item->>'katalogBaru'),''), nullif(btrim(catalog_data->>'katalog'),''), nullif(btrim(item->'snapshot'->>'katalog'),''));
    mara_data := public.tug_mara_resolve(code,'MTU');
    if catalog_id is null or item_qty <= 0 or r.katalog_id is distinct from catalog_id
       or catalog_data is null or not exists (select 1 from public.lokasi l join public.gudang g on g.id=l.gudang_id where l.id=location_id and g.upt_id=r.upt_id) then raise exception 'MTU_RECEIPT_ITEM_INVALID'; end if;
    total_qty := total_qty + item_qty;
  end loop;
  max_qty := greatest(0,r.qty-coalesce((select sum(qty) from public.mtu_khs_receipts where mtu_record_id=r.id),0));
  if total_qty > max_qty then raise exception 'MTU_RECEIPT_QTY_EXCEEDED'; end if;
  perform set_config('app.mtu_khs_receipt_rpc','on',true);
  for item,item_index in select value,(ordinality-1)::integer from jsonb_array_elements(items) with ordinality loop
    catalog_id := nullif(btrim(item->>'katalogId'),''); location_id := nullif(btrim(coalesce(item->>'lokasiTujuanId',item->>'lokasiId','')),'');
    item_qty := (item->>'qty')::numeric; select data into catalog_data from public.katalog where id=catalog_id;
    code := coalesce(nullif(btrim(item->>'katalogBaru'),''), nullif(btrim(catalog_data->>'katalog'),''), nullif(btrim(item->'snapshot'->>'katalog'),''));
    mara_data := public.tug_mara_resolve(code,'MTU'); category := coalesce(nullif(mara_data->>'material_group_desc',''),nullif(mara_data->>'material_group',''),'Lainnya');
    update public.katalog set data=public.tug_mara_catalog_data(coalesce(catalog_data,jsonb_build_object('katalog',code)),'MTU') where id=catalog_id;
    select * into stock_row from public.stocks where katalog_id=catalog_id and lokasi_id=location_id for update;
    if stock_row.id is null then
      stock_id := 'STK-MTU-'||md5(r.id||':'||catalog_id||':'||location_id);
      insert into public.stocks(id,katalog_id,lokasi_id,upt_id,data,created_at) values (stock_id,catalog_id,location_id,r.upt_id,
        jsonb_build_object('name',mara_data->>'nama','katalog',mara_data->>'kode_material','unit',mara_data->>'satuan','satuan',mara_data->>'satuan','category',category,'qty',item_qty,'price',coalesce(nullif(item->>'hargaSatuan','')::numeric,0),'uptId',r.upt_id,'mtuRecordId',r.id,'mtuTug3Id',x.id,'source','MTU_KHS_TUG3','fotoKeseluruhan',foto_barang,'img',foto_barang,'createdAt',extract(epoch from clock_timestamp())*1000),(extract(epoch from clock_timestamp())*1000)::bigint) returning * into stock_row;
      before_qty := 0;
    else
      stock_id := stock_row.id; before_qty := coalesce((stock_row.data->>'qty')::numeric,0);
      update public.stocks set upt_id=coalesce(upt_id,r.upt_id), data=coalesce(stock_row.data,'{}'::jsonb)||jsonb_build_object('qty',before_qty+item_qty,'name',mara_data->>'nama','katalog',mara_data->>'kode_material','unit',mara_data->>'satuan','satuan',mara_data->>'satuan','category',category,'fotoKeseluruhan',foto_barang,'img',foto_barang,'uptId',r.upt_id,'mtuRecordId',r.id,'mtuTug3Id',x.id,'source','MTU_KHS_TUG3') where id=stock_row.id;
    end if;
    after_qty := before_qty+item_qty;
    applied_items := applied_items||jsonb_build_array(jsonb_build_object('stockId',stock_id,'katalogId',catalog_id,'lokasiId',location_id,'qty',item_qty,'beforeQty',before_qty,'afterQty',after_qty,'itemIndex',item_index,'fotoBarang',foto_barang));
  end loop;
  insert into public.mtu_khs_receipts(mtu_record_id,tug3_transaction_id,qty,items,applied_by,idempotency_key) values (r.id,x.id,total_qty,applied_items,a.id,p_idempotency_key) returning * into existing;
  update public.tug3_transactions set stage='APPROVED',status='APPROVED',data=data||jsonb_build_object(
    'mtuReceiptId',existing.id,'mtuReceiptAppliedAt',now(),
    'approvedBy',a.id,'approvedAt',(extract(epoch from clock_timestamp())*1000)::bigint,
    'approvedByAsman',a.id,'approvedAtAsman',(extract(epoch from clock_timestamp())*1000)::bigint
  ),updated_at=(extract(epoch from clock_timestamp())*1000)::bigint where id=x.id;
  return jsonb_build_object('receiptId',existing.id,'deduped',false,'qty',total_qty,'items',applied_items);
end;
$$;

revoke all on function public.mtu_khs_apply_tug3_receipt(text,text) from public, anon, authenticated;
grant execute on function public.mtu_khs_apply_tug3_receipt(text,text) to authenticated;

-- BA Pengeluaran Material Non Stock / Pinjam.
-- Migration proposal only. Apply to production only after explicit approval.

create table if not exists public.ba_non_stock (
  id text primary key,
  upt_id text not null,
  kind text not null check (kind in ('NON_STOCK', 'PINJAM')),
  stage text not null default 'DRAFT' check (stage in ('DRAFT', 'PENDING_TL', 'APPROVED', 'REJECTED')),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED')),
  version integer not null default 1 check (version > 0),
  doc_number text unique,
  sequence_year integer,
  sequence_value bigint,
  warehouse_id text,
  security_guard_id text,
  issue_date date,
  sender text,
  destination_unit text,
  reference_document text,
  purpose text,
  recipient_name text,
  recipient_title text,
  recipient_unit text,
  driver_name text,
  vehicle_number text,
  photo_label_url text,
  photo_loaded_url text,
  recipient_snapshot jsonb not null default '{}'::jsonb,
  security_guard_snapshot jsonb not null default '{}'::jsonb,
  tl_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id) on delete restrict,
  submitted_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  rejected_by uuid references public.profiles(id) on delete set null,
  rejection_reason text,
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ba_non_stock_state_pair check (
    (stage = 'DRAFT' and status = 'DRAFT')
    or (stage = 'PENDING_TL' and status = 'PENDING')
    or (stage = 'APPROVED' and status = 'APPROVED')
    or (stage = 'REJECTED' and status = 'REJECTED')
  ),
  constraint ba_non_stock_sequence_pair check (
    (sequence_year is null and sequence_value is null)
    or (sequence_year is not null and sequence_value is not null and sequence_year >= 2000 and sequence_value > 0)
  ),
  constraint ba_non_stock_number_final check (status <> 'APPROVED' or (doc_number is not null and sequence_year is not null and sequence_value is not null))
);

create index if not exists ba_non_stock_scope_idx
  on public.ba_non_stock (upt_id, status, updated_at desc);
create index if not exists ba_non_stock_search_idx
  on public.ba_non_stock (doc_number, sender, recipient_name, reference_document);
create unique index if not exists ba_non_stock_sequence_unique_idx
  on public.ba_non_stock (upt_id, sequence_year, sequence_value)
  where sequence_year is not null and sequence_value is not null;

create table if not exists public.ba_non_stock_items (
  ba_id text not null references public.ba_non_stock(id) on delete cascade,
  line_no integer not null check (line_no > 0),
  material_name text,
  qty numeric check (qty is null or qty > 0),
  unit text,
  description text not null default '',
  primary key (ba_id, line_no)
);

create index if not exists ba_non_stock_items_name_idx
  on public.ba_non_stock_items (lower(material_name));

create table if not exists public.ba_non_stock_counters (
  upt_id text not null,
  year integer not null check (year >= 2000),
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (upt_id, year)
);

alter table public.ba_non_stock enable row level security;
alter table public.ba_non_stock_items enable row level security;
alter table public.ba_non_stock_counters enable row level security;

drop policy if exists "Scoped read ba non stock" on public.ba_non_stock;
create policy "Scoped read ba non stock"
  on public.ba_non_stock for select to authenticated
  using (public.can_access_upt(upt_id));

drop policy if exists "Scoped read ba non stock items" on public.ba_non_stock_items;
create policy "Scoped read ba non stock items"
  on public.ba_non_stock_items for select to authenticated
  using (exists (
    select 1 from public.ba_non_stock b
    where b.id = ba_non_stock_items.ba_id
      and public.can_access_upt(b.upt_id)
  ));

revoke all on public.ba_non_stock from anon, authenticated;
revoke all on public.ba_non_stock_items from anon, authenticated;
revoke all on public.ba_non_stock_counters from anon, authenticated;
grant select on public.ba_non_stock, public.ba_non_stock_items to authenticated;

create or replace function public.ba_non_stock_payload_has_data_url(p_payload jsonb)
returns boolean
language sql immutable
as $$
  select coalesce(p_payload::text ~* 'data:', false)
$$;

create or replace function public.ba_non_stock_photo_path(p_photo text, p_id text)
returns text
language plpgsql immutable
as $$
declare
  v text := btrim(coalesce(p_photo, ''));
  p text;
begin
  if v = '' or v ~* '^data:' or v ~ '[.][.]' then return null; end if;
  if v ~* '^https://[^/]+/storage/v1/object/public/tug-photos/' then
    p := regexp_replace(v, '^https://[^/]+/storage/v1/object/public/tug-photos/', '', 'i');
  elsif v ~* '^tug-photos/' then
    p := regexp_replace(v, '^tug-photos/', '', 'i');
  else
    p := v;
  end if;
  if p !~ ('^ba-non-stock/' || regexp_replace(coalesce(p_id, ''), '[^A-Za-z0-9_-]', '', 'g') || '/(label|loaded)[.][A-Za-z0-9]+$') then
    return null;
  end if;
  return p;
end
$$;

create or replace function public.ba_non_stock_assert_complete(p_row public.ba_non_stock)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  label_path text;
  loaded_path text;
  satpam_row public.satpam;
begin
  if p_row.kind not in ('NON_STOCK', 'PINJAM')
     or p_row.issue_date is null
     or nullif(btrim(p_row.warehouse_id), '') is null
     or nullif(btrim(p_row.sender), '') is null
     or nullif(btrim(p_row.destination_unit), '') is null
     or nullif(btrim(p_row.reference_document), '') is null
     or nullif(btrim(p_row.purpose), '') is null
     or nullif(btrim(p_row.recipient_name), '') is null
     or nullif(btrim(p_row.recipient_title), '') is null
     or nullif(btrim(p_row.recipient_unit), '') is null then
    raise exception 'BA_REQUIRED_FIELD';
  end if;
  if not exists (select 1 from public.gudang g where g.id = p_row.warehouse_id and g.upt_id = p_row.upt_id) then
    raise exception 'BA_SCOPE_DENIED';
  end if;
  if nullif(btrim(p_row.security_guard_id), '') is null then raise exception 'BA_SATPAM_INVALID'; end if;
  select * into satpam_row from public.satpam s where s.id = p_row.security_guard_id;
  if satpam_row.id is null or satpam_row.data->>'gudangId' is distinct from p_row.warehouse_id then
    raise exception 'BA_SATPAM_INVALID';
  end if;
  if not exists (
    select 1 from public.ba_non_stock_items i
    where i.ba_id = p_row.id
      and nullif(btrim(i.material_name), '') is not null
      and i.qty > 0
      and nullif(btrim(i.unit), '') is not null
  ) or exists (
    select 1 from public.ba_non_stock_items i
    where i.ba_id = p_row.id
      and (nullif(btrim(i.material_name), '') is null or i.qty <= 0 or nullif(btrim(i.unit), '') is null)
  ) then
    raise exception 'BA_ITEM_INVALID';
  end if;
  label_path := public.ba_non_stock_photo_path(p_row.photo_label_url, p_row.id);
  loaded_path := public.ba_non_stock_photo_path(p_row.photo_loaded_url, p_row.id);
  if label_path is null or loaded_path is null then raise exception 'BA_PHOTO_REQUIRED'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'tug-photos' and name = label_path)
     or not exists (select 1 from storage.objects where bucket_id = 'tug-photos' and name = loaded_path) then
    raise exception 'BA_PHOTO_NOT_STORED';
  end if;
end
$$;

create or replace function public.save_ba_non_stock_draft(
  p_id text,
  p_expected_version integer,
  p_upt_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  actor public.profiles;
  old_row public.ba_non_stock;
  payload jsonb := coalesce(p_payload, '{}'::jsonb);
  item jsonb;
  item_no integer := 0;
  item_name text;
  item_unit text;
  item_description text;
  item_qty numeric;
  item_qty_text text;
  next_version integer;
  next_stage text := 'DRAFT';
  next_status text := 'DRAFT';
  next_kind text := upper(btrim(coalesce(payload->>'kind', 'NON_STOCK')));
  next_date date;
begin
  select * into actor from public.profiles where id = auth.uid();
  if actor.id is null then raise exception 'BA_AUTH_REQUIRED'; end if;
  if actor.role not in ('ADMIN', 'TL', 'SUPERADMIN') then raise exception 'BA_ROLE_DENIED'; end if;
  if p_id is null or btrim(p_id) = '' or p_upt_id is null or btrim(p_upt_id) = '' then raise exception 'BA_REQUIRED_FIELD'; end if;
  if actor.role <> 'SUPERADMIN' and actor.upt_id is distinct from p_upt_id then raise exception 'BA_SCOPE_DENIED'; end if;
  if not public.can_access_upt(p_upt_id) then raise exception 'BA_SCOPE_DENIED'; end if;
  if jsonb_typeof(payload) <> 'object' or public.ba_non_stock_payload_has_data_url(payload) then raise exception 'BA_PHOTO_NOT_STORED'; end if;
  if next_kind not in ('NON_STOCK', 'PINJAM') then raise exception 'BA_REQUIRED_FIELD'; end if;
  if payload ? 'issueDate' and nullif(btrim(payload->>'issueDate'), '') is not null then
    if payload->>'issueDate' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'BA_REQUIRED_FIELD'; end if;
    next_date := (payload->>'issueDate')::date;
  end if;

  select * into old_row from public.ba_non_stock where id = p_id for update;
  if old_row.id is null then
    if p_expected_version is not null then raise exception 'BA_NOT_FOUND'; end if;
    insert into public.ba_non_stock (
      id, upt_id, kind, stage, status, version, warehouse_id, security_guard_id, issue_date,
      sender, destination_unit, reference_document, purpose, recipient_name, recipient_title,
      recipient_unit, driver_name, vehicle_number, photo_label_url, photo_loaded_url, created_by
    ) values (
      p_id, p_upt_id, next_kind, next_stage, next_status, 1,
      nullif(btrim(coalesce(payload->>'warehouseId', payload->>'gudangId', '')), ''),
      nullif(btrim(coalesce(payload->>'securityGuardId', payload->>'satpamId', '')), ''),
      next_date,
      nullif(btrim(coalesce(payload->>'sender', payload->>'source', '')), ''),
      nullif(btrim(coalesce(payload->>'destinationUnit', payload->>'unitTujuan', '')), ''),
      nullif(btrim(coalesce(payload->>'referenceDocument', payload->>'reference', payload->>'referensi', '')), ''),
      nullif(btrim(coalesce(payload->>'purpose', payload->>'keperluan', '')), ''),
      nullif(btrim(coalesce(payload->>'recipientName', payload->>'penerimaNama', '')), ''),
      nullif(btrim(coalesce(payload->>'recipientTitle', payload->>'penerimaJabatan', '')), ''),
      nullif(btrim(coalesce(payload->>'recipientUnit', payload->>'penerimaUnit', '')), ''),
      nullif(btrim(coalesce(payload->>'driverName', payload->>'namaPengemudi', '')), ''),
      nullif(btrim(coalesce(payload->>'vehicleNumber', payload->>'nomorKendaraan', '')), ''),
      nullif(btrim(coalesce(payload->>'photoLabelUrl', payload->>'photoLabelPath', '')), ''),
      nullif(btrim(coalesce(payload->>'photoLoadedUrl', payload->>'photoLoadedPath', '')), ''),
      auth.uid()
    );
    next_version := 1;
  else
    if old_row.upt_id is distinct from p_upt_id then raise exception 'BA_SCOPE_DENIED'; end if;
    if p_expected_version is null or old_row.version <> p_expected_version then raise exception 'BA_VERSION_MISMATCH'; end if;
    if old_row.stage not in ('DRAFT', 'REJECTED') then raise exception 'BA_STAGE_INVALID'; end if;
    if old_row.created_by <> auth.uid() and actor.role <> 'SUPERADMIN' then raise exception 'BA_ROLE_DENIED'; end if;
    update public.ba_non_stock set
      kind = next_kind,
      stage = next_stage,
      status = next_status,
      warehouse_id = nullif(btrim(coalesce(payload->>'warehouseId', payload->>'gudangId', '')), ''),
      security_guard_id = nullif(btrim(coalesce(payload->>'securityGuardId', payload->>'satpamId', '')), ''),
      issue_date = next_date,
      sender = nullif(btrim(coalesce(payload->>'sender', payload->>'source', '')), ''),
      destination_unit = nullif(btrim(coalesce(payload->>'destinationUnit', payload->>'unitTujuan', '')), ''),
      reference_document = nullif(btrim(coalesce(payload->>'referenceDocument', payload->>'reference', payload->>'referensi', '')), ''),
      purpose = nullif(btrim(coalesce(payload->>'purpose', payload->>'keperluan', '')), ''),
      recipient_name = nullif(btrim(coalesce(payload->>'recipientName', payload->>'penerimaNama', '')), ''),
      recipient_title = nullif(btrim(coalesce(payload->>'recipientTitle', payload->>'penerimaJabatan', '')), ''),
      recipient_unit = nullif(btrim(coalesce(payload->>'recipientUnit', payload->>'penerimaUnit', '')), ''),
      driver_name = nullif(btrim(coalesce(payload->>'driverName', payload->>'namaPengemudi', '')), ''),
      vehicle_number = nullif(btrim(coalesce(payload->>'vehicleNumber', payload->>'nomorKendaraan', '')), ''),
      photo_label_url = nullif(btrim(coalesce(payload->>'photoLabelUrl', payload->>'photoLabelPath', '')), ''),
      photo_loaded_url = nullif(btrim(coalesce(payload->>'photoLoadedUrl', payload->>'photoLoadedPath', '')), ''),
      version = version + 1,
      updated_at = now()
    where id = p_id
    returning version into next_version;
  end if;

  delete from public.ba_non_stock_items where ba_id = p_id;
  if jsonb_typeof(payload->'items') = 'array' then
    for item in select value from jsonb_array_elements(payload->'items') loop
      item_no := item_no + 1;
      item_name := nullif(btrim(coalesce(item->>'materialName', item->>'name', '')), '');
      item_unit := nullif(btrim(coalesce(item->>'unit', item->>'satuan', '')), '');
      item_description := btrim(coalesce(item->>'description', item->>'keterangan', ''));
      if nullif(btrim(coalesce(item->>'materialName', item->>'name', '')), '') is null
         and nullif(btrim(coalesce(item->>'qty', '')), '') is null
         and nullif(btrim(coalesce(item->>'unit', item->>'satuan', '')), '') is null
         and item_description = '' then
        continue;
      end if;
      item_qty_text := nullif(btrim(coalesce(item->>'qty', '')), '');
      if item_qty_text is not null and item_qty_text !~ '^[+]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$' then raise exception 'BA_ITEM_INVALID'; end if;
      item_qty := case when item_qty_text is null then null else item_qty_text::numeric end;
      if item_qty is not null and item_qty <= 0 then raise exception 'BA_ITEM_INVALID'; end if;
      insert into public.ba_non_stock_items(ba_id, line_no, material_name, qty, unit, description)
      values (p_id, item_no, item_name, item_qty, item_unit, item_description);
    end loop;
  end if;
  update public.ba_non_stock set updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'version', next_version, 'stage', next_stage, 'status', next_status);
end
$$;

create or replace function public.submit_ba_non_stock(
  p_id text,
  p_expected_version integer
)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  actor public.profiles;
  row public.ba_non_stock;
  guard_data jsonb;
begin
  select * into actor from public.profiles where id = auth.uid();
  if actor.id is null then raise exception 'BA_AUTH_REQUIRED'; end if;
  if actor.role not in ('ADMIN', 'TL', 'SUPERADMIN') then raise exception 'BA_ROLE_DENIED'; end if;
  select * into row from public.ba_non_stock where id = p_id for update;
  if row.id is null then raise exception 'BA_NOT_FOUND'; end if;
  if actor.role <> 'SUPERADMIN' and actor.upt_id is distinct from row.upt_id then raise exception 'BA_SCOPE_DENIED'; end if;
  if p_expected_version is null or row.version <> p_expected_version then raise exception 'BA_VERSION_MISMATCH'; end if;
  if row.created_by <> auth.uid() and actor.role <> 'SUPERADMIN' then raise exception 'BA_ROLE_DENIED'; end if;
  if row.stage <> 'DRAFT' or row.status <> 'DRAFT' then raise exception 'BA_STAGE_INVALID'; end if;
  perform public.ba_non_stock_assert_complete(row);
  select data into guard_data from public.satpam where id = row.security_guard_id;
  update public.ba_non_stock set
    stage = 'PENDING_TL', status = 'PENDING', version = version + 1,
    recipient_snapshot = jsonb_build_object('name', row.recipient_name, 'title', row.recipient_title, 'unit', row.recipient_unit),
    security_guard_snapshot = coalesce(guard_data, '{}'::jsonb) || jsonb_build_object('id', row.security_guard_id),
    submitted_by = auth.uid(), submitted_at = now(), updated_at = now()
  where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'version', row.version + 1, 'stage', 'PENDING_TL', 'status', 'PENDING');
end
$$;

create or replace function public.decide_ba_non_stock(
  p_id text,
  p_expected_version integer,
  p_decision text,
  p_reason text
)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  actor public.profiles;
  row public.ba_non_stock;
  decision text := upper(btrim(coalesce(p_decision, '')));
  year_no integer := extract(year from clock_timestamp())::integer;
  month_no text := to_char(clock_timestamp(), 'MM');
  next_seq bigint;
  doc_no text;
begin
  select * into actor from public.profiles where id = auth.uid();
  if actor.id is null then raise exception 'BA_AUTH_REQUIRED'; end if;
  if actor.role not in ('TL', 'SUPERADMIN') then raise exception 'BA_ROLE_DENIED'; end if;
  select * into row from public.ba_non_stock where id = p_id for update;
  if row.id is null then raise exception 'BA_NOT_FOUND'; end if;
  if actor.role = 'TL' and actor.upt_id is distinct from row.upt_id then raise exception 'BA_SCOPE_DENIED'; end if;
  if p_expected_version is null or row.version <> p_expected_version then raise exception 'BA_VERSION_MISMATCH'; end if;
  if row.stage <> 'PENDING_TL' or row.status <> 'PENDING' then raise exception 'BA_STAGE_INVALID'; end if;
  if decision not in ('APPROVE', 'REJECT') then raise exception 'BA_REQUIRED_FIELD'; end if;
  if decision = 'REJECT' then
    if nullif(btrim(p_reason), '') is null then raise exception 'BA_REJECT_REASON_REQUIRED'; end if;
    update public.ba_non_stock set
      stage = 'REJECTED', status = 'REJECTED', version = version + 1,
      rejected_by = auth.uid(), rejection_reason = btrim(p_reason), rejected_at = now(), updated_at = now()
    where id = p_id;
    return jsonb_build_object('ok', true, 'id', p_id, 'version', row.version + 1, 'stage', 'REJECTED', 'status', 'REJECTED', 'docNumber', row.doc_number);
  end if;

  perform public.ba_non_stock_assert_complete(row);
  insert into public.ba_non_stock_counters(upt_id, year, last_value, updated_at)
  values (row.upt_id, year_no, 1, now())
  on conflict (upt_id, year) do update set last_value = public.ba_non_stock_counters.last_value + 1, updated_at = now()
  returning last_value into next_seq;
  doc_no := lpad(next_seq::text, 3, '0') || '.BA/' || row.upt_id || '/' || month_no || '/' || year_no::text;
  update public.ba_non_stock set
    stage = 'APPROVED', status = 'APPROVED', version = version + 1,
    doc_number = doc_no, sequence_year = year_no, sequence_value = next_seq,
    tl_snapshot = jsonb_build_object('id', actor.id, 'name', actor.name, 'title', actor.jabatan, 'role', actor.role, 'uptId', actor.upt_id),
    approved_by = auth.uid(), approved_at = now(), updated_at = now()
  where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'version', row.version + 1, 'stage', 'APPROVED', 'status', 'APPROVED', 'docNumber', doc_no);
end
$$;

revoke all on function public.ba_non_stock_payload_has_data_url(jsonb) from public, anon, authenticated;
revoke all on function public.ba_non_stock_photo_path(text, text) from public, anon, authenticated;
revoke all on function public.ba_non_stock_assert_complete(public.ba_non_stock) from public, anon, authenticated;
revoke all on function public.save_ba_non_stock_draft(text, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.submit_ba_non_stock(text, integer) from public, anon, authenticated;
revoke all on function public.decide_ba_non_stock(text, integer, text, text) from public, anon, authenticated;
grant execute on function public.save_ba_non_stock_draft(text, integer, text, jsonb) to authenticated;
grant execute on function public.submit_ba_non_stock(text, integer) to authenticated;
grant execute on function public.decide_ba_non_stock(text, integer, text, text) to authenticated;



commit;
begin;
create or replace function public.approve_tug10_final(
  p_tug10_id text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor public.profiles;
  v_txn public.tug10_transactions;
  v_item jsonb;
  v_data jsonb;
  v_items jsonb;
  v_hash text;
  v_response jsonb;
  v_existing_idempotency public.tug_idempotency_keys;
  v_now bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_idx integer;
  v_qty numeric;
  v_already numeric;
  v_apply numeric;
  v_old_qty numeric;
  v_code text;
  v_catalog_key text;
  v_katalog_id text;
  v_katalog_data jsonb;
  v_stock public.stocks;
  v_stock_id text;
  v_stock_data jsonb;
  v_source_key text;
  v_source_lot jsonb;
  v_effect_key text;
  v_item_mode text;
  v_location_upt text;
  v_attb public.attb_list;
  v_attb_data jsonb;
  v_attb_id text;
  v_stocks jsonb := '[]'::jsonb;
  v_katalogs jsonb := '[]'::jsonb;
  v_attb_rows jsonb := '[]'::jsonb;
  v_target_stock_id text;
  v_candidate_count integer;
  v_return_effects jsonb;
  v_handling text;
  v_mara_data jsonb;
  v_catalog_code text;
begin
  if auth.uid() is null then
    raise exception 'TUG_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_tug10_id is null or btrim(p_tug10_id) = '' or p_idempotency_key is null then
    raise exception 'TUG10_INPUT_INVALID' using errcode = '23514';
  end if;

  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null then
    raise exception 'TUG_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if v_actor.role not in ('ASMAN','SUPERADMIN') then
    raise exception 'TUG10_APPROVAL_ROLE_DENIED' using errcode = '42501';
  end if;

  v_hash := md5('TUG10_FINAL_APPROVE|' || p_tug10_id);
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select * into v_existing_idempotency
  from public.tug_idempotency_keys
  where key = p_idempotency_key;
  if v_existing_idempotency.key is not null then
    if v_existing_idempotency.operation <> 'TUG10_FINAL_APPROVE'
       or v_existing_idempotency.actor_id <> v_actor.id
       or v_existing_idempotency.request_hash is distinct from v_hash then
      raise exception 'TUG_IDEMPOTENCY_REUSE_FORBIDDEN' using errcode = '42501';
    end if;
    return v_existing_idempotency.response || jsonb_build_object('idempotent', true);
  end if;

  select * into v_txn
  from public.tug10_transactions
  where id = p_tug10_id
  for update;
  if v_txn.id is null then
    raise exception 'TUG10_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.can_access_upt(v_txn.upt_id) then
    raise exception 'TUG10_SCOPE_DENIED' using errcode = '42501';
  end if;
  if v_txn.status = 'APPROVED' and v_txn.stage = 'APPROVED' then
    raise exception 'TUG10_ALREADY_APPROVED' using errcode = 'P0001';
  end if;
  if v_txn.status <> 'PENDING' or v_txn.stage <> 'PENDING_ASMAN' then
    raise exception 'TUG10_STAGE_INVALID' using errcode = 'P0001';
  end if;

  v_data := coalesce(v_txn.data, '{}'::jsonb);
  v_items := v_data->'stockItems';
  if coalesce(jsonb_typeof(v_items), '') <> 'array' or coalesce(jsonb_array_length(v_items), 0) = 0 then
    raise exception 'TUG10_ITEMS_REQUIRED' using errcode = '23514';
  end if;
  if v_txn.upt_id is null or btrim(v_txn.upt_id) = '' then
    raise exception 'TUG10_UPT_REQUIRED' using errcode = '23514';
  end if;
  select g.upt_id into v_location_upt
  from public.lokasi l
  join public.gudang g on g.id = l.gudang_id
  where l.id = nullif(btrim(v_data->>'lokasiTujuanId'), '');
  if v_location_upt is null then
    raise exception 'TUG10_LOCATION_NOT_FOUND' using errcode = '23514';
  end if;
  if v_location_upt <> v_txn.upt_id then
    raise exception 'TUG10_LOCATION_SCOPE_DENIED' using errcode = '42501';
  end if;

  perform set_config('app.tug10_final_rpc', 'on', true);

  for v_item, v_idx in
    select value, ordinality::integer - 1
    from jsonb_array_elements(v_items) with ordinality
  loop
    v_qty := nullif(btrim(v_item->>'qty'), '')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'TUG10_QTY_INVALID' using errcode = '23514';
    end if;
    if coalesce(v_item->>'statusMaterial', '') not in ('Material Sisa Baru','Bongkaran','Bongkaran ATTB (MTU)') then
      raise exception 'TUG10_MATERIAL_STATUS_INVALID' using errcode = '23514';
    end if;
    if nullif(btrim(v_item->>'fotoBarangRetur'), '') is null
       or left(btrim(v_item->>'fotoBarangRetur'), 5) = 'data:' then
      raise exception 'TUG10_RECEIPT_PHOTO_INVALID' using errcode = '23514';
    end if;
    if v_item->>'statusMaterial' = 'Bongkaran ATTB (MTU)'
       and (nullif(btrim(v_item->>'fotoNameplate'), '') is null
         or left(btrim(v_item->>'fotoNameplate'), 5) = 'data:') then
      raise exception 'TUG10_NAMEPLATE_REQUIRED' using errcode = '23514';
    end if;

    v_item_mode := coalesce(v_item->>'katalogMode', 'existing');
    if v_item_mode = 'existing' then
      v_katalog_id := nullif(btrim(v_item->>'katalogId'), '');
      if v_katalog_id is null then
        raise exception 'TUG10_CATALOG_REQUIRED' using errcode = '23514';
      end if;
      select data into v_katalog_data from public.katalog where id = v_katalog_id;
      if v_katalog_data is null then
        raise exception 'TUG10_CATALOG_NOT_FOUND' using errcode = 'P0002';
      end if;
      v_mara_data := public.tug_mara_resolve(v_katalog_data->>'katalog', 'TUG10');
      v_katalog_data := public.tug_mara_catalog_data(v_katalog_data, 'TUG10');
      update public.katalog set data = v_katalog_data where id = v_katalog_id;
    else
      v_code := nullif(btrim(v_item->>'katalogBaru'), '');
      if v_code is null then
        raise exception 'TUG10_NEW_CATALOG_INVALID' using errcode = '23514';
      end if;
      v_mara_data := public.tug_mara_resolve(v_code, 'TUG10');
      v_catalog_code := nullif(ltrim(btrim(v_mara_data->>'kode_material'), '0'), '');
      select count(*) into v_candidate_count
      from public.katalog
      where nullif(ltrim(btrim(data->>'katalog'), '0'), '') = v_catalog_code;
      if v_candidate_count > 1 then
        raise exception 'TUG10_CATALOG_AMBIGUOUS' using errcode = '23514';
      elsif v_candidate_count = 1 then
        select id, data into v_katalog_id, v_katalog_data
        from public.katalog
        where nullif(ltrim(btrim(data->>'katalog'), '0'), '') = v_catalog_code
        order by id limit 1;
        v_mara_data := public.tug_mara_resolve(v_katalog_data->>'katalog', 'TUG10');
        v_katalog_data := public.tug_mara_catalog_data(v_katalog_data, 'TUG10');
        update public.katalog set data = v_katalog_data where id = v_katalog_id;
      else
        v_katalog_id := 'KAT-TUG10-' || md5(v_txn.id || ':' || v_idx || ':' || (v_mara_data->>'kode_material'));
        v_katalog_data := public.tug_mara_catalog_data(
          jsonb_build_object(
            'id', v_katalog_id,
            'katalog', v_mara_data->>'kode_material',
            'sapStatus', 'Non-SAP',
            'createdAt', v_now
          ),
          'TUG10'
        );
        insert into public.katalog(id, data, created_at)
        values (v_katalog_id, v_katalog_data, v_now)
        on conflict (id) do nothing;
        select data into v_katalog_data from public.katalog where id = v_katalog_id;
      end if;
    end if;

    v_effect_key := v_txn.id || ':' || v_idx;
    v_source_key := 'TUG10|' || v_txn.id || '|' || v_idx;
    v_source_lot := jsonb_build_object(
      'key', v_source_key, 'kind', 'TUG10_RETURN',
      'supplier', coalesce(v_data->>'menyerahkanUnit',''),
      'sourceDocumentNo', coalesce(v_data->'docNumbers'->>'tug10', v_txn.doc_number, v_txn.id),
      'sourceDate', v_now, 'sourceTransactionId', v_txn.id,
      'sourceItemIndex', v_idx, 'status', 'ACTIVE'
    );

    v_handling := upper(nullif(btrim(v_item->>'stockHandling'), ''));
    if v_handling is not null and v_handling not in ('MERGE', 'SEPARATE') then
      raise exception 'TUG10_STOCK_HANDLING_INVALID' using errcode = '23514';
    end if;
    v_target_stock_id := nullif(btrim(v_item->>'targetStockId'), '');
    -- Backcompat: explicit target means MERGE; without a target, exactly one
    -- eligible row means MERGE, zero means a separate deterministic lot, and
    -- ambiguity fails closed.
    if v_handling is null then
      if v_target_stock_id is not null then
        v_handling := 'MERGE';
      else
        select count(*) into v_candidate_count
        from public.stocks
        where katalog_id = v_katalog_id
          and lokasi_id = (v_data->>'lokasiTujuanId')
          and coalesce(upt_id, data->>'uptId') = v_txn.upt_id
          and coalesce(data->'sourceLot'->>'status', '') <> 'NEEDS_SOURCE_ALLOCATION';
        if v_candidate_count > 1 then
          raise exception 'TUG10_TARGET_STOCK_AMBIGUOUS' using errcode = '23514';
        elsif v_candidate_count = 1 then
          select id into v_target_stock_id
          from public.stocks
          where katalog_id = v_katalog_id
            and lokasi_id = (v_data->>'lokasiTujuanId')
            and coalesce(upt_id, data->>'uptId') = v_txn.upt_id
            and coalesce(data->'sourceLot'->>'status', '') <> 'NEEDS_SOURCE_ALLOCATION'
          order by id limit 1;
          v_handling := 'MERGE';
        else
          v_handling := 'SEPARATE';
        end if;
      end if;
    end if;
    if v_handling = 'SEPARATE' then
      v_target_stock_id := null;
    elsif v_target_stock_id is null then
      raise exception 'TUG10_TARGET_STOCK_REQUIRED' using errcode = '23514';
    end if;

    if v_handling = 'MERGE' then
      select * into v_stock
      from public.stocks
      where id = v_target_stock_id
      for update;
      if v_stock.id is null then
        raise exception 'TUG10_TARGET_STOCK_NOT_FOUND' using errcode = 'P0002';
      end if;
      if v_stock.katalog_id is distinct from v_katalog_id
         or v_stock.lokasi_id is distinct from (v_data->>'lokasiTujuanId')
         or coalesce(v_stock.upt_id, v_stock.data->>'uptId') is distinct from v_txn.upt_id then
        raise exception 'TUG10_TARGET_STOCK_MISMATCH' using errcode = '23514';
      end if;
      if coalesce(v_stock.data->'sourceLot'->>'status', '') = 'NEEDS_SOURCE_ALLOCATION' then
        raise exception 'TUG10_TARGET_SOURCE_ALLOCATION_REQUIRED' using errcode = '23514';
      end if;
      v_stock_id := v_target_stock_id;
    else
      v_stock_id := 'STK-TUG10-' || md5(v_txn.id || ':' || v_idx);
      select * into v_stock
      from public.stocks
      where id = v_stock_id
      for update;
    end if;

    if v_stock.id is null then
      v_stock_data := jsonb_build_object(
        'id', v_stock_id, 'katalogId', v_katalog_id, 'lokasiId', v_data->>'lokasiTujuanId',
        'uptId', v_txn.upt_id, 'qty', v_qty, 'minQty', 0, 'price', 0,
        'jenisBarang', case v_item->>'statusMaterial' when 'Bongkaran ATTB (MTU)' then 'ATTB' when 'Bongkaran' then 'Bongkaran' else 'Persediaan' end,
        'sapStatus', 'Non-SAP', 'name', coalesce(v_katalog_data->>'name',''),
        'katalog', coalesce(v_katalog_data->>'katalog',''), 'unit', coalesce(v_katalog_data->>'satuan','unit'),
        'keteranganBarang', coalesce(v_item->>'keteranganBaru', v_item->>'keterangan', ''),
        'source', 'item', 'sourceLot', v_source_lot,
        'returnStatus', v_item->>'statusMaterial', 'img', v_item->>'fotoBarangRetur',
        'fotoKeseluruhan', v_item->>'fotoBarangRetur',
        'tug10ReturnEffects', jsonb_build_object(v_effect_key, jsonb_build_object(
          'qty', v_qty, 'at', v_now,
          'sourceDocumentNo', coalesce(v_data->'docNumbers'->>'tug10', v_txn.doc_number, v_txn.id)
        )), 'createdAt', v_now
      );
      insert into public.stocks(id, katalog_id, lokasi_id, upt_id, data, created_at)
      values (v_stock_id, v_katalog_id, v_data->>'lokasiTujuanId', v_txn.upt_id, v_stock_data, v_now);
      select * into v_stock from public.stocks where id = v_stock_id for update;
    else
      v_stock_data := coalesce(v_stock.data, '{}'::jsonb);
      v_old_qty := coalesce(nullif(v_stock_data->>'qty','')::numeric, 0);
      v_return_effects := coalesce(v_stock_data->'tug10ReturnEffects', '{}'::jsonb);
      v_already := coalesce(
        nullif(v_return_effects->v_effect_key->>'qty','')::numeric,
        nullif(v_return_effects->>v_effect_key,'')::numeric,
        nullif(v_stock_data->'_tug10Applied'->>v_effect_key,'')::numeric,
        0
      );
      if v_already > v_qty then
        raise exception 'TUG10_STOCK_MARKER_EXCEEDS_QTY' using errcode = '23514';
      end if;
      v_apply := v_qty - v_already;
      v_return_effects := v_return_effects || jsonb_build_object(v_effect_key, jsonb_build_object(
        'qty', v_qty, 'at', v_now,
        'sourceDocumentNo', coalesce(v_data->'docNumbers'->>'tug10', v_txn.doc_number, v_txn.id)
      ));
      if v_handling = 'MERGE' then
        v_stock_data := v_stock_data
          || jsonb_build_object('qty', v_old_qty + v_apply, 'img', v_item->>'fotoBarangRetur',
            'fotoKeseluruhan', v_item->>'fotoBarangRetur')
          || jsonb_build_object('tug10ReturnEffects', v_return_effects);
      else
        v_stock_data := v_stock_data
          || jsonb_build_object('qty', v_old_qty + v_apply, 'returnStatus', v_item->>'statusMaterial',
            'img', v_item->>'fotoBarangRetur', 'fotoKeseluruhan', v_item->>'fotoBarangRetur')
          || jsonb_build_object('tug10ReturnEffects', v_return_effects);
      end if;
      update public.stocks
      set data = v_stock_data, upt_id = coalesce(upt_id, v_txn.upt_id)
      where id = v_stock.id;
    end if;

    select data || jsonb_build_object('id', id, 'katalogId', katalog_id, 'lokasiId', lokasi_id) into v_stock_data from public.stocks where id = v_stock.id;
    v_stocks := v_stocks || jsonb_build_array(v_stock_data);

    select data into v_katalog_data from public.katalog where id = v_katalog_id for update;
    v_mara_data := public.tug_mara_resolve(v_katalog_data->>'katalog', 'TUG10');
    v_katalog_data := public.tug_mara_catalog_data(v_katalog_data, 'TUG10');
    update public.katalog set data = v_katalog_data where id = v_katalog_id;
    select data into v_katalog_data from public.katalog where id = v_katalog_id;
    v_katalogs := v_katalogs || jsonb_build_array(v_katalog_data || jsonb_build_object('id', v_katalog_id));

    if v_item->>'statusMaterial' = 'Bongkaran ATTB (MTU)' then
      select * into v_attb from public.attb_list
      where (data->>'sourceTxnId') = v_txn.id and (data->>'sourceItemIdx')::integer = v_idx
      order by id limit 1 for update;
      if v_attb.id is null then
        v_attb_id := 'ATTB-TUG10-' || md5(v_txn.id || ':' || v_idx);
        v_attb_data := jsonb_build_object(
          'id', v_attb_id, 'jenisAset', 'MATERIAL',
          'description', coalesce(v_katalog_data->>'name', '-'),
          'kuantitas', v_qty, 'satuan', coalesce(v_katalog_data->>'satuan', 'unit'),
          'noEquipment', coalesce(v_item->>'noSeri',''), 'nomorAT', coalesce(v_item->>'noSeri',''),
          'keterangan', 'Material Bongkaran TUG-10 ' || coalesce(v_data->'docNumbers'->>'tug10', v_txn.doc_number, v_txn.id),
          'foto', coalesce(v_item->>'fotoNameplate', v_item->>'fotoBarangRetur'), 'upt', v_txn.upt_id,
          'stage', 'USULAN_AE1', 'approvalStatus', 'DRAFT', 'lanjutBelumLanjut', false,
          'stageHistory', jsonb_build_array(jsonb_build_object('stage','USULAN_AE1','tanggal',v_now,'oleh',v_actor.id,'catatan','Dari penerimaan TUG-10 (Bongkaran ATTB/MTU)')),
          'source', 'TUG10', 'sourceTxnId', v_txn.id, 'sourceItemIdx', v_idx,
          'createdAt', v_now, 'createdBy', v_actor.id, 'updatedAt', v_now, 'updatedBy', v_actor.id
        );
        insert into public.attb_list(id, data, created_at, upt, stage)
        values (v_attb_id, v_attb_data, v_now, v_txn.upt_id, 'USULAN_AE1');
        select * into v_attb from public.attb_list where id = v_attb_id;
      end if;
      select data || jsonb_build_object('id', id, 'upt', upt, 'stage', stage) into v_attb_data from public.attb_list where id = v_attb.id;
      v_attb_rows := v_attb_rows || jsonb_build_array(v_attb_data);
    end if;
  end loop;

  v_data := v_data || jsonb_build_object(
    'status', 'APPROVED', 'stage', 'APPROVED', 'approvedBy', v_actor.id,
    'approvedAt', v_now, 'approvedByAsman', v_actor.id, 'approvedAtAsman', v_now, 'requiredApprover', null
  );
  update public.tug10_transactions
  set status = 'APPROVED', stage = 'APPROVED', data = v_data,
      updated_at = v_now
  where id = v_txn.id;
  select * into v_txn from public.tug10_transactions where id = v_txn.id;

  if to_regclass('public.audit_log') is not null then
    execute 'insert into public.audit_log(user_id,user_name,role,action,entity,entity_id,detail) values ($1,$2,$3,$4,$5,$6,$7)'
      using v_actor.id, v_actor.name, v_actor.role, 'APPROVE', 'TUG10',
        coalesce(v_txn.doc_number, v_txn.id), jsonb_build_object('stage','APPROVED','atomic',true);
  end if;

  v_response := jsonb_build_object(
    'transaction', v_txn.data || jsonb_build_object('id', v_txn.id, 'status', v_txn.status, 'stage', v_txn.stage, 'uptId', v_txn.upt_id),
    'stocks', v_stocks, 'katalogs', v_katalogs, 'attbDrafts', v_attb_rows, 'idempotent', false
  );
  insert into public.tug_idempotency_keys(key, operation, actor_id, request_hash, response)
  values (p_idempotency_key, 'TUG10_FINAL_APPROVE', v_actor.id, v_hash, v_response);
  return v_response;
end;
$$;

revoke all on function public.approve_tug10_final(text, uuid) from public, anon;
grant execute on function public.approve_tug10_final(text, uuid) to authenticated;
commit;

-- Mirror of 20261012b_mara_catalog_resolver_index.sql.
-- schema.sql is applied transactionally, so this mirror uses regular CREATE INDEX.
create index if not exists idx_mara_catalog_resolver_code
  on public.mara_catalog ((nullif(ltrim(btrim(coalesce(kode_material, '')), '0'), '')));

-- ATTB unit trace: one QR and one append-only timeline per new TUG-10 ATTB item.
-- Legacy attb_list rows intentionally receive no public link or backfill.

begin;

create table if not exists public.attb_public_links (
  attb_id text primary key references public.attb_list(id) on delete cascade,
  public_token uuid not null default gen_random_uuid(),
  upt_id text not null,
  source_tug10_key text not null,
  created_at bigint not null,
  rotated_at bigint
);
create unique index if not exists attb_public_links_token_uidx
  on public.attb_public_links(public_token);
create unique index if not exists attb_public_links_source_uidx
  on public.attb_public_links(source_tug10_key);
create index if not exists attb_public_links_upt_idx
  on public.attb_public_links(upt_id);

create table if not exists public.attb_item_history (
  id bigint generated by default as identity primary key,
  attb_id text not null references public.attb_list(id) on delete cascade,
  upt_id text not null,
  event_type text not null,
  stage text,
  occurred_at bigint not null,
  actor_id uuid references public.profiles(id) on delete set null,
  snapshot jsonb not null default '{}'::jsonb
);
create index if not exists attb_item_history_attb_idx
  on public.attb_item_history(attb_id, occurred_at, id);
create index if not exists attb_item_history_upt_idx
  on public.attb_item_history(upt_id, occurred_at desc);
create unique index if not exists attb_item_history_received_uidx
  on public.attb_item_history(attb_id, event_type)
  where event_type = 'RECEIVED_TUG10';

alter table public.attb_public_links enable row level security;
alter table public.attb_item_history enable row level security;
drop policy if exists "Scoped read attb_public_links" on public.attb_public_links;
drop policy if exists "Scoped read attb_item_history" on public.attb_item_history;
create policy "Scoped read attb_public_links" on public.attb_public_links
  for select to authenticated using (public.can_access_upt(upt_id));
create policy "Scoped read attb_item_history" on public.attb_item_history
  for select to authenticated using (public.can_access_upt(upt_id));
revoke all on table public.attb_public_links from public, anon, authenticated;
revoke all on table public.attb_item_history from public, anon, authenticated;
grant select on table public.attb_public_links to authenticated;
grant select on table public.attb_item_history to authenticated;
grant all on table public.attb_public_links to service_role;
grant all on table public.attb_item_history to service_role;
grant usage, select on sequence public.attb_item_history_id_seq to service_role;

create or replace function public.attb_trace_history_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op <> 'INSERT' or coalesce(current_setting('app.attb_trace_write', true), '') <> 'on' then
    raise exception 'ATTB_HISTORY_APPEND_ONLY' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_attb_history_append_only on public.attb_item_history;
create trigger trg_attb_history_append_only
before insert or update or delete on public.attb_item_history
for each row execute function public.attb_trace_history_guard();
revoke all on function public.attb_trace_history_guard() from public, anon, authenticated;

create or replace function public.attb_trace_source_item(p_attb public.attb_list)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_txn public.tug10_transactions;
  v_idx integer;
begin
  if coalesce(p_attb.data->>'source', '') <> 'TUG10'
     or nullif(p_attb.data->>'sourceTxnId', '') is null
     or nullif(p_attb.data->>'sourceItemIdx', '') is null then
    return null;
  end if;
  v_idx := (p_attb.data->>'sourceItemIdx')::integer;
  select * into v_txn from public.tug10_transactions where id = p_attb.data->>'sourceTxnId';
  if v_txn.id is null then return null; end if;
  return jsonb_build_object(
    'txn', to_jsonb(v_txn),
    'item', v_txn.data->'stockItems'->v_idx,
    'index', v_idx
  );
end;
$$;
revoke all on function public.attb_trace_source_item(public.attb_list) from public, anon, authenticated;

create or replace function public.attb_trace_before_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_source jsonb;
  v_item jsonb;
  v_kat jsonb;
  v_upt_name text;
  v_source_key text;
begin
  if tg_op = 'INSERT' or tg_op = 'UPDATE' then
    if nullif(new.upt, '') is not null then
      select u.data->>'nama' into v_upt_name from public.upt u where u.id = new.upt limit 1;
      if v_upt_name is not null then new.upt := v_upt_name; end if;
    end if;
    if coalesce(new.data->>'source', '') = 'TUG10'
       and nullif(new.data->>'sourceTxnId', '') is not null
       and nullif(new.data->>'sourceItemIdx', '') is not null then
      v_source := public.attb_trace_source_item(new);
      v_item := v_source->'item';
      v_source_key := 'TUG10|' || (new.data->>'sourceTxnId') || '|' || (new.data->>'sourceItemIdx');
      select k.data into v_kat from public.katalog k where k.id = nullif(v_item->>'katalogId', '') limit 1;
      new.data := coalesce(new.data, '{}'::jsonb) || jsonb_build_object(
        'sourceTug10Key', v_source_key,
        'noSeri', coalesce(v_item->>'noSeri', new.data->>'noSeri', ''),
        'noAsset', coalesce(v_item->>'noAsset', new.data->>'noAsset', ''),
        'katalogId', coalesce(v_item->>'katalogId', new.data->>'katalogId', ''),
        'katalog', coalesce(v_kat->>'katalog', new.data->>'katalog', ''),
        'name', coalesce(v_kat->>'name', v_kat->>'nama', new.data->>'name', new.data->>'description', ''),
        'unit', coalesce(v_kat->>'satuan', v_kat->>'unit', new.data->>'unit', 'unit'),
        'fotoKeseluruhan', coalesce(v_item->>'fotoBarangRetur', v_item->>'fotoBarang', new.data->>'fotoKeseluruhan', ''),
        'fotoNameplate', coalesce(v_item->>'fotoNameplate', new.data->>'fotoNameplate', '')
      );
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_attb_trace_before_write on public.attb_list;
create trigger trg_attb_trace_before_write
before insert or update on public.attb_list
for each row execute function public.attb_trace_before_write();
revoke all on function public.attb_trace_before_write() from public, anon, authenticated;

create or replace function public.attb_trace_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_source jsonb;
  v_item jsonb;
  v_txn jsonb;
  v_source_key text;
  v_now bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_actor uuid;
  v_upt_id text;
begin
  if coalesce(new.data->>'source', '') <> 'TUG10' then return new; end if;
  v_source := public.attb_trace_source_item(new);
  if v_source is null then return new; end if;
  v_item := v_source->'item';
  v_txn := v_source->'txn';
  if coalesce(v_item->>'statusMaterial', '') <> 'Bongkaran ATTB (MTU)' then return new; end if;
  v_source_key := 'TUG10|' || (new.data->>'sourceTxnId') || '|' || (new.data->>'sourceItemIdx');
  v_upt_id := v_txn->>'upt_id';
  v_actor := nullif(new.data->>'createdBy', '')::uuid;
  perform set_config('app.attb_trace_write', 'on', true);
  insert into public.attb_public_links(attb_id, public_token, upt_id, source_tug10_key, created_at)
  values (new.id, gen_random_uuid(), v_upt_id, v_source_key, v_now)
  on conflict (attb_id) do nothing;
  insert into public.attb_item_history(attb_id, upt_id, event_type, stage, occurred_at, actor_id, snapshot)
  values (
    new.id, v_upt_id, 'RECEIVED_TUG10', new.stage, v_now, v_actor,
    jsonb_build_object(
      'sourceTug10Key', v_source_key,
      'tug10No', coalesce(v_txn->'data'->'docNumbers'->>'tug10', v_txn->>'doc_number', v_txn->>'id'),
      'catalog', new.data->>'katalog', 'name', new.data->>'name',
      'serial', new.data->>'noSeri', 'assetNo', new.data->>'noAsset',
      'fotoKeseluruhan', new.data->>'fotoKeseluruhan', 'fotoNameplate', new.data->>'fotoNameplate'
    )
  )
  on conflict (attb_id, event_type) where event_type = 'RECEIVED_TUG10' do nothing;
  perform set_config('app.attb_trace_write', 'off', true);
  return new;
end;
$$;
drop trigger if exists trg_attb_trace_after_insert on public.attb_list;
create trigger trg_attb_trace_after_insert
after insert on public.attb_list
for each row execute function public.attb_trace_after_insert();
revoke all on function public.attb_trace_after_insert() from public, anon, authenticated;

create or replace function public.attb_trace_before_tug10_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_item jsonb;
  v_qty numeric;
begin
  if new.status = 'APPROVED' and new.stage = 'APPROVED'
     and (old.status is distinct from new.status or old.stage is distinct from new.stage) then
    for v_item in select value from jsonb_array_elements(coalesce(new.data->'stockItems', '[]'::jsonb)) loop
      if v_item->>'statusMaterial' = 'Bongkaran ATTB (MTU)' then
        v_qty := nullif(btrim(v_item->>'qty'), '')::numeric;
        if v_qty is distinct from 1 then
          raise exception 'TUG10_ATTB_QTY_INVALID' using errcode = '23514';
        end if;
        if nullif(btrim(v_item->>'noSeri'), '') is null
           and nullif(btrim(v_item->>'noAsset'), '') is null then
          raise exception 'TUG10_ATTB_IDENTITY_REQUIRED' using errcode = '23514';
        end if;
      end if;
    end loop;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_attb_trace_before_tug10_approval on public.tug10_transactions;
create trigger trg_attb_trace_before_tug10_approval
before update on public.tug10_transactions
for each row execute function public.attb_trace_before_tug10_approval();
revoke all on function public.attb_trace_before_tug10_approval() from public, anon, authenticated;

create or replace function public.attb_trace_after_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_event text;
  v_now bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_actor uuid := auth.uid();
begin
  if coalesce(old.data->>'source', '') <> 'TUG10' or new.id is null then return new; end if;
  if old.stage is distinct from new.stage then v_event := 'STAGE_CHANGED';
  elsif old.upt is distinct from new.upt
     or old.data->>'lokasiId' is distinct from new.data->>'lokasiId'
     or old.data->>'gudangId' is distinct from new.data->>'gudangId'
     or old.data->>'subGudangId' is distinct from new.data->>'subGudangId' then v_event := 'LOCATION_CHANGED';
  elsif old.data->>'lanjutBelumLanjut' is distinct from new.data->>'lanjutBelumLanjut' then v_event := 'HOLD_CHANGED';
  elsif old.data->>'approvalStatus' is distinct from new.data->>'approvalStatus' then v_event := 'APPROVAL_CHANGED';
  else return new;
  end if;
  perform set_config('app.attb_trace_write', 'on', true);
  insert into public.attb_item_history(attb_id, upt_id, event_type, stage, occurred_at, actor_id, snapshot)
  values (new.id, coalesce((select u.id from public.upt u where u.data->>'nama' = new.upt limit 1), (select t.upt_id from public.tug10_transactions t where t.id = new.data->>'sourceTxnId')), v_event, new.stage, v_now, v_actor,
    jsonb_build_object('stage', new.stage, 'upt', new.upt, 'approvalStatus', new.data->>'approvalStatus', 'lanjutBelumLanjut', new.data->>'lanjutBelumLanjut'));
  perform set_config('app.attb_trace_write', 'off', true);
  return new;
end;
$$;
drop trigger if exists trg_attb_trace_after_update on public.attb_list;
create trigger trg_attb_trace_after_update
after update on public.attb_list
for each row execute function public.attb_trace_after_update();
revoke all on function public.attb_trace_after_update() from public, anon, authenticated;

create or replace function public.rotate_attb_public_token(p_attb_id text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  a public.profiles;
  x public.attb_list;
  t uuid := gen_random_uuid();
  now_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  upt_id text;
begin
  select * into a from public.profiles where id = auth.uid();
  if a.id is null or a.role not in ('TL','SUPERADMIN') then raise exception 'ATTB_TOKEN_ROTATION_DENIED' using errcode = '42501'; end if;
  select * into x from public.attb_list where id = p_attb_id for update;
  if x.id is null then raise exception 'ATTB_NOT_FOUND' using errcode = 'P0002'; end if;
  select u.id into upt_id from public.upt u where u.data->>'nama' = x.upt limit 1;
  if not public.can_access_upt(upt_id) then raise exception 'ATTB_SCOPE_DENIED' using errcode = '42501'; end if;
  update public.attb_public_links set public_token = t, rotated_at = now_ms where attb_id = p_attb_id;
  if not found then raise exception 'ATTB_PUBLIC_LINK_NOT_FOUND' using errcode = 'P0002'; end if;
  perform set_config('app.attb_trace_write', 'on', true);
  insert into public.attb_item_history(attb_id, upt_id, event_type, stage, occurred_at, actor_id, snapshot)
  values (p_attb_id, upt_id, 'TOKEN_ROTATED', x.stage, now_ms, a.id, jsonb_build_object('rotatedAt', now_ms));
  perform set_config('app.attb_trace_write', 'off', true);
  return t;
end;
$$;
revoke all on function public.rotate_attb_public_token(text) from public, anon;
grant execute on function public.rotate_attb_public_token(text) to authenticated;

create or replace function public.public_attb_material(p_attb_id text, p_token uuid)
returns jsonb
language sql stable security definer set search_path = pg_catalog
as $$
  select case when l.attb_id is null or l.public_token is distinct from p_token then null::jsonb
    else jsonb_build_object(
      'trackingCode', a.id,
      'material', jsonb_build_object('catalog', a.data->>'katalog', 'name', coalesce(a.data->>'name', a.data->>'description', ''), 'unit', coalesce(a.data->>'unit', a.data->>'satuan', 'unit'), 'serial', a.data->>'noSeri', 'assetNo', a.data->>'noAsset'),
      'source', jsonb_build_object('tug10No', coalesce(t.data->'docNumbers'->>'tug10', t.doc_number, t.id), 'receivedAt', l.created_at),
      'location', jsonb_build_object('upt', coalesce(u.data->>'nama', u.data->>'kode', u.id), 'gudang', coalesce(g.data->>'nama', g.data->>'kode', g.id), 'subGudang', coalesce(sg.data->>'nama', sg.data->>'kode', ''), 'blok', coalesce(loc.data->>'kode', loc.data->>'nama', loc.id)),
      'photos', jsonb_build_object('overall', case when a.data->>'fotoKeseluruhan' like 'https://warnoto.com/storage/v1/object/public/tug-photos/%' or a.data->>'fotoKeseluruhan' like 'https://api-staging.warnoto.com/storage/v1/object/public/tug-photos/%' then substring(a.data->>'fotoKeseluruhan' from '/tug-photos/(.*)$') else null end, 'nameplate', case when a.data->>'fotoNameplate' like 'https://warnoto.com/storage/v1/object/public/tug-photos/%' or a.data->>'fotoNameplate' like 'https://api-staging.warnoto.com/storage/v1/object/public/tug-photos/%' then substring(a.data->>'fotoNameplate' from '/tug-photos/(.*)$') else null end),
      'status', a.stage,
      'timeline', coalesce((select jsonb_agg(jsonb_build_object('at', h.occurred_at, 'label', case h.event_type when 'RECEIVED_TUG10' then 'Diterima dari TUG-10' when 'TOKEN_ROTATED' then 'QR diganti' when 'STAGE_CHANGED' then 'Tahap berubah' when 'LOCATION_CHANGED' then 'Lokasi berubah' when 'HOLD_CHANGED' then 'Status ditahan/dilanjutkan' when 'APPROVAL_CHANGED' then 'Approval berubah' else 'Perubahan ATTB' end) order by h.occurred_at, h.id) from public.attb_item_history h where h.attb_id = a.id), '[]'::jsonb)
    ) end
  from public.attb_public_links l
  join public.attb_list a on a.id = l.attb_id
  left join public.tug10_transactions t on t.id = a.data->>'sourceTxnId'
  left join public.lokasi loc on loc.id = coalesce(nullif(a.data->>'lokasiId', ''), t.data->>'lokasiTujuanId')
  left join public.gudang g on g.id = loc.gudang_id
  left join public.sub_gudang sg on sg.id = loc.data->>'subGudangId'
  left join public.upt u on u.id = coalesce((select u2.id from public.upt u2 where u2.data->>'nama' = a.upt limit 1), t.upt_id)
  where l.attb_id = p_attb_id;
$$;
revoke all on function public.public_attb_material(text, uuid) from public, authenticated;
grant execute on function public.public_attb_material(text, uuid) to anon;
grant execute on function public.public_attb_material(text, uuid) to authenticated;

-- 20261015. Foto Data Stok ditulis lewat RPC sempit agar guard TUG-3 tetap aktif.
create or replace function public.stock_photo_object_path(p_url text)
returns text language plpgsql stable security definer set search_path = public, pg_catalog
as $$
declare v_path text;
begin
  if coalesce(p_url, '') !~* '^https://warnoto[.]com/storage/v1/object/public/stock-photos/[^?#]+$' then return null; end if;
  v_path := regexp_replace(p_url, '^https://warnoto[.]com/storage/v1/object/public/stock-photos/', '');
  return nullif(v_path, '');
end;
$$;
revoke all on function public.stock_photo_object_path(text) from public, anon, authenticated;

create or replace function public.update_stock_photo(p_stock_id text, p_field text, p_photo_url text)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_actor public.profiles; v_stock public.stocks; v_upt_id text; v_path text; v_old_url text;
  v_data jsonb; v_history jsonb; v_now bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then raise exception 'STOCK_PHOTO_AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_field is null or p_field not in ('fotoNameplate', 'fotoKeseluruhan') then raise exception 'STOCK_PHOTO_FIELD_INVALID' using errcode = '22023'; end if;
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null or v_actor.role not in ('ADMIN', 'TL', 'SUPERADMIN') then raise exception 'STOCK_PHOTO_ROLE_DENIED' using errcode = '42501'; end if;
  select * into v_stock from public.stocks where id = p_stock_id for update;
  if v_stock.id is null then raise exception 'STOCK_PHOTO_NOT_FOUND' using errcode = 'P0002'; end if;
  v_upt_id := coalesce(nullif(v_stock.upt_id, ''), nullif(v_stock.data->>'uptId', ''));
  if v_upt_id is null then raise exception 'STOCK_PHOTO_UPT_REQUIRED' using errcode = '42501'; end if;
  if not public.can_access_upt(v_upt_id) then raise exception 'STOCK_PHOTO_SCOPE_DENIED' using errcode = '42501'; end if;
  v_path := public.stock_photo_object_path(p_photo_url);
  if v_path is null or lower(split_part(v_path, '/', 1)) <> lower(v_upt_id) then raise exception 'STOCK_PHOTO_URL_INVALID' using errcode = '22023'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'stock-photos' and name = v_path) then raise exception 'STOCK_PHOTO_OBJECT_MISSING' using errcode = 'P0002'; end if;
  v_old_url := nullif(v_stock.data->>p_field, '');
  if v_old_url is not distinct from p_photo_url then
    return coalesce(v_stock.data, '{}'::jsonb) || jsonb_build_object('id', v_stock.id, 'katalogId', v_stock.katalog_id, 'lokasiId', v_stock.lokasi_id, 'uptId', v_upt_id);
  end if;
  v_history := coalesce(v_stock.data->'photoHistory', '[]'::jsonb);
  if jsonb_typeof(v_history) <> 'array' then v_history := '[]'::jsonb; end if;
  if v_old_url is not null and left(v_old_url, 5) <> 'data:' then
    v_history := v_history || jsonb_build_array(jsonb_build_object('id', 'MANUAL:' || v_upt_id || ':' || v_stock.id || ':' || p_field || ':' || v_now, 'source', 'MANUAL', 'sourceId', v_stock.id, 'uptId', v_upt_id, 'at', v_now, 'before', jsonb_build_object(p_field, v_old_url)));
  end if;
  v_data := coalesce(v_stock.data, '{}'::jsonb) || jsonb_build_object(p_field, p_photo_url, 'photoHistory', v_history, 'updatedAt', v_now);
  if p_field = 'fotoNameplate' then v_data := v_data || jsonb_build_object('fotoNameplateOcr', null); end if;
  update public.stocks set data = v_data where id = v_stock.id;
  select * into v_stock from public.stocks where id = p_stock_id;
  return coalesce(v_stock.data, '{}'::jsonb) || jsonb_build_object('id', v_stock.id, 'katalogId', v_stock.katalog_id, 'lokasiId', v_stock.lokasi_id, 'uptId', coalesce(v_stock.upt_id, v_upt_id));
end;
$$;

create or replace function public.update_stock_nameplate_ocr(p_stock_id text, p_photo_url text, p_ocr_text text)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_actor public.profiles; v_stock public.stocks; v_upt_id text; v_path text; v_data jsonb;
  v_now bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint; v_canonical jsonb;
begin
  if auth.uid() is null then raise exception 'STOCK_PHOTO_AUTH_REQUIRED' using errcode = '42501'; end if;
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null or v_actor.role not in ('ADMIN', 'TL', 'SUPERADMIN') then raise exception 'STOCK_PHOTO_ROLE_DENIED' using errcode = '42501'; end if;
  select * into v_stock from public.stocks where id = p_stock_id for update;
  if v_stock.id is null then raise exception 'STOCK_PHOTO_NOT_FOUND' using errcode = 'P0002'; end if;
  v_upt_id := coalesce(nullif(v_stock.upt_id, ''), nullif(v_stock.data->>'uptId', ''));
  if v_upt_id is null or not public.can_access_upt(v_upt_id) then raise exception 'STOCK_PHOTO_SCOPE_DENIED' using errcode = '42501'; end if;
  v_canonical := coalesce(v_stock.data, '{}'::jsonb) || jsonb_build_object('id', v_stock.id, 'katalogId', v_stock.katalog_id, 'lokasiId', v_stock.lokasi_id, 'uptId', v_upt_id);
  if v_stock.data->>'fotoNameplate' is distinct from p_photo_url then return jsonb_build_object('updated', false, 'reason', 'STALE_PHOTO', 'stock', v_canonical); end if;
  v_path := public.stock_photo_object_path(p_photo_url);
  if v_path is null or lower(split_part(v_path, '/', 1)) <> lower(v_upt_id) then raise exception 'STOCK_PHOTO_URL_INVALID' using errcode = '22023'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'stock-photos' and name = v_path) then raise exception 'STOCK_PHOTO_OBJECT_MISSING' using errcode = 'P0002'; end if;
  v_data := coalesce(v_stock.data, '{}'::jsonb) || jsonb_build_object('fotoNameplateOcr', left(coalesce(p_ocr_text, ''), 20000), 'updatedAt', v_now);
  update public.stocks set data = v_data where id = v_stock.id;
  select * into v_stock from public.stocks where id = p_stock_id;
  return jsonb_build_object('updated', true, 'stock', coalesce(v_stock.data, '{}'::jsonb) || jsonb_build_object('id', v_stock.id, 'katalogId', v_stock.katalog_id, 'lokasiId', v_stock.lokasi_id, 'uptId', coalesce(v_stock.upt_id, v_upt_id)));
end;
$$;
revoke all on function public.update_stock_photo(text, text, text) from public, anon;
grant execute on function public.update_stock_photo(text, text, text) to authenticated;
revoke all on function public.update_stock_nameplate_ocr(text, text, text) from public, anon;
grant execute on function public.update_stock_nameplate_ocr(text, text, text) to authenticated;

commit;
