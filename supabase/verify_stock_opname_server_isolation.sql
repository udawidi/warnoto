-- Read-only verifier for 20260920c. Run as an administrative connection.
select to_regprocedure('public.can_access_upt(text)') as can_access_upt;

select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('stock_opname', 'stock_count')
  and column_name = 'upt_id'
order by table_name;

select 'stock_opname' as table_name, count(*) filter (where upt_id is null) as null_upt,
       count(*) filter (where u.id is null) as orphan_upt
from public.stock_opname o left join public.upt u on u.id = o.upt_id
union all
select 'stock_count', count(*) filter (where upt_id is null), count(*) filter (where u.id is null)
from public.stock_count c left join public.upt u on u.id = c.upt_id;

select conrelid::regclass as table_name, conname, confrelid::regclass as references_table
from pg_constraint
where conname in ('stock_opname_upt_id_fkey', 'stock_count_upt_id_fkey');

select indexname, tablename
from pg_indexes
where schemaname = 'public'
  and indexname in ('idx_stock_opname_upt_id', 'idx_stock_count_upt_id');

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in ('stock_opname', 'stock_count')
order by tablename, policyname;

select has_table_privilege('anon', 'public.stock_opname', 'SELECT') as anon_opname_select,
       has_table_privilege('anon', 'public.stock_count', 'SELECT') as anon_count_select,
       has_table_privilege('authenticated', 'public.stock_opname', 'SELECT') as auth_opname_select,
       has_table_privilege('authenticated', 'public.stock_opname', 'INSERT') as auth_opname_insert,
       has_table_privilege('authenticated', 'public.stock_opname', 'UPDATE') as auth_opname_update,
       has_table_privilege('authenticated', 'public.stock_opname', 'DELETE') as auth_opname_delete,
       has_table_privilege('authenticated', 'public.stock_opname', 'TRUNCATE') as auth_opname_truncate,
       has_table_privilege('authenticated', 'public.stock_count', 'SELECT') as auth_count_select,
       has_table_privilege('authenticated', 'public.stock_count', 'INSERT') as auth_count_insert,
       has_table_privilege('authenticated', 'public.stock_count', 'UPDATE') as auth_count_update,
       has_table_privilege('authenticated', 'public.stock_count', 'DELETE') as auth_count_delete,
       has_table_privilege('authenticated', 'public.stock_count', 'TRUNCATE') as auth_count_truncate;
