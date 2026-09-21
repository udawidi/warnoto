-- Read-only verification for 20260921_har_uit_heavy_equipment_loans.sql.
-- Run after migration in a transaction or a disposable rehearsal database.
do $$
declare
  v_type integer;
  v_fk integer;
  v_index integer;
  v_har_policy integer;
  v_har_rpc integer;
begin
  select count(*) into v_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'heavy_equipment_loans'
      and column_name = 'requester_uit_id' and is_nullable = 'YES';
  if v_type <> 1 then raise exception 'requester_uit_id nullable typed column missing'; end if;

  select count(*) into v_fk
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'heavy_equipment_loans'
      and c.conname = 'heavy_equipment_loans_requester_uit_id_fkey';
  if v_fk <> 1 then raise exception 'requester_uit_id foreign key missing'; end if;

  select count(*) into v_index
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'heavy_equipment_loans'
      and indexname = 'idx_heavy_equipment_loans_requester_uit_id';
  if v_index <> 1 then raise exception 'requester_uit_id index missing'; end if;

  select count(*) into v_har_policy
    from pg_policies
    where schemaname = 'public'
      and policyname in ('Heavy equipment scoped read', 'Heavy equipment loan scoped read')
      and (qual ilike '%HAR_UIT%' or with_check ilike '%HAR_UIT%');
  if v_har_policy < 2 then raise exception 'HAR_UIT read policy branches missing'; end if;

  select count(*) into v_har_rpc
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('checkout_heavy_equipment_batch', 'checkout_heavy_equipment_batch_v2')
      and pg_get_functiondef(p.oid) ilike '%borrowerUitId%'
      and pg_get_functiondef(p.oid) ilike '%PENDING_OWNER_ASMAN%';
  if v_har_rpc <> 2 then raise exception 'HAR_UIT checkout RPC branches missing'; end if;
end $$;

-- Rehearsal checklist:
-- 1. HAR_UIT with uit_id and no upt_id sees only registry rows whose owner UPT
--    has the same upt.uit_id; canonical empty response stays empty.
-- 2. Same actor can read loans by owner_upt_id/requester_upt_id UIT membership
--    or requester_uit_id, but a third UIT cannot.
-- 3. HAR_UIT can checkout only available, cross-enabled assets from one owner UPT
--    in its UIT; status is PENDING_OWNER_ASMAN and requester_upt_id is NULL.
-- 4. TL branch remains owner-UPT-only; TL cannot submit borrowerType HAR_UIT.
-- 5. HAR evidence upload is limited to owner UPT prefix; referenced objects are
--    immutable and only orphan objects may be deleted.
