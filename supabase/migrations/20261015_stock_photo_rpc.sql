-- PROPOSAL ONLY. Apply to production self-host only after explicit user approval.
-- Foto Data Stok must not use the full-row stocks upsert: the TUG-3 trigger
-- deliberately rejects changes to protected provenance fields.
-- Existing TUG3_STOCK_RPC_REQUIRED trigger remains active.

begin;

alter table public.stocks add column if not exists upt_id text;
create index if not exists idx_stocks_upt on public.stocks(upt_id);

create or replace function public.stock_photo_object_path(p_url text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_path text;
begin
  if coalesce(p_url, '') !~* '^https://warnoto[.]com/storage/v1/object/public/stock-photos/[^?#]+$' then
    return null;
  end if;
  v_path := regexp_replace(p_url, '^https://warnoto[.]com/storage/v1/object/public/stock-photos/', '');
  return nullif(v_path, '');
end;
$$;

revoke all on function public.stock_photo_object_path(text) from public, anon, authenticated;

create or replace function public.update_stock_photo(
  p_stock_id text,
  p_field text,
  p_photo_url text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor public.profiles;
  v_stock public.stocks;
  v_upt_id text;
  v_path text;
  v_old_url text;
  v_data jsonb;
  v_history jsonb;
  v_now bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then
    raise exception 'STOCK_PHOTO_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_field is null or p_field not in ('fotoNameplate', 'fotoKeseluruhan') then
    raise exception 'STOCK_PHOTO_FIELD_INVALID' using errcode = '22023';
  end if;
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null or v_actor.role not in ('ADMIN', 'TL', 'SUPERADMIN') then
    raise exception 'STOCK_PHOTO_ROLE_DENIED' using errcode = '42501';
  end if;
  select * into v_stock from public.stocks where id = p_stock_id for update;
  if v_stock.id is null then
    raise exception 'STOCK_PHOTO_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_upt_id := coalesce(nullif(v_stock.upt_id, ''), nullif(v_stock.data->>'uptId', ''));
  if v_upt_id is null then
    raise exception 'STOCK_PHOTO_UPT_REQUIRED' using errcode = '42501';
  end if;
  if not public.can_access_upt(v_upt_id) then
    raise exception 'STOCK_PHOTO_SCOPE_DENIED' using errcode = '42501';
  end if;
  v_path := public.stock_photo_object_path(p_photo_url);
  if v_path is null or lower(split_part(v_path, '/', 1)) <> lower(v_upt_id) then
    raise exception 'STOCK_PHOTO_URL_INVALID' using errcode = '22023';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'stock-photos' and name = v_path
  ) then
    raise exception 'STOCK_PHOTO_OBJECT_MISSING' using errcode = 'P0002';
  end if;

  v_old_url := nullif(v_stock.data->>p_field, '');
  if v_old_url is not distinct from p_photo_url then
    return coalesce(v_stock.data, '{}'::jsonb)
      || jsonb_build_object('id', v_stock.id, 'katalogId', v_stock.katalog_id,
          'lokasiId', v_stock.lokasi_id, 'uptId', v_upt_id);
  end if;

  v_history := coalesce(v_stock.data->'photoHistory', '[]'::jsonb);
  if jsonb_typeof(v_history) <> 'array' then v_history := '[]'::jsonb; end if;
  if v_old_url is not null and left(v_old_url, 5) <> 'data:' then
    v_history := v_history || jsonb_build_array(jsonb_build_object(
      'id', 'MANUAL:' || v_upt_id || ':' || v_stock.id || ':' || p_field || ':' || v_now,
      'source', 'MANUAL', 'sourceId', v_stock.id, 'uptId', v_upt_id, 'at', v_now,
      'before', jsonb_build_object(p_field, v_old_url)
    ));
  end if;
  v_data := coalesce(v_stock.data, '{}'::jsonb)
    || jsonb_build_object(p_field, p_photo_url, 'photoHistory', v_history, 'updatedAt', v_now);
  if p_field = 'fotoNameplate' then
    v_data := v_data || jsonb_build_object('fotoNameplateOcr', null);
  end if;
  update public.stocks set data = v_data where id = v_stock.id;
  select * into v_stock from public.stocks where id = p_stock_id;
  return coalesce(v_stock.data, '{}'::jsonb)
    || jsonb_build_object('id', v_stock.id, 'katalogId', v_stock.katalog_id,
        'lokasiId', v_stock.lokasi_id, 'uptId', coalesce(v_stock.upt_id, v_upt_id));
end;
$$;

create or replace function public.update_stock_nameplate_ocr(
  p_stock_id text,
  p_photo_url text,
  p_ocr_text text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor public.profiles;
  v_stock public.stocks;
  v_upt_id text;
  v_path text;
  v_data jsonb;
  v_now bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_canonical jsonb;
begin
  if auth.uid() is null then
    raise exception 'STOCK_PHOTO_AUTH_REQUIRED' using errcode = '42501';
  end if;
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null or v_actor.role not in ('ADMIN', 'TL', 'SUPERADMIN') then
    raise exception 'STOCK_PHOTO_ROLE_DENIED' using errcode = '42501';
  end if;
  select * into v_stock from public.stocks where id = p_stock_id for update;
  if v_stock.id is null then
    raise exception 'STOCK_PHOTO_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_upt_id := coalesce(nullif(v_stock.upt_id, ''), nullif(v_stock.data->>'uptId', ''));
  if v_upt_id is null or not public.can_access_upt(v_upt_id) then
    raise exception 'STOCK_PHOTO_SCOPE_DENIED' using errcode = '42501';
  end if;
  v_canonical := coalesce(v_stock.data, '{}'::jsonb)
    || jsonb_build_object('id', v_stock.id, 'katalogId', v_stock.katalog_id,
        'lokasiId', v_stock.lokasi_id, 'uptId', v_upt_id);
  if v_stock.data->>'fotoNameplate' is distinct from p_photo_url then
    return jsonb_build_object('updated', false, 'reason', 'STALE_PHOTO', 'stock', v_canonical);
  end if;
  v_path := public.stock_photo_object_path(p_photo_url);
  if v_path is null or lower(split_part(v_path, '/', 1)) <> lower(v_upt_id) then
    raise exception 'STOCK_PHOTO_URL_INVALID' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'stock-photos' and name = v_path) then
    raise exception 'STOCK_PHOTO_OBJECT_MISSING' using errcode = 'P0002';
  end if;
  v_data := coalesce(v_stock.data, '{}'::jsonb)
    || jsonb_build_object('fotoNameplateOcr', left(coalesce(p_ocr_text, ''), 20000), 'updatedAt', v_now);
  update public.stocks set data = v_data where id = v_stock.id;
  select * into v_stock from public.stocks where id = p_stock_id;
  return jsonb_build_object('updated', true, 'stock', coalesce(v_stock.data, '{}'::jsonb)
    || jsonb_build_object('id', v_stock.id, 'katalogId', v_stock.katalog_id,
        'lokasiId', v_stock.lokasi_id, 'uptId', coalesce(v_stock.upt_id, v_upt_id)));
end;
$$;

revoke all on function public.update_stock_photo(text, text, text) from public, anon;
grant execute on function public.update_stock_photo(text, text, text) to authenticated;
revoke all on function public.update_stock_nameplate_ocr(text, text, text) from public, anon;
grant execute on function public.update_stock_nameplate_ocr(text, text, text) to authenticated;

commit;
