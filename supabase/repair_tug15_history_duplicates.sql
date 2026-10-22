-- PROPOSAL ONLY: repair tug15_history after review and explicit approval.
-- This is intentionally outside supabase/migrations. Do not run automatically.
-- It has no DDL and does not change stocks or source transactions.
--
-- Safety rules:
--   * source rows must be approved/final-approved;
--   * a history row must match exactly one source item;
--   * a duplicate group is deleted only when the source has fewer items than
--     history and all identifying/display fields are identical;
--   * approved underrepresented TUG10 groups are repaired insert-only after
--     exact source/history cardinality guards;
--   * identical legitimate source items remain ambiguous and are untouched;
--   * rows with no source match remain untouched;
--   * the canonical key is transactionId|itemIndex|katalogId|arah.
--
-- Review first with scripts/audit_tug15_history.sql. Run this file only via a
-- transaction-aware psql session after the candidate IDs and counts are signed off.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Explicit SBY source-catalog repairs approved by the architect. This block
-- is intentionally guarded by exact source/history/stock assertions. The
-- surrounding transaction remains ROLLBACK by default at the end of file.
do $$
declare
  p record;
  stock_before record;
  affected integer;
  target_key text;
begin
  for p in
    select * from (values
      (1242::bigint, array[821,831]::bigint[], '87df2164-deb6-4614-8acb-aaf6336927a0'::text, 0, 'STK-MIG-1001060031-1783586742031'::text, 'KAT-1060031'::text, 'KAT-1001060031'::text, 'UPT-SBY'::text, 'TUG8'::text, 'TUG-8 / 243.TUG-8/LOG.00.02/SBYA/IX/2026'::text, 3::numeric, 'LOK-MGX8NF'::text, '2026-09-09'::date),
      (4846::bigint, array[4844,5227]::bigint[], '47f7f268-68e5-4f15-9aac-e25b3eac4012'::text, 0, 'STK-MIG-1002070973-1783586742031'::text, 'KAT-2070973'::text, 'KAT-1002070973'::text, 'UPT-SBY'::text, 'TUG8'::text, 'TUG-8 / 260.TUG-8/LOG.00.02/SBYA/IX/2026'::text, 3::numeric, 'LOK-5S7GEL'::text, '2026-09-23'::date),
      (6606::bigint, array[6579,6623]::bigint[], '83a9cf58-7fe3-43e1-a5a4-3a9966f2af9a'::text, 6, 'STK-665-L4STW4'::text, 'KAT-2070973'::text, 'KAT-1002070973'::text, 'UPT-SBY'::text, 'TUG9'::text, 'TUG-9 / 275.TUG-9/LOG.00.02/SBYA/X/2026'::text, 3::numeric, 'LOK-XE0785'::text, '2026-10-01'::date),
      (6781::bigint, array[6576,6603]::bigint[], '83a9cf58-7fe3-43e1-a5a4-3a9966f2af9a'::text, 14, 'STK-MIG-1004170182-1783586742031'::text, 'KAT-4170182'::text, 'KAT-1004170182'::text, 'UPT-SBY'::text, 'TUG9'::text, 'TUG-9 / 275.TUG-9/LOG.00.02/SBYA/X/2026'::text, 100::numeric, 'LOK-1OWOWV'::text, '2026-10-01'::date)
    ) v(canonical_id, alias_ids, transaction_id, item_index, stock_id, old_katalog_id, source_katalog_id, expected_upt, doc_type, no_bon, qty, lokasi_id, tanggal)
  loop
    if not exists (
      select 1 from public.tug_transactions t
      where t.id::text=p.transaction_id and t.doc_type=p.doc_type and t.status='FINAL_APPROVED'
        and t.upt_id=p.expected_upt
        and ('TUG-' || replace(t.doc_type,'TUG','') || ' / ' || t.doc_number)=p.no_bon
        and coalesce(t.final_approved_at,t.updated_at,t.created_at)::date=p.tanggal
    ) then raise exception 'explicit repair source transaction guard failed: %', p.transaction_id; end if;

    if (select count(*) from public.tug_items i where i.transaction_id::text=p.transaction_id and i.line_no=p.item_index+1
          and i.stock_id=p.stock_id and i.katalog_id=p.source_katalog_id and i.qty=p.qty and i.lokasi_id=p.lokasi_id) <> 1
    then raise exception 'explicit repair source item guard failed: %/%', p.transaction_id, p.item_index; end if;

    select s.id, s.katalog_id, s.lokasi_id, s.upt_id, s.data->>'qty' as qty into stock_before
    from public.stocks s where s.id=p.stock_id for update;
    if not found or stock_before.katalog_id is distinct from p.source_katalog_id
       or stock_before.lokasi_id is distinct from p.lokasi_id or stock_before.upt_id is distinct from p.expected_upt
    then raise exception 'explicit repair stock guard failed: %', p.stock_id; end if;

    if (select count(*) from public.tug15_history where id=p.canonical_id or id=any(p.alias_ids)) <> 3
    then raise exception 'explicit repair history id guard failed: %', p.canonical_id; end if;
    if (select count(*) from public.tug15_history h
        left join public.lokasi l on l.id=h.lokasi_id
        left join public.gudang g on g.id=l.gudang_id
        where (h.id=p.canonical_id and h.katalog_id=p.source_katalog_id or h.id=any(p.alias_ids) and h.katalog_id=p.old_katalog_id)
          and g.upt_id=p.expected_upt and h.tanggal=p.tanggal
          and h.jenis_transaksi='KELUAR' and h.qty=p.qty and h.lokasi_id=p.lokasi_id
          and h.doc_type=p.doc_type and h.no_bon=p.no_bon) <> 3
    then raise exception 'explicit repair history field guard failed: %', p.canonical_id; end if;

    target_key := p.transaction_id || '|' || p.item_index || '|' || p.source_katalog_id || '|KELUAR';
    if exists (select 1 from public.tug15_history h where h.sync_key=target_key and h.id<>p.canonical_id and not (h.id=any(p.alias_ids)))
    then raise exception 'explicit repair target key occupied: %', target_key; end if;

    update public.tug15_history h
    set katalog_id=p.source_katalog_id, sync_key=target_key
    where h.id=p.canonical_id and h.katalog_id=p.source_katalog_id and h.tanggal=p.tanggal
      and h.jenis_transaksi='KELUAR' and h.qty=p.qty and h.lokasi_id=p.lokasi_id
      and h.doc_type=p.doc_type and h.no_bon=p.no_bon;
    get diagnostics affected = row_count;
    if affected <> 1 then raise exception 'explicit repair canonical update failed: %', p.canonical_id; end if;

    delete from public.tug15_history h
    where h.id=any(p.alias_ids) and h.katalog_id=p.old_katalog_id and h.tanggal=p.tanggal
      and h.jenis_transaksi='KELUAR' and h.qty=p.qty and h.lokasi_id=p.lokasi_id
      and h.doc_type=p.doc_type and h.no_bon=p.no_bon;
    get diagnostics affected = row_count;
    if affected <> 2 then raise exception 'explicit repair alias delete failed: %', p.canonical_id; end if;

    if (select count(*) from public.tug15_history where sync_key=target_key and id=p.canonical_id) <> 1
    then raise exception 'explicit repair final key guard failed: %', target_key; end if;
    if (select count(*) from public.stocks s where s.id=stock_before.id and s.katalog_id=stock_before.katalog_id
          and s.lokasi_id=stock_before.lokasi_id and s.upt_id=stock_before.upt_id
          and s.data->>'qty' is not distinct from stock_before.qty) <> 1
    then raise exception 'explicit repair stock changed: %', p.stock_id; end if;
  end loop;
