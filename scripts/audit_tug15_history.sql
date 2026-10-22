-- Read-only production audit for tug15_history.
-- Run through the production psql read-only channel. This file contains no DML.
--
-- A history row is mappable only when exactly one approved source item has the
-- same UPT, catalog, direction, quantity, date, document number and location.
-- Identical items in one document are kept as separate source events by item
-- index; the audit therefore does not dedupe on the natural display fields alone.

with
catalogs as (
  select id,
         data->>'katalog' as catalog_code,
         data->>'name' as catalog_name,
         count(*) over (partition by data->>'katalog') as catalog_code_count,
         count(*) over (partition by data->>'name') as catalog_name_count
  from public.katalog
),
legacy_items as (
  select
    'TUG3'::text as doc_type,
    t.id::text as transaction_id,
    t.upt_id,
    (x.ordinality - 1)::integer as item_index,
    case when x.item->>'katalogMode'='new' then coalesce(
      (select s.katalog_id from public.stocks s
       where s.upt_id=t.upt_id
         and s.data->'sourceLot'->>'key' = 'TUG3|' || t.id::text || '|' || (x.ordinality - 1)::text
       order by s.created_at desc, s.id limit 1),
      (select c_name.id from catalogs c_name where c_name.catalog_name=x.item->>'namaBaru' and c_name.catalog_name_count=1 order by c_name.id limit 1),
      (select c_code.id from catalogs c_code where c_code.catalog_code=x.item->>'katalogBaru' and c_code.catalog_code_count=1 order by c_code.id limit 1),
      nullif(x.item->>'katalogId','')
    ) else coalesce(
      nullif(x.item->>'katalogId',''),
      (select c_code.id from catalogs c_code where c_code.catalog_code=x.item->>'katalogBaru' and c_code.catalog_code_count=1 order by c_code.id limit 1),
      (select c_name.id from catalogs c_name where c_name.catalog_name=x.item->>'namaBaru' and c_name.catalog_name_count=1 order by c_name.id limit 1)
    ) end as katalog_id,
    (x.item->>'qty')::numeric as qty,
    nullif(x.item->>'lokasiTujuanId','') as lokasi_id,
    to_timestamp((coalesce(
      nullif(t.data->>'approvedAtAsman',''),
      nullif(t.data->>'approvedAt',''),
      nullif(t.updated_at::text,'')
    ))::numeric / 1000)::date as tanggal,
    'MASUK'::text as jenis_transaksi,
    'TUG-3 / ' || t.doc_number as no_bon
  from public.tug3_transactions t
  cross join lateral jsonb_array_elements(coalesce(t.data->'stockItems','[]'::jsonb))
    with ordinality as x(item, ordinality)
  where t.status = 'APPROVED' or t.stage = 'APPROVED'
),
tug10_items as (
  select
    'TUG10'::text as doc_type,
    t.id::text as transaction_id,
    t.upt_id,
    (x.ordinality - 1)::integer as item_index,
    case when x.item->>'katalogMode'='new' then coalesce(
      (select s.katalog_id from public.stocks s
       where s.upt_id=t.upt_id
         and s.data->'sourceLot'->>'key' = 'TUG10|' || t.id::text || '|' || (x.ordinality - 1)::text
       order by s.created_at desc, s.id limit 1),
      (select c_name.id from catalogs c_name where c_name.catalog_name=x.item->>'namaBaru' and c_name.catalog_name_count=1 order by c_name.id limit 1),
      (select c_code.id from catalogs c_code where c_code.catalog_code=x.item->>'katalogBaru' and c_code.catalog_code_count=1 order by c_code.id limit 1),
      nullif(x.item->>'katalogId','')
    ) else coalesce(
      nullif(x.item->>'katalogId',''),
      (select c_code.id from catalogs c_code where c_code.catalog_code=x.item->>'katalogBaru' and c_code.catalog_code_count=1 order by c_code.id limit 1),
      (select c_name.id from catalogs c_name where c_name.catalog_name=x.item->>'namaBaru' and c_name.catalog_name_count=1 order by c_name.id limit 1)
    ) end as katalog_id,
    (x.item->>'qty')::numeric as qty,
    nullif(t.data->>'lokasiTujuanId','') as lokasi_id,
    to_timestamp((coalesce(
      nullif(t.data->>'approvedAtAsman',''),
      nullif(t.data->>'approvedAt',''),
      nullif(t.updated_at::text,'')
    ))::numeric / 1000)::date as tanggal,
    'MASUK'::text as jenis_transaksi,
    'TUG-10 / ' || t.doc_number as no_bon
  from public.tug10_transactions t
  cross join lateral jsonb_array_elements(coalesce(t.data->'stockItems','[]'::jsonb))
    with ordinality as x(item, ordinality)
  where t.status = 'APPROVED' or t.stage = 'APPROVED'
),
canonical_items as (
  select
    t.doc_type,
    t.id::text as transaction_id,
    t.upt_id,
    (i.line_no - 1)::integer as item_index,
    i.katalog_id,
    i.qty,
    i.lokasi_id,
    coalesce(t.final_approved_at, t.updated_at, t.created_at)::date as tanggal,
    'KELUAR'::text as jenis_transaksi,
    'TUG-' || replace(t.doc_type, 'TUG', '') || ' / ' || t.doc_number as no_bon
  from public.tug_transactions t
  join public.tug_items i on i.transaction_id = t.id
  where t.doc_type in ('TUG8','TUG9')
    and t.status = 'FINAL_APPROVED'
),
source_events as (
  select * from legacy_items
  union all select * from tug10_items
  union all select * from canonical_items
),
history_with_upt as (
  select h.*,
         coalesce(g.upt_id, '<NO_UPT>') as upt_id
  from public.tug15_history h
  left join public.lokasi l on l.id = h.lokasi_id
  left join public.gudang g on g.id = l.gudang_id
),
matches as (
  select h.id as history_id,
         s.transaction_id,
         s.item_index,
         s.katalog_id as source_katalog_id,
         s.jenis_transaksi as source_jenis,
         count(*) over (partition by h.id) as match_count
  from history_with_upt h
  left join source_events s
    on s.upt_id = h.upt_id
   and s.katalog_id = h.katalog_id
   and s.jenis_transaksi = h.jenis_transaksi
   and s.qty = h.qty
   and s.tanggal = h.tanggal
   and s.doc_type = h.doc_type
   and s.no_bon is not distinct from h.no_bon
   and s.lokasi_id is not distinct from h.lokasi_id
),
one_match as (
  select distinct on (history_id)
         history_id, transaction_id, item_index, source_katalog_id,
         source_jenis, match_count
  from matches
  where transaction_id is not null
  order by history_id, transaction_id, item_index
),
duplicate_groups as (
  select upt_id, katalog_id, tanggal, jenis_transaksi, qty, doc_type,
         no_bon, lokasi_id, lokasi_kode, catatan, count(*) as history_count,
         count(m.history_id) as unique_mapped_count,
         min(h.id) as first_history_id,
         array_agg(h.id order by h.id) as history_ids
  from history_with_upt h
  left join one_match m on m.history_id = h.id
  group by upt_id, katalog_id, tanggal, jenis_transaksi, qty, doc_type, no_bon,
           lokasi_id, lokasi_kode, catatan
  having count(*) > 1
),
source_group_counts as (
  select h.upt_id, h.katalog_id, h.tanggal, h.jenis_transaksi, h.qty, h.doc_type,
         h.no_bon, h.lokasi_id, h.lokasi_kode, h.catatan,
         count(distinct (s.doc_type, s.transaction_id, s.item_index)) as source_count
  from history_with_upt h
  join source_events s
    on s.upt_id = h.upt_id and s.katalog_id = h.katalog_id
   and s.tanggal = h.tanggal and s.jenis_transaksi = h.jenis_transaksi
   and s.qty = h.qty and s.doc_type = h.doc_type
   and s.no_bon is not distinct from h.no_bon
   and s.lokasi_id is not distinct from h.lokasi_id
  group by h.upt_id, h.katalog_id, h.tanggal, h.jenis_transaksi, h.qty,
           h.doc_type, h.no_bon, h.lokasi_id, h.lokasi_kode, h.catatan
),
summary as (
  select
    h.upt_id,
    h.katalog_id,
    count(*) as history_rows,
    count(*) filter (where h.sync_key is null) as null_sync_keys,
    count(*) filter (where h.sync_key like '%|%') as canonical_sync_keys,
    count(*) filter (where m.match_count = 1) as uniquely_mapped,
    count(*) filter (where coalesce(m.match_count, 0) = 0) as unmapped,
    count(*) filter (where m.match_count > 1) as ambiguous
  from history_with_upt h
  left join one_match m on m.history_id = h.id
  group by h.upt_id, h.katalog_id
)
select 'SUMMARY' as report, row_to_json(summary)::text
from summary
union all
select 'MAPPING_SUMMARY' as report, row_to_json(r)::text
from (
  select
    coalesce(sum(history_rows), 0) as history_rows,
    coalesce(sum(uniquely_mapped), 0) as uniquely_mapped,
    coalesce(sum(unmapped), 0) as unmapped,
    coalesce(sum(ambiguous), 0) as ambiguous,
    coalesce(sum(null_sync_keys), 0) as null_sync_keys,
    coalesce(sum(canonical_sync_keys), 0) as canonical_sync_keys
  from summary
) r
union all
select 'DUPLICATE_GROUP' as report,
       row_to_json(g)::text ||
       ' source_count=' || coalesce(s.source_count::text, '0')
