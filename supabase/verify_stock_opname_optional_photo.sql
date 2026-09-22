-- Read-only verifier for the optional-photo rollout.
select 'required_photo_trigger_absent' as check_name,
       count(*)::bigint as value
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'stock_opname'
  and t.tgname = 'stock_opname_required_photo_guard'
  and not t.tgisinternal;

select 'anti_data_url_constraint' as check_name,
       count(*)::bigint as value
from pg_constraint c
join pg_class r on r.oid = c.conrelid
join pg_namespace n on n.oid = r.relnamespace
where n.nspname = 'public'
  and r.relname = 'stock_opname'
  and c.conname = 'stock_opname_data_no_photo_data_url';

select 'stock_photo_write_policies' as check_name,
       count(*)::bigint as value
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname in ('Stock Opname upload stock-photos', 'Stock Opname update stock-photos');

select 'approval_rpc_exists' as check_name,
       count(*)::bigint as value
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.oid = 'public.approve_stock_opname_asman(text,jsonb,jsonb,jsonb)'::regprocedure;

select 'approval_rpc_authenticated_grant' as check_name,
       has_function_privilege(
         'authenticated',
         'public.approve_stock_opname_asman(text,jsonb,jsonb,jsonb)',
         'execute'
       )::int as value;

-- Expected: required_photo_trigger_absent=0; anti_data_url_constraint=1;
-- stock_photo_write_policies=2; approval_rpc_exists=1;
-- approval_rpc_authenticated_grant=1.