end $$;

-- TUG10 underrepresented groups: preserve every existing history row, map
-- ids ascending to source item indexes ascending, then insert only missing
-- source items. No delete is permitted in this block.
do $$
declare
  p record;
  source_count integer;
  history_ids bigint[];
  affected integer;
  target_collisions integer;
begin
  for p in
    select * from (values
      ('TUG10-VJ580X'::text, 'KAT-1001-RUZSDR'::text, 17, array[6307]::bigint[], '2026-10-01'::date, 2::numeric, 'LOK-Y01UOV'::text, 'TUG-10 / 273.TUG-10/LOG.00.01/UPT-SBYA/X/2026'::text),
      ('TUG10-VJ580X'::text, 'KAT-1002170013'::text, 3, array[6318]::bigint[], '2026-10-01'::date, 1::numeric, 'LOK-Y01UOV'::text, 'TUG-10 / 273.TUG-10/LOG.00.01/UPT-SBYA/X/2026'::text),
      ('TUG10-DLTS2X'::text, 'KAT-TUG10-84d0db04792aa87f9c207953eca6e2f6'::text, 6, array[8251,8267]::bigint[], '2026-10-06'::date, 1::numeric, 'GILOK-MTU-GI-UPT-SBY-GI-150KV-SURABAYA-SELATAN-2f87665cca1bec95'::text, 'TUG-10 / 281.TUG-10/LOG.00.01/UPT-SBYA/X/2026'::text),
      ('TUG10-IES8C2'::text, 'KAT-2030070'::text, 2, array[11511]::bigint[], '2026-10-06'::date, 1::numeric, 'LOK-QZXVSH'::text, 'TUG-10 / 282.TUG-10/LOG.00.01/UPT-SBYA/X/2026'::text),
      ('TUG10-VFI02F'::text, 'KAT-2090001'::text, 4, array[8652]::bigint[], '2026-10-06'::date, 1::numeric, 'LOK-2Y9YRR'::text, 'TUG-10 / 283.TUG-10/LOG.00.01/UPT-SBYA/X/2026'::text),
      ('TUG10-T9D9H1'::text, 'KAT-2055061'::text, 6, array[8579,8588]::bigint[], '2026-10-06'::date, 1::numeric, 'LOK-2Y9YRR'::text, 'TUG-10 / 284.TUG-10/LOG.00.01/UPT-SBYA/X/2026'::text),
      ('TUG10-92ZU9Q'::text, 'KAT-TUG10-0338fa3c5f543e12dcf7e4108216acb7'::text, 3, array[8603,8609]::bigint[], '2026-10-06'::date, 1::numeric, 'LOK-2Y9YRR'::text, 'TUG-10 / 285.TUG-10/LOG.00.01/UPT-SBYA/X/2026'::text),
      ('TUG10-4J5OID'::text, 'KAT-TUG10-c948d572dee3ebdc2d8adf292d31baa4'::text, 4, array[16690,16694]::bigint[], '2026-10-19'::date, 1::numeric, 'LOK-3KYKBC'::text, 'TUG-10 / 298.TUG-10/LOG.00.01/UPT-SBYA/X/2026'::text)
    ) v(transaction_id, katalog_id, expected_source_count, expected_history_ids, tanggal, qty, lokasi_id, no_bon)
  loop
    with catalogs as (
      select id, data->>'katalog' as catalog_code, data->>'name' as catalog_name,
             count(*) over (partition by data->>'katalog') as catalog_code_count,
             count(*) over (partition by data->>'name') as catalog_name_count
      from public.katalog
    ), source_events as (
      select t.id::text transaction_id, t.upt_id, (x.ordinality-1)::integer item_index,
             case when x.item->>'katalogMode'='new' then coalesce(
               (select s.katalog_id from public.stocks s where s.upt_id=t.upt_id and s.data->'sourceLot'->>'key'='TUG10|'||t.id::text||'|'||(x.ordinality-1)::text order by s.created_at desc,s.id limit 1),
               (select c.id from catalogs c where c.catalog_name=x.item->>'namaBaru' and c.catalog_name_count=1 order by c.id limit 1),
               (select c.id from catalogs c where c.catalog_code=x.item->>'katalogBaru' and c.catalog_code_count=1 order by c.id limit 1), nullif(x.item->>'katalogId',''))
             else coalesce(nullif(x.item->>'katalogId',''),(select c.id from catalogs c where c.catalog_code=x.item->>'katalogBaru' and c.catalog_code_count=1 order by c.id limit 1),(select c.id from catalogs c where c.catalog_name=x.item->>'namaBaru' and c.catalog_name_count=1 order by c.id limit 1)) end katalog_id,
             (x.item->>'qty')::numeric qty, nullif(t.data->>'lokasiTujuanId','') lokasi_id,
             to_timestamp((coalesce(nullif(t.data->>'approvedAtAsman',''),nullif(t.data->>'approvedAt',''),t.updated_at::text))::numeric/1000)::date tanggal,
             'TUG-10 / '||t.doc_number no_bon
      from public.tug10_transactions t cross join lateral jsonb_array_elements(coalesce(t.data->'stockItems','[]'::jsonb)) with ordinality x(item,ordinality)
      where t.id=p.transaction_id and (t.status='APPROVED' or t.stage='APPROVED')
    ) select count(*) into source_count from source_events s where s.katalog_id=p.katalog_id and s.qty=p.qty and s.lokasi_id=p.lokasi_id and s.tanggal=p.tanggal and s.no_bon=p.no_bon;
    if source_count <> p.expected_source_count then raise exception 'TUG10 source count guard failed: %', p.transaction_id; end if;

    select array_agg(h.id order by h.id) into history_ids
    from public.tug15_history h left join public.lokasi l on l.id=h.lokasi_id left join public.gudang g on g.id=l.gudang_id
    where g.upt_id='UPT-SBY' and h.katalog_id=p.katalog_id and h.tanggal=p.tanggal and h.jenis_transaksi='MASUK' and h.qty=p.qty and h.lokasi_id=p.lokasi_id and h.doc_type='TUG10' and h.no_bon=p.no_bon;
    if history_ids is distinct from p.expected_history_ids then raise exception 'TUG10 history ids guard failed: %', p.transaction_id; end if;
  end loop;
