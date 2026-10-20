-- Read-only verifier. Every result should be 1 after migration.
select 'asman_rpc_exists' as check_name,
  (to_regprocedure('public.approve_tug5_asman_with_child(text,integer,text,jsonb)') is not null)::int as ok;
select 'asman_rpc_authenticated_grant' as check_name,
  (has_function_privilege('authenticated', 'public.approve_tug5_asman_with_child(text,integer,text,jsonb)', 'execute')
   and not has_function_privilege('anon', 'public.approve_tug5_asman_with_child(text,integer,text,jsonb)', 'execute'))::int as ok;
select 'asman_stage_guard' as check_name,
  (count(*) = 1)::int as ok
from pg_trigger
where tgrelid = 'public.tug_workflow_transactions'::regclass
  and tgname = 'tug5_asman_final_stage_guard'
  and not tgisinternal;
