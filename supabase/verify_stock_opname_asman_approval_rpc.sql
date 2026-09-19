-- Read-only verifier. Run after the proposal migration in a staging/scratch database.
select p.oid::regprocedure as function_name,
       p.prosecdef as security_definer,
       p.proconfig as function_config,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'approve_stock_opname_asman';

-- Expected: one row, security_definer=true, search_path=public,pg_temp,
-- authenticated_execute=true.