from duplicate_groups g
left join source_group_counts s
  on s.upt_id is not distinct from g.upt_id
 and s.katalog_id is not distinct from g.katalog_id
 and s.tanggal is not distinct from g.tanggal
 and s.jenis_transaksi is not distinct from g.jenis_transaksi
 and s.qty is not distinct from g.qty
 and s.doc_type is not distinct from g.doc_type
 and s.no_bon is not distinct from g.no_bon
 and s.lokasi_id is not distinct from g.lokasi_id
 and s.lokasi_kode is not distinct from g.lokasi_kode
 and s.catatan is not distinct from g.catatan
union all
select 'REPAIR_SUMMARY' as report, row_to_json(r)::text
from (
  select
    count(*) filter (where s.source_count = 1 and g.unique_mapped_count = g.history_count) as safe_groups,
    coalesce(sum(g.history_count - s.source_count) filter (where s.source_count = 1 and g.unique_mapped_count = g.history_count), 0) as surplus_rows,
    count(*) filter (where coalesce(s.source_count, 0) = 0) as unmapped_groups,
    count(*) filter (where s.source_count > 1) as ambiguous_groups
  from duplicate_groups g
  left join source_group_counts s
    on s.upt_id is not distinct from g.upt_id
   and s.katalog_id is not distinct from g.katalog_id
   and s.tanggal is not distinct from g.tanggal
   and s.jenis_transaksi is not distinct from g.jenis_transaksi
   and s.qty is not distinct from g.qty
   and s.doc_type is not distinct from g.doc_type
   and s.no_bon is not distinct from g.no_bon
   and s.lokasi_id is not distinct from g.lokasi_id
   and s.lokasi_kode is not distinct from g.lokasi_kode
   and s.catatan is not distinct from g.catatan
) r
union all
select 'REPAIR_CANDIDATE' as report,
       row_to_json(g)::text ||
       ' source_count=' || s.source_count::text ||
       ' delete_ids=' || (array_remove(g.history_ids, g.first_history_id))::text