end $$;

-- Apply the reviewed TUG10 mapping only after the assertions above pass.
do $$
declare
  p record;
  affected integer;
  source_count integer;
  final_count integer;
  duplicate_keys integer;
  target_collisions integer;
  stock_fingerprint_before text;
  stock_fingerprint_after text;
begin
  for p in
    select * from (values
      ('TUG10-VJ580X'::text, 'KAT-1001-RUZSDR'::text, 17, array[6307]::bigint[], '2026-10-01'::date, 2::numeric, 'LOK-Y01UOV'::text, 'TUG-10 / 273.TUG-10/LOG.00.01/UPT-SBYA/X/2026'::text),
      ('TUG10-VJ580X'::text, 'KAT-1002170013'::text, 3, array[6318]::bigint[], '2026-10-01'::date, 1::numeric, 'LOK-Y01UOV'::text, 'TUG-10 / 273.TUG-10/LOG.00.01/UPT-SBYA/X/2026'::text),
      ('TUG10-DLTS2X'::text, 'KAT-TUG10-84d0db04792aa87f9c207953eca6e2f6'::text, 6, array[8251,8267]::bigint[], '2026-10-06'::date, 1::numeric, 'GILOK-MTU-GI-UPT-SBY-GI-150KV-SURABAYA-SELATAN-2f87665cca1bec95'::text, 'TUG-10 / 281.TUG-10/LOG.00.01/UPT-SBYA/X/2026'::text),
      ('TUG10-IES8C2'::text, 'KAT-2030070'::text, 2, array[11511]::bigint[], '2026-10-06'::date, 1::numeric, 'LOK-QZXVSH'::text, 'TUG-10 / 282.TUG-10/LOG.00.01/UPT-SBYA/X/2026'::text),
      ('TUG10-VFI02F'::text, 'KAT-2090001'::text, 4, array[8652]::bigint[], '2026-10-06'::date, 1::numeric, 'LOK-2Y9YRR'::text, 'TUG-10 / 283.TUG-10/LOG.00.01/UPT-SBYA/X/2026'::text),
      ('TUG10-T9D9H1'::text, 'KAT-2055061'::text, 6, array[8579,8588]::bigint[], '2026-10-06'::date, 1::numeric, 'LOK-2Y9YRR'::text, 'TUG-10 / 284.TUG-10/LOG.00.01/UPT-SBYA/X/2026'::text),
      ('TUG10-92ZU9Q'::text, 'KAT-TUG10-0338fa3c5f543e12dcf7e4108216acb7'::text, 3, array[8603,8609]::bigint[], '2026-10-06'::date, 1::numeric, 'LOK-2Y9YRR'::text, 'TUG-10 / 285.TUG-10/LOG.00.01/UPT-SBYA/X/2026'::text),
      ('TUG10-4J5OID'::text, 'KAT-TUG10-c948d572dee3ebdc2d8adf292d31baa4'::text, 4, array[16690,16694]::bigint[], '2026-10-19'::date, 1::numeric, 'LOK-3KYKBC'::text, 'TUG-10 / 298.TUG-10/LOG.00.01/UPT-SBYA/X/2026'::text)
    ) v(transaction_id, katalog_id, expected_source_count, expected_history_ids, tanggal, qty, lokasi_id, no_bon)
  loop
    select md5(coalesce(string_agg(
      s.id||'|'||coalesce(s.katalog_id,'')||'|'||coalesce(s.lokasi_id,'')||'|'||coalesce(s.upt_id,'')||'|'||coalesce(s.data::text,''), ',' order by s.id), ''))
    into stock_fingerprint_before
    from public.stocks s
    where s.upt_id='UPT-SBY' and s.data->'sourceLot'->>'key' like 'TUG10|'||p.transaction_id||'|%';

    -- A pre-existing canonical key may belong to another history row. Abort
    -- the whole group rather than overwrite or create a partial mapping.
    with catalogs as (
      select id, data->>'katalog' as catalog_code, data->>'name' as catalog_name,
             count(*) over(partition by data->>'katalog') as catalog_code_count,
             count(*) over(partition by data->>'name') as catalog_name_count
      from public.katalog
    ), source_events as (
      select t.id::text transaction_id, (x.ordinality-1)::integer item_index,
             case when x.item->>'katalogMode'='new' then coalesce(
               (select s.katalog_id from public.stocks s where s.upt_id=t.upt_id and s.data->'sourceLot'->>'key'='TUG10|'||t.id::text||'|'||(x.ordinality-1)::text order by s.created_at desc,s.id limit 1),
               (select c.id from catalogs c where c.catalog_name=x.item->>'namaBaru' and c.catalog_name_count=1 order by c.id limit 1),
               (select c.id from catalogs c where c.catalog_code=x.item->>'katalogBaru' and c.catalog_code_count=1 order by c.id limit 1), nullif(x.item->>'katalogId',''))
             else coalesce(nullif(x.item->>'katalogId',''),(select c.id from catalogs c where c.catalog_code=x.item->>'katalogBaru' and c.catalog_code_count=1 order by c.id limit 1),(select c.id from catalogs c where c.catalog_name=x.item->>'namaBaru' and c.catalog_name_count=1 order by c.id limit 1)) end katalog_id
      from public.tug10_transactions t cross join lateral jsonb_array_elements(coalesce(t.data->'stockItems','[]'::jsonb)) with ordinality x(item,ordinality)
      where t.id=p.transaction_id and (t.status='APPROVED' or t.stage='APPROVED')
    ) select count(*) into target_collisions
    from public.tug15_history h join source_events s on h.sync_key=s.transaction_id||'|'||s.item_index||'|'||s.katalog_id||'|MASUK'
    where s.katalog_id=p.katalog_id and h.id <> all(p.expected_history_ids);
    if target_collisions <> 0 then raise exception 'TUG10 target key occupied: %', p.transaction_id; end if;

    with catalogs as (
      select id, data->>'katalog' as catalog_code, data->>'name' as catalog_name,
             count(*) over(partition by data->>'katalog') as catalog_code_count,
             count(*) over(partition by data->>'name') as catalog_name_count
      from public.katalog
    ), source_events as (
      select t.id::text transaction_id, t.upt_id, (x.ordinality-1)::integer item_index,
             case when x.item->>'katalogMode'='new' then coalesce(
               (select s.katalog_id from public.stocks s where s.upt_id=t.upt_id and s.data->'sourceLot'->>'key'='TUG10|'||t.id::text||'|'||(x.ordinality-1)::text order by s.created_at desc,s.id limit 1),
               (select c.id from catalogs c where c.catalog_name=x.item->>'namaBaru' and c.catalog_name_count=1 order by c.id limit 1),
               (select c.id from catalogs c where c.catalog_code=x.item->>'katalogBaru' and c.catalog_code_count=1 order by c.id limit 1), nullif(x.item->>'katalogId',''))
             else coalesce(nullif(x.item->>'katalogId',''),(select c.id from catalogs c where c.catalog_code=x.item->>'katalogBaru' and c.catalog_code_count=1 order by c.id limit 1),(select c.id from catalogs c where c.catalog_name=x.item->>'namaBaru' and c.catalog_name_count=1 order by c.id limit 1)) end katalog_id,
             (x.item->>'qty')::numeric qty, nullif(t.data->>'lokasiTujuanId','') lokasi_id,
             to_timestamp((coalesce(nullif(t.data->>'approvedAtAsman',''),nullif(t.data->>'approvedAt',''),t.updated_at::text))::numeric/1000)::date tanggal,
             'TUG-10 / '||t.doc_number no_bon,
             coalesce(nullif(t.data->>'namaPekerjaan',''),'-')||chr(32)||chr(8212)||chr(32)||coalesce(x.item->>'statusMaterial','') catatan
      from public.tug10_transactions t cross join lateral jsonb_array_elements(coalesce(t.data->'stockItems','[]'::jsonb)) with ordinality x(item,ordinality)
      where t.id=p.transaction_id and (t.status='APPROVED' or t.stage='APPROVED')
    ), src as (
      select s.*, row_number() over(order by s.item_index) as rn
      from source_events s where s.katalog_id=p.katalog_id and s.qty=p.qty and s.lokasi_id=p.lokasi_id and s.tanggal=p.tanggal and s.no_bon=p.no_bon
    ), hist as (
      select h.id, row_number() over(order by h.id) as rn
      from public.tug15_history h left join public.lokasi l on l.id=h.lokasi_id left join public.gudang g on g.id=l.gudang_id
      where g.upt_id='UPT-SBY' and h.katalog_id=p.katalog_id and h.tanggal=p.tanggal and h.jenis_transaksi='MASUK' and h.qty=p.qty and h.lokasi_id=p.lokasi_id and h.doc_type='TUG10' and h.no_bon=p.no_bon
    ), mapped as (
      select hist.id, src.transaction_id||'|'||src.item_index||'|'||src.katalog_id||'|MASUK' as new_key, src.katalog_id
      from hist join src using (rn)
    )
    update public.tug15_history h set katalog_id=m.katalog_id, sync_key=m.new_key
    from mapped m where h.id=m.id;
    get diagnostics affected = row_count;
    if affected <> coalesce(array_length(p.expected_history_ids,1),0) then raise exception 'TUG10 existing mapping update count failed: %', p.transaction_id; end if;

    with catalogs as (
      select id, data->>'katalog' as catalog_code, data->>'name' as catalog_name,
             count(*) over(partition by data->>'katalog') as catalog_code_count,
             count(*) over(partition by data->>'name') as catalog_name_count
      from public.katalog
    ), source_events as (
      select t.id::text transaction_id, (x.ordinality-1)::integer item_index,
             case when x.item->>'katalogMode'='new' then coalesce(
               (select s.katalog_id from public.stocks s where s.upt_id=t.upt_id and s.data->'sourceLot'->>'key'='TUG10|'||t.id::text||'|'||(x.ordinality-1)::text order by s.created_at desc,s.id limit 1),
               (select c.id from catalogs c where c.catalog_name=x.item->>'namaBaru' and c.catalog_name_count=1 order by c.id limit 1),
               (select c.id from catalogs c where c.catalog_code=x.item->>'katalogBaru' and c.catalog_code_count=1 order by c.id limit 1), nullif(x.item->>'katalogId',''))
             else coalesce(nullif(x.item->>'katalogId',''),(select c.id from catalogs c where c.catalog_code=x.item->>'katalogBaru' and c.catalog_code_count=1 order by c.id limit 1),(select c.id from catalogs c where c.catalog_name=x.item->>'namaBaru' and c.catalog_name_count=1 order by c.id limit 1)) end katalog_id,
             (x.item->>'qty')::numeric qty, nullif(t.data->>'lokasiTujuanId','') lokasi_id,
             to_timestamp((coalesce(nullif(t.data->>'approvedAtAsman',''),nullif(t.data->>'approvedAt',''),t.updated_at::text))::numeric/1000)::date tanggal,
             'TUG-10 / '||t.doc_number no_bon,
             coalesce(nullif(t.data->>'namaPekerjaan',''),'-')||chr(32)||chr(8212)||chr(32)||coalesce(x.item->>'statusMaterial','') catatan
      from public.tug10_transactions t cross join lateral jsonb_array_elements(coalesce(t.data->'stockItems','[]'::jsonb)) with ordinality x(item,ordinality)
      where t.id=p.transaction_id and (t.status='APPROVED' or t.stage='APPROVED')
    ), src as (
      select s.* from source_events s where s.katalog_id=p.katalog_id and s.qty=p.qty and s.lokasi_id=p.lokasi_id and s.tanggal=p.tanggal and s.no_bon=p.no_bon
    ), location_code as (
      select h.lokasi_kode from public.tug15_history h where h.id=p.expected_history_ids[1]
    )
    insert into public.tug15_history (katalog_id,tanggal,jenis_transaksi,qty,lokasi_id,doc_type,lokasi_kode,no_bon,catatan,sync_key)
    select s.katalog_id,s.tanggal,'MASUK',s.qty,s.lokasi_id,'TUG10',lc.lokasi_kode,s.no_bon,s.catatan,s.transaction_id||'|'||s.item_index||'|'||s.katalog_id||'|MASUK'
    from src s cross join location_code lc
    where not exists (select 1 from public.tug15_history h where h.sync_key=s.transaction_id||'|'||s.item_index||'|'||s.katalog_id||'|MASUK');
    get diagnostics affected = row_count;

    with catalogs as (
      select id, data->>'katalog' as catalog_code, data->>'name' as catalog_name,
             count(*) over(partition by data->>'katalog') as catalog_code_count,
             count(*) over(partition by data->>'name') as catalog_name_count
      from public.katalog
    ), source_events as (
      select t.id::text transaction_id, (x.ordinality-1)::integer item_index,
             case when x.item->>'katalogMode'='new' then coalesce(
               (select s.katalog_id from public.stocks s where s.upt_id=t.upt_id and s.data->'sourceLot'->>'key'='TUG10|'||t.id::text||'|'||(x.ordinality-1)::text order by s.created_at desc,s.id limit 1),
               (select c.id from catalogs c where c.catalog_name=x.item->>'namaBaru' and c.catalog_name_count=1 order by c.id limit 1),
               (select c.id from catalogs c where c.catalog_code=x.item->>'katalogBaru' and c.catalog_code_count=1 order by c.id limit 1), nullif(x.item->>'katalogId',''))
             else coalesce(nullif(x.item->>'katalogId',''),(select c.id from catalogs c where c.catalog_code=x.item->>'katalogBaru' and c.catalog_code_count=1 order by c.id limit 1),(select c.id from catalogs c where c.catalog_name=x.item->>'namaBaru' and c.catalog_name_count=1 order by c.id limit 1)) end katalog_id,
             (x.item->>'qty')::numeric qty, nullif(t.data->>'lokasiTujuanId','') lokasi_id,
             to_timestamp((coalesce(nullif(t.data->>'approvedAtAsman',''),nullif(t.data->>'approvedAt',''),t.updated_at::text))::numeric/1000)::date tanggal,
             'TUG-10 / '||t.doc_number no_bon
      from public.tug10_transactions t cross join lateral jsonb_array_elements(coalesce(t.data->'stockItems','[]'::jsonb)) with ordinality x(item,ordinality)
      where t.id=p.transaction_id and (t.status='APPROVED' or t.stage='APPROVED')
    ) select count(*) into final_count from public.tug15_history h join source_events s on h.sync_key=s.transaction_id||'|'||s.item_index||'|'||s.katalog_id||'|MASUK'
    where s.katalog_id=p.katalog_id and s.qty=p.qty and s.lokasi_id=p.lokasi_id and s.tanggal=p.tanggal and s.no_bon=p.no_bon;
    if final_count <> p.expected_source_count then raise exception 'TUG10 final count failed: %', p.transaction_id; end if;

    select count(*) into duplicate_keys from (select h.sync_key from public.tug15_history h where h.sync_key like p.transaction_id||'|%|'||p.katalog_id||'|MASUK' group by h.sync_key having count(*)>1) d;
    if duplicate_keys <> 0 then raise exception 'TUG10 duplicate canonical key: %', p.transaction_id; end if;
    select md5(coalesce(string_agg(
      s.id||'|'||coalesce(s.katalog_id,'')||'|'||coalesce(s.lokasi_id,'')||'|'||coalesce(s.upt_id,'')||'|'||coalesce(s.data::text,''), ',' order by s.id), ''))
    into stock_fingerprint_after
    from public.stocks s
    where s.upt_id='UPT-SBY' and s.data->'sourceLot'->>'key' like 'TUG10|'||p.transaction_id||'|%';
    if stock_fingerprint_after is distinct from stock_fingerprint_before then raise exception 'TUG10 stock rows changed: %', p.transaction_id; end if;
  end loop;
