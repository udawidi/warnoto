-- Read-only production gate for 20260911_tug_item_source_history.sql.
-- Run with psql --set ON_ERROR_STOP=1. No statement below mutates data.

\echo 'Canonical item coverage'
select t.doc_number, t.doc_type, count(*) as item_count,
       count(*) filter (where i.source_snapshot <> '{}'::jsonb) as sourced_count
from public.tug_transactions t
join public.tug_items i on i.transaction_id=t.id
where t.doc_type in ('TUG8','TUG9')
group by t.doc_number, t.doc_type
order by t.doc_number;

\echo 'Unresolved source snapshots (must be zero after apply)'
select count(*) as unresolved_items
from public.tug_transactions t
join public.tug_items i on i.transaction_id=t.id
where t.doc_type in ('TUG8','TUG9')
  and (i.source_snapshot is null or i.source_snapshot = '{}'::jsonb);

\echo 'Source class distribution'
select i.source_snapshot->>'sourceKind' as source_kind, count(*)
from public.tug_transactions t
join public.tug_items i on i.transaction_id=t.id
where t.doc_type in ('TUG8','TUG9')
group by i.source_snapshot->>'sourceKind'
order by source_kind;

\echo 'TUG-9 250 source detail'
select t.doc_number, i.line_no, i.stock_id,
       i.source_snapshot->>'sourceKind' as source_kind,
       i.source_snapshot->'contracts' as contracts,
       i.source_snapshot->>'provenance' as provenance
from public.tug_transactions t
join public.tug_items i on i.transaction_id=t.id
where t.doc_type='TUG9' and t.doc_number like '250.TUG-9/%'
order by i.line_no;

\echo 'TUG-9 250 expected contract coverage (3 from TUG-3 198, 1 from TUG-3 202)'
select t.doc_number,
       count(*) filter (where exists (
         select 1 from jsonb_array_elements(i.source_snapshot->'contracts') c
         where c->>'docNo' like '198.TUG-3/%'
       )) as refs_from_198,
       count(*) filter (where exists (
         select 1 from jsonb_array_elements(i.source_snapshot->'contracts') c
         where c->>'docNo' like '202.TUG-3/%'
       )) as refs_from_202
from public.tug_transactions t
join public.tug_items i on i.transaction_id=t.id
where t.doc_type='TUG9' and t.doc_number like '250.TUG-9/%'
group by t.doc_number;

\echo 'Temporal invariant (must be zero)'
select count(*) as future_contract_refs
from public.tug_transactions t
join public.tug_items i on i.transaction_id=t.id
cross join lateral jsonb_array_elements(i.source_snapshot->'contracts') c
where t.doc_type in ('TUG8','TUG9')
  and public.tug_source_epoch_ms(c->>'tglMasuk') > (extract(epoch from t.created_at) * 1000)::bigint;

\echo 'Canonical evidence invariants (counts only)'
select
  (select count(*) from public.tug_items where source_snapshot <> '{}'::jsonb) as sourced,
  (select count(*) from public.stock_movements where direction='OUT') as out_movements,
  (select count(*) from public.tug_transactions where doc_type in ('TUG8','TUG9') and document_hash is not null) as hashed_documents;
