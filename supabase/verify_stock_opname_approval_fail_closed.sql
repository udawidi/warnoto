-- Read-only verifier. Run after an explicitly approved migration; this file does not write data.
select 'approval_rpc_signature' as check_name,
       count(*)::int as value
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.oid = 'public.approve_stock_opname_asman(text,jsonb,jsonb,jsonb)'::regprocedure;

select 'approval_rpc_fail_closed_guards' as check_name,
       (p.prosrc like '%OPNAME_APPROVAL_NOTE_REQUIRED:%'
        and p.prosrc like '%OPNAME_APPROVAL_QTY_MUTATION%'
        and p.prosrc like '%OPNAME_APPROVAL_STORED_ITEMS_INVALID%'
        and p.prosrc like '%sapBaselineQty%'
        and p.prosrc like '%OPNAME_APPROVAL_SNAPSHOT_MISMATCH%'
        and p.prosrc like '%OPNAME_APPROVAL_SAP_DUPLICATE_CONFLICT%'
        and p.prosrc like '%is distinct from v_upt_id%')::int as value
from pg_proc p
where p.oid = 'public.approve_stock_opname_asman(text,jsonb,jsonb,jsonb)'::regprocedure;

select 'approval_rpc_server_snapshot' as check_name,
       (p.prosrc like '%v_opname.data - ''approvedByAsman'' - ''approvedAtAsman'' - ''freeze''%'
        and p.prosrc like '%OPNAME_APPROVAL_ALREADY_FINAL%'
        and p.prosrc like '%p_opname_data->''items'' <> v_final_items%'
        and p.prosrc like '%v_final_data := jsonb_set(v_opname.data%')::int as value
from pg_proc p
where p.oid = 'public.approve_stock_opname_asman(text,jsonb,jsonb,jsonb)'::regprocedure;

select 'approval_rpc_decimal_quantity_parser' as check_name,
       (strpos(p.prosrc, E'(\\.[0-9]+)') > 0
        and strpos(p.prosrc, E'(\\\\.[0-9]+)') = 0)::int as value
from pg_proc p
where p.oid = 'public.approve_stock_opname_asman(text,jsonb,jsonb,jsonb)'::regprocedure;

select 'approval_rpc_identity_preservation' as check_name,
       (p.prosrc like '%v_safe_row := jsonb_set%'
        and p.prosrc like '%''{katalogId}''%'
        and p.prosrc like '%''{lokasiId}''%'
        and p.prosrc like '%''{gudangId}''%'
        and p.prosrc like '%''{uptId}''%'
        and p.prosrc like '%''{qty}''%'
        and p.prosrc like '%update public.stocks set data = v_safe_row%')::int as value
from pg_proc p
where p.oid = 'public.approve_stock_opname_asman(text,jsonb,jsonb,jsonb)'::regprocedure;

select 'approval_rpc_finalization_after_validation' as check_name,
       (position('update public.stock_opname set data' in p.prosrc) > position('OPNAME_APPROVAL_QTY_MUTATION' in p.prosrc))::int as value
from pg_proc p
where p.oid = 'public.approve_stock_opname_asman(text,jsonb,jsonb,jsonb)'::regprocedure;

select 'tug_reference_rpc_signature' as check_name,
       count(*)::int as value
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.oid = 'public.update_stock_opname_tug_reference(text,text,text)'::regprocedure;

select 'rejection_rpc_signature' as check_name,
       count(*)::int as value
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.oid = 'public.reject_stock_opname_asman(text,text)'::regprocedure;

select 'stock_opname_write_policies' as check_name,
       count(*)::int as value
from pg_policies
where schemaname = 'public' and tablename = 'stock_opname'
  and policyname in (
    'Stock opname draft insert by warehouse roles',
    'Stock opname draft update by warehouse roles',
    'Stock opname draft delete by warehouse roles'
  );

select 'rpc_authenticated_grants' as check_name,
       (has_function_privilege('authenticated', 'public.approve_stock_opname_asman(text,jsonb,jsonb,jsonb)', 'execute')
        and has_function_privilege('authenticated', 'public.update_stock_opname_tug_reference(text,text,text)', 'execute')
        and has_function_privilege('authenticated', 'public.reject_stock_opname_asman(text,text)', 'execute'))::int as value;

select 'rpc_anon_denied' as check_name,
       (not has_function_privilege('anon', 'public.approve_stock_opname_asman(text,jsonb,jsonb,jsonb)', 'execute')
        and not has_function_privilege('anon', 'public.update_stock_opname_tug_reference(text,text,text)', 'execute')
        and not has_function_privilege('anon', 'public.reject_stock_opname_asman(text,text)', 'execute'))::int as value;