end $$;

-- Delete only proven surplus rows. The minimum id is retained for auditability.
with
catalogs as (
  select id, data->>'katalog' as catalog_code, data->>'name' as catalog_name,
         count(*) over (partition by data->>'katalog') as catalog_code_count,
         count(*) over (partition by data->>'name') as catalog_name_count
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
  from public.tug15_history h
  left join public.lokasi l on l.id=h.lokasi_id
  left join public.gudang g on g.id=l.gudang_id
),
matches as (
  select h.id history_id, s.transaction_id, s.item_index,
         count(s.transaction_id) over (partition by h.id) match_count
  from history_with_upt h
  left join source_events s on s.upt_id=h.upt_id and s.katalog_id=h.katalog_id
   and s.jenis_transaksi=h.jenis_transaksi and s.qty=h.qty and s.tanggal=h.tanggal
   and s.doc_type=h.doc_type and s.no_bon is not distinct from h.no_bon
   and s.lokasi_id is not distinct from h.lokasi_id
),
unique_matches as (
  select distinct on (history_id) history_id, transaction_id, item_index
  from matches
  where match_count=1
  order by history_id, transaction_id, item_index
),
groups as (
  select h.upt_id, h.katalog_id, h.tanggal, h.jenis_transaksi, h.qty,
         h.doc_type, h.no_bon, h.lokasi_id, h.lokasi_kode, h.catatan,
         count(*) as history_count, count(um.history_id) as unique_mapped_count,
         min(h.id) as keep_id
  from history_with_upt h
  left join unique_matches um on um.history_id=h.id
  group by h.upt_id,h.katalog_id,h.tanggal,h.jenis_transaksi,h.qty,
           h.doc_type,h.no_bon,h.lokasi_id,h.lokasi_kode,h.catatan
  having count(*) > 1
),
source_counts as (
  select h.upt_id,h.katalog_id,h.tanggal,h.jenis_transaksi,h.qty,h.doc_type,
         h.no_bon,h.lokasi_id,h.lokasi_kode,h.catatan,
         count(distinct (s.doc_type, s.transaction_id, s.item_index)) as source_count
  from history_with_upt h join source_events s
    on s.upt_id=h.upt_id and s.katalog_id=h.katalog_id and s.tanggal=h.tanggal
   and s.jenis_transaksi=h.jenis_transaksi and s.qty=h.qty and s.doc_type=h.doc_type
   and s.no_bon is not distinct from h.no_bon and s.lokasi_id is not distinct from h.lokasi_id
  group by h.upt_id,h.katalog_id,h.tanggal,h.jenis_transaksi,h.qty,h.doc_type,
           h.no_bon,h.lokasi_id,h.lokasi_kode,h.catatan
),
surplus as (
  select h.id
  from history_with_upt h
  join groups g
    on g.upt_id is not distinct from h.upt_id
   and g.katalog_id is not distinct from h.katalog_id
   and g.tanggal is not distinct from h.tanggal
   and g.jenis_transaksi is not distinct from h.jenis_transaksi
   and g.qty is not distinct from h.qty
   and g.doc_type is not distinct from h.doc_type
   and g.no_bon is not distinct from h.no_bon
   and g.lokasi_id is not distinct from h.lokasi_id
   and g.lokasi_kode is not distinct from h.lokasi_kode
   and g.catatan is not distinct from h.catatan
  join source_counts s
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
    and h.id <> g.keep_id
)
delete from public.tug15_history h
using surplus s
where h.id=s.id;

