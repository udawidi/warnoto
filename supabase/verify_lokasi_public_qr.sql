-- Read-only verifier. Jalankan setelah migrasi 20260918_lokasi_public_qr.sql.
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lokasi' and column_name = 'public_token'
  ) as has_public_token,
  to_regprocedure('public.public_block_stock(text,uuid)') is not null as has_public_rpc;

select
  count(*) as lokasi_total,
  count(public_token) as token_total,
  count(distinct public_token) as token_unique
from public.lokasi;

select has_function_privilege('anon', 'public.public_block_stock(text,uuid)', 'EXECUTE') as anon_can_execute,
       has_function_privilege('authenticated', 'public.public_block_stock(text,uuid)', 'EXECUTE') as authenticated_can_execute,
       has_function_privilege('public', 'public.public_block_stock(text,uuid)', 'EXECUTE') as public_can_execute;

select p.oid::regprocedure as function_name,
       p.proconfig as function_config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'public_block_stock';

-- Valid token must return only its own location; an unrelated token must return null.
with candidate as (
  select l.id, l.public_token,
         count(s.id) filter (where coalesce(s.data->>'qty', '') ~ '^-?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))$'
           and (s.data->>'qty')::numeric > 0) as positive_stock_rows
  from public.lokasi l
  left join public.stocks s on s.lokasi_id = l.id
  group by l.id, l.public_token
  order by positive_stock_rows desc, l.id
  limit 1
), checked as (
  select c.id, c.positive_stock_rows,
         public.public_block_stock(c.id, c.public_token) as valid_payload,
         public.public_block_stock(c.id, '00000000-0000-0000-0000-000000000000'::uuid) as invalid_payload
  from candidate c
)
select id,
       positive_stock_rows,
       valid_payload->>'blok' as returned_block,
       jsonb_array_length(coalesce(valid_payload->'materials', '[]'::jsonb)) as returned_material_groups,
       invalid_payload is null as invalid_token_returns_null
from checked;

-- New payload labels must be present on every returned material group.
with candidate as (
  select l.id, l.public_token from public.lokasi l join public.stocks s on s.lokasi_id = l.id
  where l.public_token is not null and coalesce(s.data->>'qty','') ~ '^-?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))$' and (s.data->>'qty')::numeric > 0
  group by l.id, l.public_token order by l.id limit 1
), payload as (
  select public.public_block_stock(id, public_token) body from candidate
), label_check as (
  select bool_and(nullif(item->>'sapLabel','') is not null and nullif(item->>'jenisBarang','') is not null) as labels_present
  from payload, jsonb_array_elements(coalesce(body->'materials','[]'::jsonb)) item
)
select exists (select 1 from candidate) as candidate_found,
       coalesce((select labels_present from label_check), false) as labels_present;
