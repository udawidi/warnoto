-- PROPOSAL ONLY — run only after the backfill verifier reports zero legacy data URLs.
begin;

create or replace function public.stock_opname_has_photo_data_url(p_data jsonb)
returns boolean
language sql
immutable
as $$
  select exists (
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(coalesce(p_data->'items', 'null'::jsonb)) = 'array'
        then p_data->'items' else '[]'::jsonb end
    ) as item
    where coalesce(item->>'fotoKeseluruhan', '') like 'data:%'
       or coalesce(item->>'fotoNameplate', '') like 'data:%'
  );
$$;

do $$
declare legacy_count bigint;
begin
  select count(*) into legacy_count
  from public.stock_opname
  where public.stock_opname_has_photo_data_url(data);
  if legacy_count > 0 then
    raise exception 'Cannot add photo constraint: % stock_opname rows still contain data URLs', legacy_count;
  end if;
end $$;

alter table public.stock_opname
  drop constraint if exists stock_opname_data_no_photo_data_url;
alter table public.stock_opname
  add constraint stock_opname_data_no_photo_data_url
  check (not public.stock_opname_has_photo_data_url(data));

commit;
