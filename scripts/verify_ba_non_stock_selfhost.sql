\set ON_ERROR_STOP on

select case when to_regclass('public.ba_non_stock') is not null then 'PASS table ba_non_stock' else 'FAIL table ba_non_stock' end;
select case when to_regclass('public.ba_non_stock_items') is not null then 'PASS table ba_non_stock_items' else 'FAIL table ba_non_stock_items' end;
select case when to_regclass('public.ba_non_stock_counters') is not null then 'PASS table ba_non_stock_counters' else 'FAIL table ba_non_stock_counters' end;
select case when to_regprocedure('public.save_ba_non_stock_draft(text,integer,text,jsonb)') is not null then 'PASS rpc save' else 'FAIL rpc save' end;
select case when to_regprocedure('public.submit_ba_non_stock(text,integer)') is not null then 'PASS rpc submit' else 'FAIL rpc submit' end;
select case when to_regprocedure('public.decide_ba_non_stock(text,integer,text,text)') is not null then 'PASS rpc decide' else 'FAIL rpc decide' end;
select case when relrowsecurity then 'PASS rls ba_non_stock' else 'FAIL rls ba_non_stock' end from pg_class where oid='public.ba_non_stock'::regclass;
select case when has_function_privilege('authenticated', 'public.save_ba_non_stock_draft(text,integer,text,jsonb)', 'EXECUTE') then 'PASS authenticated execute' else 'FAIL authenticated execute' end;
select case when not has_table_privilege('authenticated', 'public.ba_non_stock', 'INSERT,UPDATE,DELETE') then 'PASS direct writes closed' else 'FAIL direct writes closed' end;
select case when not exists (
  select 1 from pg_proc
  where oid in (
    'public.save_ba_non_stock_draft(text,integer,text,jsonb)'::regprocedure,
    'public.submit_ba_non_stock(text,integer)'::regprocedure,
    'public.decide_ba_non_stock(text,integer,text,text)'::regprocedure
  ) and pg_get_functiondef(oid) ~* '(update|insert into|delete from) public[.]stocks'
) then 'PASS no stock mutation' else 'FAIL stock mutation detected' end;
