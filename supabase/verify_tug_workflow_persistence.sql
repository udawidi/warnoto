-- Read-only verifier. Every result should be 1 after migration.
select 'table_exists' as check_name, (to_regclass('public.tug_workflow_transactions') is not null)::int as ok;
select 'parent_fk' as check_name, (count(*) = 1)::int as ok from information_schema.table_constraints where table_schema='public' and table_name='tug_workflow_transactions' and constraint_type='FOREIGN KEY' and constraint_name ilike '%parent_workflow%';
select 'parent_unique_partial' as check_name, (count(*) = 1)::int as ok from pg_indexes where schemaname='public' and tablename='tug_workflow_transactions' and indexname='tug_workflow_parent_unique_idx';
select 'rls_enabled' as check_name, coalesce((select relrowsecurity::int from pg_class where oid='public.tug_workflow_transactions'::regclass),0) as ok;
select 'select_policy' as check_name, (count(*) = 1)::int as ok from pg_policies where schemaname='public' and tablename='tug_workflow_transactions' and policyname='Scoped read tug workflow';
select 'no_direct_write_policies' as check_name, (count(*) = 0)::int as ok from pg_policies where schemaname='public' and tablename='tug_workflow_transactions' and (cmd in ('INSERT','UPDATE','DELETE') or cmd='ALL');
select 'save_rpc' as check_name, (to_regprocedure('public.save_tug_workflow_transaction(text,text,text,text,text,text,text,text,bigint,jsonb,integer)') is not null)::int as ok;
select 'delete_rpc' as check_name, (to_regprocedure('public.delete_tug_workflow_transaction(text,integer)') is not null)::int as ok;
select 'transition_rpc' as check_name, (to_regprocedure('public.transition_tug_workflow_transaction(text,integer,text,text,jsonb)') is not null)::int as ok;
select 'atomic_transition_rpc' as check_name, (to_regprocedure('public.transition_tug_workflow_with_child(text,text,integer,text,jsonb)') is not null)::int as ok;
select 'issue_number_rpc' as check_name, (to_regprocedure('public.issue_tug_workflow_document_number(text,integer,text)') is not null)::int as ok;
select 'workflow_grants' as check_name, (count(*) = 5)::int as ok from information_schema.routine_privileges where routine_schema='public' and routine_name in ('save_tug_workflow_transaction','delete_tug_workflow_transaction','transition_tug_workflow_transaction','transition_tug_workflow_with_child','issue_tug_workflow_document_number') and grantee='authenticated' and privilege_type='EXECUTE';
select 'table_dml_grants' as check_name, (count(*) = 1)::int as ok from information_schema.role_table_grants where table_schema='public' and table_name='tug_workflow_transactions' and grantee='authenticated' and privilege_type='SELECT';
