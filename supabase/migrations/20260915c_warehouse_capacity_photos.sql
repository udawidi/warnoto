-- PROPOSAL ONLY: apply to self-host after explicit user approval.
alter table public.warehouse_capacity
  add column if not exists foto_path text;

insert into storage.buckets (id, name, public)
values ('warehouse-capacity-photos', 'warehouse-capacity-photos', false)
on conflict (id) do update set public = false;

drop policy if exists "Authenticated read warehouse capacity photos" on storage.objects;
drop policy if exists "Capacity editors upload warehouse photos" on storage.objects;
drop policy if exists "Capacity editors delete warehouse photos" on storage.objects;

create policy "Authenticated read warehouse capacity photos" on storage.objects
  for select using (
    bucket_id = 'warehouse-capacity-photos'
    and auth.role() = 'authenticated'
  );

create policy "Capacity editors upload warehouse photos" on storage.objects
  for insert with check (
    bucket_id = 'warehouse-capacity-photos'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('ADMIN', 'TL', 'SUPERADMIN')
    )
  );

create policy "Capacity editors delete warehouse photos" on storage.objects
  for delete using (
    bucket_id = 'warehouse-capacity-photos'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('ADMIN', 'TL', 'SUPERADMIN')
    )
  );