from duplicate_groups g
join source_group_counts s
  on s.upt_id is not distinct from g.upt_id
 and s.katalog_id is not distinct from g.katalog_id
 and s.tanggal is not distinct from g.tanggal
 and s.jenis_transaksi is not distinct from g.jenis_transaksi
 and s.qty is not distinct from g.qty
 and s.doc_type is not distinct from g.doc_type
 and s.no_bon is not distinct from g.no_bon
 and s.lokasi_id is not distinct from g.lokasi_id
 and s.lokasi_kode is not distinct from g.lokasi_kode
 and s.catatan is not distinct from g.catatan
where s.source_count = 1
  and g.unique_mapped_count = g.history_count
union all
select 'REPAIR_UPT_SUMMARY' as report, row_to_json(r)::text
from (
  select
    g.upt_id,
    count(*) filter (where s.source_count = 1 and g.unique_mapped_count = g.history_count) as safe_groups,
    coalesce(sum(g.history_count - s.source_count) filter (where s.source_count = 1 and g.unique_mapped_count = g.history_count), 0) as surplus_rows,
    count(*) filter (where coalesce(s.source_count, 0) = 0) as unmapped_groups,
    count(*) filter (where s.source_count > 1) as ambiguous_groups
  from duplicate_groups g
  left join source_group_counts s
    on s.upt_id is not distinct from g.upt_id
   and s.katalog_id is not distinct from g.katalog_id
   and s.tanggal is not distinct from g.tanggal
   and s.jenis_transaksi is not distinct from g.jenis_transaksi
   and s.qty is not distinct from g.qty
   and s.doc_type is not distinct from g.doc_type
   and s.no_bon is not distinct from g.no_bon
   and s.lokasi_id is not distinct from g.lokasi_id
   and s.lokasi_kode is not distinct from g.lokasi_kode
   and s.catatan is not distinct from g.catatan
  group by g.upt_id
) r
order by 1, 2;

