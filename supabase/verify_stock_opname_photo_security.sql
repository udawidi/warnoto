-- Read-only verifier. Run before and after the proposal migrations.
select 'legacy_data_urls' as check_name, count(*)::bigint as value
from public.stock_opname
where exists (
  select 1
  from jsonb_array_elements(
    case when jsonb_typeof(coalesce(data->'items', 'null'::jsonb)) = 'array'
      then data->'items' else '[]'::jsonb end
  ) as item
  where coalesce(item->>'fotoKeseluruhan', '') like 'data:%'
     or coalesce(item->>'fotoNameplate', '') like 'data:%'
)
union all
select 'stock_opname_rows_without_upt', count(*)::bigint
from public.stock_opname
where upt_id is null
union all
select 'stock_photo_write_policies', count(*)::bigint
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname in ('Stock Opname upload stock-photos', 'Stock Opname update stock-photos')
union all
select 'stock_photo_public_bucket', count(*)::bigint
from storage.buckets
where id = 'stock-photos' and public = true;

-- Expected after staged rollout:
-- legacy_data_urls=0; stock_opname_rows_without_upt=0;
-- stock_photo_write_policies=2; stock_photo_public_bucket=1.
