-- 2026-09-17: role HAR_UIT (pemeliharaan level UIT) belum terdaftar di RLS can_access_upt,
-- akibatnya akun HAR UIT tidak bisa membaca stok/tabel UPT-scoped (RLS return 0 baris) —
-- bug "Data Stok kosong". Tambahkan HAR_UIT ke cabang UIT (sejajar ADMIN_UIT/ASMAN_LOG_UIT/
-- MGR_LOGISTIK_UIT). can_access_upt_nama mendelegasi ke fungsi ini, jadi ikut terperbaiki.
-- Idempoten (CREATE OR REPLACE); hanya MENAMBAH HAR_UIT, cabang lain tidak berubah.

create or replace function public.can_access_upt(p_upt_id text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from profiles actor
    where actor.id = auth.uid()
      and (
        actor.role = 'SUPERADMIN'
        or actor.role = 'ADMIN_LOG_PUSAT'
        or (
          p_upt_id is not null
          and (
            actor.upt_id = p_upt_id
            or (
              actor.role in ('ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT','HAR_UIT')
              and actor.uit_id is not null
              and exists (select 1 from upt u where u.id = p_upt_id and u.uit_id = actor.uit_id)
            )
            or (
              actor.role in ('ADMIN_ULTG','MGR_ULTG')
              and actor.ultg_id is not null
              and exists (select 1 from ultg ul where ul.id = actor.ultg_id and ul.upt_id = p_upt_id)
            )
          )
        )
      )
  );
$$;
revoke all on function public.can_access_upt(text) from public;
grant execute on function public.can_access_upt(text) to authenticated;