-- Per-row review output. The repair proposal only acts on rows with a unique
-- source match and a source count that proves surplus history rows exist.
with
catalogs as (
  select id, data->>'katalog' as catalog_code, data->>'name' as catalog_name
       , count(*) over (partition by data->>'katalog') as catalog_code_count
       , count(*) over (partition by data->>'name') as catalog_name_count
  from public.katalog
),
source_events as (
  select 'TUG3'::text doc_type, t.id::text transaction_id, t.upt_id,
         (x.ordinality - 1)::integer item_index,
         case when x.item->>'katalogMode'='new' then coalesce(
           (select s.katalog_id from public.stocks s
            where s.upt_id=t.upt_id
              and s.data->'sourceLot'->>'key' = 'TUG3|' || t.id::text || '|' || (x.ordinality - 1)::text
            order by s.created_at desc, s.id limit 1),
           (select c_name.id from catalogs c_name where c_name.catalog_name=x.item->>'namaBaru' and c_name.catalog_name_count=1 order by c_name.id limit 1),
           (select c_code.id from catalogs c_code where c_code.catalog_code=x.item->>'katalogBaru' and c_code.catalog_code_count=1 order by c_code.id limit 1),
           nullif(x.item->>'katalogId','')
         ) else coalesce(
           nullif(x.item->>'katalogId',''),
           (select c_code.id from catalogs c_code where c_code.catalog_code=x.item->>'katalogBaru' and c_code.catalog_code_count=1 order by c_code.id limit 1),
           (select c_name.id from catalogs c_name where c_name.catalog_name=x.item->>'namaBaru' and c_name.catalog_name_count=1 order by c_name.id limit 1)
         ) end katalog_id,
         (x.item->>'qty')::numeric qty, nullif(x.item->>'lokasiTujuanId','') lokasi_id,
         to_timestamp((coalesce(nullif(t.data->>'approvedAtAsman',''), nullif(t.data->>'approvedAt',''), t.updated_at::text))::numeric / 1000)::date tanggal,
         'MASUK'::text jenis_transaksi, 'TUG-3 / ' || t.doc_number no_bon
  from public.tug3_transactions t
  cross join lateral jsonb_array_elements(coalesce(t.data->'stockItems','[]'::jsonb)) with ordinality x(item, ordinality)
  where t.status='APPROVED' or t.stage='APPROVED'
  union all
  select 'TUG10', t.id::text, t.upt_id, (x.ordinality - 1)::integer,
         case when x.item->>'katalogMode'='new' then coalesce(
           (select s.katalog_id from public.stocks s
            where s.upt_id=t.upt_id
              and s.data->'sourceLot'->>'key' = 'TUG10|' || t.id::text || '|' || (x.ordinality - 1)::text
            order by s.created_at desc, s.id limit 1),
           (select c_name.id from catalogs c_name where c_name.catalog_name=x.item->>'namaBaru' and c_name.catalog_name_count=1 order by c_name.id limit 1),
           (select c_code.id from catalogs c_code where c_code.catalog_code=x.item->>'katalogBaru' and c_code.catalog_code_count=1 order by c_code.id limit 1),
           nullif(x.item->>'katalogId','')
         ) else coalesce(
           nullif(x.item->>'katalogId',''),
           (select c_code.id from catalogs c_code where c_code.catalog_code=x.item->>'katalogBaru' and c_code.catalog_code_count=1 order by c_code.id limit 1),
           (select c_name.id from catalogs c_name where c_name.catalog_name=x.item->>'namaBaru' and c_name.catalog_name_count=1 order by c_name.id limit 1)
         ) end, (x.item->>'qty')::numeric,
         nullif(t.data->>'lokasiTujuanId',''),
         to_timestamp((coalesce(nullif(t.data->>'approvedAtAsman',''), nullif(t.data->>'approvedAt',''), t.updated_at::text))::numeric / 1000)::date,
         'MASUK', 'TUG-10 / ' || t.doc_number
  from public.tug10_transactions t
  cross join lateral jsonb_array_elements(coalesce(t.data->'stockItems','[]'::jsonb)) with ordinality x(item, ordinality)
  where t.status='APPROVED' or t.stage='APPROVED'
  union all
  select t.doc_type, t.id::text, t.upt_id, i.line_no - 1, i.katalog_id, i.qty, i.lokasi_id,
         coalesce(t.final_approved_at,t.updated_at,t.created_at)::date, 'KELUAR',
         'TUG-' || replace(t.doc_type,'TUG','') || ' / ' || t.doc_number
  from public.tug_transactions t join public.tug_items i on i.transaction_id=t.id
  where t.doc_type in ('TUG8','TUG9') and t.status='FINAL_APPROVED'
),
history_with_upt as (
  select h.*, coalesce(g.upt_id,'<NO_UPT>') upt_id
  from public.tug15_history h left join public.lokasi l on l.id=h.lokasi_id left join public.gudang g on g.id=l.gudang_id
),
matches as (
  select h.id history_id, s.transaction_id, s.item_index, count(s.transaction_id) over(partition by h.id) match_count
  from history_with_upt h left join source_events s on s.upt_id=h.upt_id and s.katalog_id=h.katalog_id
   and s.jenis_transaksi=h.jenis_transaksi and s.qty=h.qty and s.tanggal=h.tanggal and s.doc_type=h.doc_type
   and s.no_bon is not distinct from h.no_bon and s.lokasi_id is not distinct from h.lokasi_id
)
select h.id, h.upt_id, h.katalog_id, h.jenis_transaksi, h.qty, h.tanggal, h.doc_type, h.no_bon,
       h.lokasi_id, h.sync_key, m.transaction_id, m.item_index, coalesce(m.match_count,0) as match_count,
       case when m.match_count=1 then 'UNIQUE' when m.match_count>1 then 'AMBIGUOUS' else 'UNMAPPED' end as mapping_status
