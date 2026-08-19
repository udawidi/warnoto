-- Scope satpam per-UPT (2026-08-19).
-- Sebelumnya policy `satpam` = semua authenticated baca/tulis SEMUA UPT, sedangkan
-- `gudang` sudah di-scope per-UPT lewat can_access_upt(). Akibatnya TL UPT-SBY ke-load
-- satpam Gresik/Probolinggo juga → muncul palsu sebagai "Belum di-assign gudang"
-- (gudang mereka tak ada di gudangList yang ter-scope). Definisi yang benar:
-- seorang user boleh melihat satpam HANYA jika ia boleh mengakses UPT gudang satpam itu.

-- Helper SECURITY DEFINER: ambil upt_id gudang tanpa terpengaruh RLS gudang, supaya
-- ekspresi policy deterministik (tidak bergantung apakah baris gudang kebetulan lolos
-- RLS saat subquery dijalankan). Satpam tanpa gudangId → null → can_access_upt(null)
-- hanya true untuk SUPERADMIN/ADMIN_LOG_PUSAT (mereka tetap bisa melihat & menugaskan).
create or replace function public.satpam_gudang_upt(p_gudang_id text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select upt_id from gudang where id = p_gudang_id
$function$;

drop policy if exists "Authenticated write satpam" on public.satpam;

create policy "Scoped all satpam"
  on public.satpam
  for all
  using (can_access_upt(satpam_gudang_upt(data->>'gudangId')))
  with check (can_access_upt(satpam_gudang_upt(data->>'gudangId')));
