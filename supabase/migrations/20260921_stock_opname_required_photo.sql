-- PROPOSAL ONLY. Apply to self-host after verifying existing opname rows.
-- Enforces the same rule as the client and approval RPC: positive physical qty
-- needs a real object in the tenant's self-host stock-photos bucket.
begin;

create or replace function public.stock_opname_photo_url_valid(p_url text, p_upt_id text)
returns boolean
language plpgsql
security definer
set search_path = public, storage, pg_catalog
as $$
declare
  v_path text;
begin
  if p_url is null or p_upt_id is null
    or p_url !~* '^https://warnoto[.]com/storage/v1/object/(public|sign|authenticated)/stock-photos/' then
    return false;
  end if;
  v_path := regexp_replace(p_url, '^.*\/stock-photos\/', '');
  if v_path = p_url or split_part(lower(v_path), '/', 1) <> lower(p_upt_id) then
    return false;
  end if;
  return exists (
    select 1 from storage.objects
    where bucket_id = 'stock-photos' and name = v_path
  );
end;
$$;

create or replace function public.stock_opname_required_photo_missing(p_data jsonb, p_upt_id text)
returns boolean
language sql
security definer
set search_path = public, storage, pg_catalog
as $$
  select exists (
    select 1
    from jsonb_array_elements(case when jsonb_typeof(coalesce(p_data->'items', 'null'::jsonb)) = 'array' then p_data->'items' else '[]'::jsonb end) item
    where coalesce(nullif(item->>'qtsFisik', ''), '0')::numeric > 0
      and not public.stock_opname_photo_url_valid(item->>'fotoKeseluruhan', p_upt_id)
  );
$$;

create or replace function public.guard_stock_opname_required_photo()
returns trigger
language plpgsql
security definer
set search_path = public, storage, pg_catalog
as $$
begin
  if (tg_op = 'INSERT' and new.status = 'PENDING_ASMAN')
    or (tg_op = 'UPDATE' and old.status is distinct from new.status and new.status in ('PENDING_ASMAN', 'SELESAI')) then
    if public.stock_opname_required_photo_missing(new.data, new.upt_id) then
      raise exception 'OPNAME_REQUIRED_PHOTO_MISSING';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists stock_opname_required_photo_guard on public.stock_opname;
create trigger stock_opname_required_photo_guard
before insert or update of status, data on public.stock_opname
for each row execute function public.guard_stock_opname_required_photo();

revoke all on function public.stock_opname_photo_url_valid(text, text) from public;
revoke all on function public.stock_opname_required_photo_missing(jsonb, text) from public;
revoke all on function public.guard_stock_opname_required_photo() from public;

commit;