from history_with_upt h
left join matches m on m.history_id=h.id
order by h.upt_id,h.katalog_id,h.id;

-- Approved TUG10 groups where source item cardinality exceeds existing
-- history cardinality. These are insert-only repair candidates; history ids
-- are mapped ascending to source item indexes ascending.
with catalogs as (
  select id, data->>'katalog' as catalog_code, data->>'name' as catalog_name,
         count(*) over (partition by data->>'katalog') as catalog_code_count,
         count(*) over (partition by data->>'name') as catalog_name_count
  from public.katalog
), source_events as (
  select t.id::text as transaction_id, t.upt_id, (x.ordinality - 1)::integer as item_index,
         case when x.item->>'katalogMode'='new' then coalesce(
           (select s.katalog_id from public.stocks s
            where s.upt_id=t.upt_id
              and s.data->'sourceLot'->>'key'='TUG10|' || t.id::text || '|' || (x.ordinality-1)::text
            order by s.created_at desc, s.id limit 1),
           (select c.id from catalogs c where c.catalog_name=x.item->>'namaBaru' and c.catalog_name_count=1 order by c.id limit 1),
           (select c.id from catalogs c where c.catalog_code=x.item->>'katalogBaru' and c.catalog_code_count=1 order by c.id limit 1),
           nullif(x.item->>'katalogId',''))
         else coalesce(nullif(x.item->>'katalogId',''),
           (select c.id from catalogs c where c.catalog_code=x.item->>'katalogBaru' and c.catalog_code_count=1 order by c.id limit 1),
           (select c.id from catalogs c where c.catalog_name=x.item->>'namaBaru' and c.catalog_name_count=1 order by c.id limit 1)) end as katalog_id,
         (x.item->>'qty')::numeric as qty,
         nullif(t.data->>'lokasiTujuanId','') as lokasi_id,
         to_timestamp((coalesce(nullif(t.data->>'approvedAtAsman',''),nullif(t.data->>'approvedAt',''),t.updated_at::text))::numeric/1000)::date as tanggal,
         'TUG10'::text as doc_type, 'TUG-10 / ' || t.doc_number as no_bon
  from public.tug10_transactions t
  cross join lateral jsonb_array_elements(coalesce(t.data->'stockItems','[]'::jsonb)) with ordinality x(item,ordinality)
  where t.status='APPROVED' or t.stage='APPROVED'
), history_with_upt as (
  select h.*, coalesce(g.upt_id,'<NO_UPT>') as upt_id
  from public.tug15_history h
  left join public.lokasi l on l.id=h.lokasi_id
  left join public.gudang g on g.id=l.gudang_id
), grouped as (
  select s.upt_id, s.katalog_id, s.tanggal, s.qty, s.doc_type, s.no_bon, s.lokasi_id,
         count(distinct (s.transaction_id,s.item_index)) as source_count,
         count(distinct h.id) as history_count,
         array_agg(distinct s.transaction_id || '|' || s.item_index order by s.transaction_id || '|' || s.item_index) as source_items,
         array_agg(distinct h.id order by h.id) filter (where h.id is not null) as history_ids
  from source_events s
  left join history_with_upt h
    on h.upt_id=s.upt_id and h.katalog_id=s.katalog_id and h.tanggal=s.tanggal
   and h.qty=s.qty and h.doc_type=s.doc_type and h.no_bon is not distinct from s.no_bon
   and h.jenis_transaksi='MASUK' and h.lokasi_id is not distinct from s.lokasi_id
  group by s.upt_id,s.katalog_id,s.tanggal,s.qty,s.doc_type,s.no_bon,s.lokasi_id
)
select 'UNDERREPRESENTED_GROUP' as report, row_to_json(g)::text
from grouped g
where g.history_count > 0 and g.source_count > g.history_count
order by g.no_bon,g.katalog_id;