-- Canonicalize every uniquely mapped row. A collision means the row is left
-- untouched and is reported by the post-check rather than being overwritten.
with
catalogs as (
  select id, data->>'katalog' as catalog_code, data->>'name' as catalog_name,
         count(*) over (partition by data->>'katalog') as catalog_code_count,
         count(*) over (partition by data->>'name') as catalog_name_count
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
  select h.id history_id, s.transaction_id, s.item_index,
         count(s.transaction_id) over (partition by h.id) match_count
  from history_with_upt h left join source_events s on s.upt_id=h.upt_id and s.katalog_id=h.katalog_id
   and s.jenis_transaksi=h.jenis_transaksi and s.qty=h.qty and s.tanggal=h.tanggal and s.doc_type=h.doc_type
   and s.no_bon is not distinct from h.no_bon and s.lokasi_id is not distinct from h.lokasi_id
),
unique_matches as (
  select distinct on (history_id) history_id, transaction_id, item_index
  from matches where match_count=1 order by history_id, transaction_id, item_index
),
updates as (
  select h.id,
         m.transaction_id || '|' || m.item_index || '|' || h.katalog_id || '|' || h.jenis_transaksi as new_key
  from public.tug15_history h join unique_matches m on m.history_id=h.id
),
candidate_updates as (
  select updates.*, count(*) over (partition by new_key) as key_count
  from updates
)
update public.tug15_history h
set sync_key=u.new_key
from candidate_updates u
where h.id=u.id
  and u.key_count=1
  and h.sync_key is distinct from u.new_key
  and not exists (
    select 1 from public.tug15_history occupied
    where occupied.sync_key=u.new_key and occupied.id<>h.id
  );

