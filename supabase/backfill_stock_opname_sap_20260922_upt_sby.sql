-- Apply only after reviewing preview_stock_opname_sap_20260922_upt_sby.sql,
-- saving its output outside Git, and taking a fresh production pg_dump.
-- This transaction never updates stock_opname or stocks.data.qty.
begin;

create temp table _opname_document_before on commit drop as
select o.id, md5(o.data::text) document_hash
from public.stock_opname o
where o.upt_id = 'UPT-SBY'
  and o.status = 'SELESAI'
  and o.data->>'jenisAlur' = 'SAP'
  and coalesce(o.data->>'approvedAtAsman','') ~ '^[0-9]+$'
  and to_timestamp((o.data->>'approvedAtAsman')::double precision / 1000) >= timestamptz '2026-09-22 00:00:00+07'
  and to_timestamp((o.data->>'approvedAtAsman')::double precision / 1000) < timestamptz '2026-09-23 00:00:00+07';

do $$
begin
  if not exists (select 1 from _opname_document_before) then
    raise exception 'OPNAME_BACKFILL_TARGET_EMPTY';
  end if;
end;
$$;

create temp table _latest_sap_baseline on commit drop as
with target_opname as (
  select o.id opname_id, o.data, (o.data->>'approvedAtAsman')::bigint approved_at_ms
  from public.stock_opname o
  join _opname_document_before before_row on before_row.id = o.id
), candidates as (
  select o.opname_id,
         o.approved_at_ms,
         item->>'katalogId' katalog_id,
         (item->>'qtySAP')::numeric sap_qty,
         row_number() over (partition by item->>'katalogId' order by o.approved_at_ms desc, o.opname_id desc) rank_no
  from target_opname o
  cross join lateral jsonb_array_elements(o.data->'items') item
  where nullif(item->>'katalogId','') is not null
    and coalesce(item->>'qtySAP','') ~ '^([0-9]+)(\.[0-9]+)?$'
)
select opname_id, approved_at_ms, katalog_id, sap_qty
from candidates
where rank_no = 1;

create temp table _stock_qty_before on commit drop as
select s.id, s.data->'qty' warnoto_qty
from public.stocks s
join _latest_sap_baseline latest on latest.katalog_id = s.katalog_id
where coalesce(s.upt_id, (select g.upt_id from public.lokasi l join public.gudang g on g.id=l.gudang_id where l.id=s.lokasi_id)) = 'UPT-SBY';

update public.stocks s
set data = jsonb_set(
  jsonb_set(coalesce(s.data, '{}'::jsonb), '{sapBaselineQty}', to_jsonb(latest.sap_qty), true),
  '{sapBaselineAt}', to_jsonb(latest.approved_at_ms), true
)
from _latest_sap_baseline latest
where s.katalog_id = latest.katalog_id
  and coalesce(s.upt_id, (select g.upt_id from public.lokasi l join public.gudang g on g.id=l.gudang_id where l.id=s.lokasi_id)) = 'UPT-SBY';

do $$
begin
  if exists (
    select 1 from _opname_document_before before_row
    left join public.stock_opname o on o.id = before_row.id
    where o.id is null or md5(o.data::text) is distinct from before_row.document_hash
  ) then
    raise exception 'OPNAME_DOCUMENT_CHANGED_DURING_BACKFILL';
  end if;
  if exists (
    select 1 from _stock_qty_before before_row
    join public.stocks s on s.id = before_row.id
    where s.data->'qty' is distinct from before_row.warnoto_qty
  ) then
    raise exception 'OPNAME_WARNOTO_QTY_CHANGED_DURING_BACKFILL';
  end if;
end;
$$;

select latest.opname_id, latest.katalog_id, latest.sap_qty, latest.approved_at_ms,
       count(s.id) affected_stock_rows
from _latest_sap_baseline latest
left join public.stocks s on s.katalog_id = latest.katalog_id
  and coalesce(s.upt_id, (select g.upt_id from public.lokasi l join public.gudang g on g.id=l.gudang_id where l.id=s.lokasi_id)) = 'UPT-SBY'
group by latest.opname_id, latest.katalog_id, latest.sap_qty, latest.approved_at_ms
order by latest.katalog_id;

commit;
