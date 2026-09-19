-- PROPOSAL ONLY — apply to production self-host only after explicit user approval.
-- Stock Opname photos stay publicly readable for QR, but writes are tenant-scoped.

begin;

create or replace function public.can_write_stock_photo_path(p_name text)
returns boolean
language sql
security definer
set search_path = public, storage
stable
as $$
  select auth.uid() is not null
    and split_part(coalesce(p_name, ''), '/', 1) <> ''
    and exists (
      select 1
      from public.upt u
      where lower(u.id) = lower(split_part(p_name, '/', 1))
        and public.can_access_upt(u.id)
    )
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('ADMIN', 'TL', 'ASMAN', 'SUPERADMIN')
    );
$$;

revoke all on function public.can_write_stock_photo_path(text) from public;
grant execute on function public.can_write_stock_photo_path(text) to authenticated;

drop policy if exists "Public upload stock-photos" on storage.objects;
drop policy if exists "Public update stock-photos" on storage.objects;
drop policy if exists "Stock Opname upload stock-photos" on storage.objects;
drop policy if exists "Stock Opname update stock-photos" on storage.objects;

create policy "Stock Opname upload stock-photos" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'stock-photos'
    and public.can_write_stock_photo_path(name)
  );

create policy "Stock Opname update stock-photos" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'stock-photos'
    and public.can_write_stock_photo_path(name)
  )
  with check (
    bucket_id = 'stock-photos'
    and public.can_write_stock_photo_path(name)
  );

commit;

-- Public-read is intentionally unchanged. The bucket remains public for QR.