-- Four SBY groups whose legacy catalog id differs from the canonical source
-- stock catalog. These are explicit review candidates, not generic matches.
select 'EXPLICIT_REPAIR_CANDIDATE' as report,
       row_to_json(v)::text || ' source_item_count=' ||
       (select count(*) from public.tug_items i where i.transaction_id::text=v.transaction_id and i.line_no=v.item_index+1)::text ||
       ' stock_catalog=' || coalesce((select s.katalog_id from public.stocks s where s.id=v.stock_id),'')
from (values
  (1242::bigint,array[821,831]::bigint[],'87df2164-deb6-4614-8acb-aaf6336927a0'::text,0,'STK-MIG-1001060031-1783586742031'::text,'KAT-1060031'::text,'KAT-1001060031'::text,'TUG8'::text,'2026-09-09'::date,3::numeric,'LOK-MGX8NF'::text),
  (4846::bigint,array[4844,5227]::bigint[],'47f7f268-68e5-4f15-9aac-e25b3eac4012'::text,0,'STK-MIG-1002070973-1783586742031'::text,'KAT-2070973'::text,'KAT-1002070973'::text,'TUG8'::text,'2026-09-23'::date,3::numeric,'LOK-5S7GEL'::text),
  (6606::bigint,array[6579,6623]::bigint[],'83a9cf58-7fe3-43e1-a5a4-3a9966f2af9a'::text,6,'STK-665-L4STW4'::text,'KAT-2070973'::text,'KAT-1002070973'::text,'TUG9'::text,'2026-10-01'::date,3::numeric,'LOK-XE0785'::text),
  (6781::bigint,array[6576,6603]::bigint[],'83a9cf58-7fe3-43e1-a5a4-3a9966f2af9a'::text,14,'STK-MIG-1004170182-1783586742031'::text,'KAT-4170182'::text,'KAT-1004170182'::text,'TUG9'::text,'2026-10-01'::date,100::numeric,'LOK-1OWOWV'::text)
) v(canonical_id,alias_ids,transaction_id,item_index,stock_id,legacy_katalog_id,source_katalog_id,doc_type,tanggal,qty,lokasi_id)
order by v.canonical_id;

select 'EXPLICIT_REPAIR_SUMMARY' as report,
       row_to_json(r)::text
from (select 4::integer as groups, 8::integer as alias_rows_deleted,
             4::integer as canonical_rows_rekeyed) r;

select 'REPAIR_PLAN_SUMMARY' as report,
       row_to_json(r)::text
from (select 598::integer as reviewed_baseline_history_rows,
             127::integer as generic_delete_rows,
             8::integer as explicit_alias_delete_rows,
             135::integer as total_delete_rows,
             33::integer as insert_rows,
             496::integer as reviewed_snapshot_final_history_rows) r;
