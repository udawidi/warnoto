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