-- Legacy-only history rows are expected to remain. Stop only when a row that
-- maps uniquely to a current approved source event still has a legacy key.
with catalogs as (
  select id, data->>'katalog' as catalog_code, data->>'name' as catalog_name,
         count(*) over (partition by data->>'katalog') as catalog_code_count,
         count(*) over (partition by data->>'name') as catalog_name_count
  from public.katalog
), source_events as (
  select 'TUG3'::text doc_type, t.id::text transaction_id, t.upt_id,
         (x.ordinality-1)::integer item_index,
         case when x.item->>'katalogMode'='new' then coalesce(
           (select s.katalog_id from public.stocks s where s.upt_id=t.upt_id and s.data->'sourceLot'->>'key'='TUG3|'||t.id::text||'|'||(x.ordinality-1)::text order by s.created_at desc,s.id limit 1),
           (select c.id from catalogs c where c.catalog_name=x.item->>'namaBaru' and c.catalog_name_count=1 order by c.id limit 1),
           (select c.id from catalogs c where c.catalog_code=x.item->>'katalogBaru' and c.catalog_code_count=1 order by c.id limit 1), nullif(x.item->>'katalogId',''))
         else coalesce(nullif(x.item->>'katalogId',''),(select c.id from catalogs c where c.catalog_code=x.item->>'katalogBaru' and c.catalog_code_count=1 order by c.id limit 1),(select c.id from catalogs c where c.catalog_name=x.item->>'namaBaru' and c.catalog_name_count=1 order by c.id limit 1)) end katalog_id,
         (x.item->>'qty')::numeric qty, nullif(t.data->>'lokasiTujuanId','') lokasi_id,
         to_timestamp((coalesce(nullif(t.data->>'approvedAtAsman',''),nullif(t.data->>'approvedAt',''),t.updated_at::text))::numeric/1000)::date tanggal,
         'MASUK'::text jenis_transaksi, 'TUG-3 / '||t.doc_number no_bon
  from public.tug3_transactions t cross join lateral jsonb_array_elements(coalesce(t.data->'stockItems','[]'::jsonb)) with ordinality x(item,ordinality)
  where t.status='APPROVED' or t.stage='APPROVED'
  union all
  select 'TUG10', t.id::text, t.upt_id, (x.ordinality-1)::integer,
         case when x.item->>'katalogMode'='new' then coalesce(
           (select s.katalog_id from public.stocks s where s.upt_id=t.upt_id and s.data->'sourceLot'->>'key'='TUG10|'||t.id::text||'|'||(x.ordinality-1)::text order by s.created_at desc,s.id limit 1),
           (select c.id from catalogs c where c.catalog_name=x.item->>'namaBaru' and c.catalog_name_count=1 order by c.id limit 1),
           (select c.id from catalogs c where c.catalog_code=x.item->>'katalogBaru' and c.catalog_code_count=1 order by c.id limit 1), nullif(x.item->>'katalogId',''))
         else coalesce(nullif(x.item->>'katalogId',''),(select c.id from catalogs c where c.catalog_code=x.item->>'katalogBaru' and c.catalog_code_count=1 order by c.id limit 1),(select c.id from catalogs c where c.catalog_name=x.item->>'namaBaru' and c.catalog_name_count=1 order by c.id limit 1)) end,
         (x.item->>'qty')::numeric,nullif(t.data->>'lokasiTujuanId',''),
         to_timestamp((coalesce(nullif(t.data->>'approvedAtAsman',''),nullif(t.data->>'approvedAt',''),t.updated_at::text))::numeric/1000)::date,
         'MASUK','TUG-10 / '||t.doc_number
  from public.tug10_transactions t cross join lateral jsonb_array_elements(coalesce(t.data->'stockItems','[]'::jsonb)) with ordinality x(item,ordinality)
  where t.status='APPROVED' or t.stage='APPROVED'
  union all
  select t.doc_type,t.id::text,t.upt_id,i.line_no-1,i.katalog_id,i.qty,i.lokasi_id,
         coalesce(t.final_approved_at,t.updated_at,t.created_at)::date,'KELUAR',
         'TUG-'||replace(t.doc_type,'TUG','')||' / '||t.doc_number
  from public.tug_transactions t join public.tug_items i on i.transaction_id=t.id
  where t.doc_type in ('TUG8','TUG9') and t.status='FINAL_APPROVED'
), history_with_upt as (
  select h.*,coalesce(g.upt_id,'<NO_UPT>') upt_id
  from public.tug15_history h left join public.lokasi l on l.id=h.lokasi_id left join public.gudang g on g.id=l.gudang_id
), matches as (
  select h.id,h.sync_key,s.transaction_id,s.item_index,s.katalog_id,
         count(s.transaction_id) over(partition by h.id) match_count
  from history_with_upt h left join source_events s
    on s.upt_id=h.upt_id and s.katalog_id=h.katalog_id and s.jenis_transaksi=h.jenis_transaksi
   and s.qty=h.qty and s.tanggal=h.tanggal and s.doc_type=h.doc_type
   and s.no_bon is not distinct from h.no_bon and s.lokasi_id is not distinct from h.lokasi_id
)
select 'remaining_mapped_legacy_keys' as check_name, count(*) as value
from matches
where match_count=1 and (sync_key is null or sync_key not like '%|%');
select 'duplicate_canonical_keys' as check_name, count(*) as value
from (
  select sync_key from public.tug15_history where sync_key like '%|%' group by sync_key having count(*)>1
) d;

-- Abort if production changed after the reviewed audit or the reported scan
-- does not reconcile. Pre-repair count: 598; delete 135; insert 33.
do $$
declare
  history_count integer;
  scan_result jsonb;
  total_masuk numeric;
begin
  select count(*) into history_count from public.tug15_history;
  if history_count <> 496 then raise exception 'unexpected final history count: %', history_count; end if;

  select public.public_material_scan('KAT-TUG10-9590ea6e8d39423a8154379d0eb4eff1','UPT-PBG') into scan_result;
  select coalesce(sum((h->>'qty')::numeric),0) into total_masuk
  from jsonb_array_elements(scan_result->'history') h
  where h->>'jenis_transaksi'='MASUK';
  if scan_result->>'qty' <> '21' or total_masuk <> 21
     or jsonb_array_length(scan_result->'history') <> 1
  then raise exception '3060016 Probolinggo scan did not reconcile'; end if;
end $$;

-- The operator must replace this with COMMIT only after reviewing the checks.
rollback;
