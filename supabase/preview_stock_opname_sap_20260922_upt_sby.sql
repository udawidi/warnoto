-- READ ONLY. Save this output before running the matching backfill.
-- A full pg_dump is still required before production execution.
with target_opname as (
  select o.id, o.data, (o.data->>'approvedAtAsman')::bigint approved_at_ms
  from public.stock_opname o
  where o.upt_id = 'UPT-SBY'
    and o.status = 'SELESAI'
    and o.data->>'jenisAlur' = 'SAP'
    and coalesce(o.data->>'approvedAtAsman','') ~ '^[0-9]+$'
    and to_timestamp((o.data->>'approvedAtAsman')::double precision / 1000) >= timestamptz '2026-09-22 00:00:00+07'
    and to_timestamp((o.data->>'approvedAtAsman')::double precision / 1000) < timestamptz '2026-09-23 00:00:00+07'
)
select id,
       approved_at_ms,
       md5(data::text) document_hash,
       (select coalesce(jsonb_agg(jsonb_build_object(
          'katalogId', item->>'katalogId',
          'noKatalog', item->>'noKatalog',
          'keterangan', item->>'keterangan'
        )), '[]'::jsonb)
        from jsonb_array_elements(data->'items') item
        where nullif(btrim(item->>'keterangan'), '') is not null) notes
from target_opname
order by approved_at_ms, id;

-- Save the rollback_sql column to a private file outside Git before apply.
with target_opname as (
  select o.id, o.data, (o.data->>'approvedAtAsman')::bigint approved_at_ms
  from public.stock_opname o
  where o.upt_id = 'UPT-SBY' and o.status = 'SELESAI' and o.data->>'jenisAlur' = 'SAP'
    and coalesce(o.data->>'approvedAtAsman','') ~ '^[0-9]+$'
    and to_timestamp((o.data->>'approvedAtAsman')::double precision / 1000) >= timestamptz '2026-09-22 00:00:00+07'
    and to_timestamp((o.data->>'approvedAtAsman')::double precision / 1000) < timestamptz '2026-09-23 00:00:00+07'
), catalogs as (
  select distinct item->>'katalogId' katalog_id
  from target_opname o cross join lateral jsonb_array_elements(o.data->'items') item
  where nullif(item->>'katalogId','') is not null and coalesce(item->>'qtySAP','') ~ '^([0-9]+)(\.[0-9]+)?$'
)
select s.id stock_id,
       s.katalog_id,
       s.data->>'qty' warnoto_qty,
       s.data->'sapBaselineQty' old_sap_baseline_qty,
       s.data->'sapBaselineAt' old_sap_baseline_at,
       format('update public.stocks set data = %L::jsonb where id = %L;', s.data::text, s.id) rollback_sql
from public.stocks s
join catalogs c on c.katalog_id = s.katalog_id
where coalesce(s.upt_id, (select g.upt_id from public.lokasi l join public.gudang g on g.id=l.gudang_id where l.id=s.lokasi_id)) = 'UPT-SBY'
order by s.katalog_id, s.id;
