-- Read-only verifier. Run against the target database after the migration is reviewed/applied.
select 'updated_at_column' as check_name,
       exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'stock_opname' and column_name = 'updated_at'
       ) as ok;

select 'freeze_rpc' as check_name,
       to_regprocedure('public.set_stock_opname_freeze(text,boolean,text[])') is not null as ok;

select 'freeze_guard_trigger' as check_name,
       exists (
         select 1 from pg_trigger
         where tgrelid = 'public.stock_opname'::regclass
           and tgname = 'trg_stock_opname_guard_freeze'
           and not tgisinternal
       ) as ok;

select 'realtime_publication' as check_name,
       exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stock_opname'
       ) as ok;
