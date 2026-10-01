-- Read-only production verification for 20261001_tug10_atomic_final_approval.sql.
\set ON_ERROR_STOP on

do $$
declare
  v_constraint text;
  v_rpc text;
begin
  if to_regprocedure('public.approve_tug10_final(text,uuid)') is null then
    raise exception 'VERIFY_TUG10_RPC_MISSING';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.stocks'::regclass
      and tgname = 'trg_tug10_guard_legacy_stock_write'
      and tgenabled <> 'D'
  ) then
    raise exception 'VERIFY_TUG10_STOCK_GUARD_MISSING';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.tug10_transactions'::regclass
      and tgname = 'trg_tug10_guard_legacy_status_write'
      and tgenabled <> 'D'
  ) then
    raise exception 'VERIFY_TUG10_STATUS_GUARD_MISSING';
  end if;
  select pg_get_constraintdef(oid) into v_constraint
  from pg_constraint
  where conrelid = 'public.tug_idempotency_keys'::regclass
    and conname = 'tug_idempotency_keys_operation_check';
  if v_constraint is null or position('TUG10_FINAL_APPROVE' in v_constraint) = 0 then
    raise exception 'VERIFY_TUG10_IDEMPOTENCY_CONSTRAINT_MISSING';
  end if;
  if not has_function_privilege('authenticated', 'public.approve_tug10_final(text,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.approve_tug10_final(text,uuid)', 'EXECUTE') then
    raise exception 'VERIFY_TUG10_RPC_GRANT_INVALID';
  end if;
  select pg_get_functiondef('public.approve_tug10_final(text,uuid)'::regprocedure) into v_rpc;
  if position('targetStockId' in v_rpc) = 0
     or position('stockHandling' in v_rpc) = 0 then
    raise exception 'VERIFY_TUG10_TARGET_STOCK_INPUT_MISSING';
  end if;
  if position('TUG10_TARGET_STOCK_MISMATCH' in v_rpc) = 0
     or position('TUG10_TARGET_STOCK_AMBIGUOUS' in v_rpc) = 0 then
    raise exception 'VERIFY_TUG10_TARGET_STOCK_GUARDS_MISSING';
  end if;
  if position('tug10ReturnEffects' in v_rpc) = 0
     or position('returnStatus' in v_rpc) = 0
     or position('TUG10_STOCK_HANDLING_INVALID' in v_rpc) = 0
     or position('insert into public.stocks(id, katalog_id, lokasi_id, upt_id' in v_rpc) = 0 then
    raise exception 'VERIFY_TUG10_TARGET_STOCK_EFFECTS_MISSING';
  end if;
end $$;

select 'TUG10_ATOMIC_OK' as result,
       id,
       status,
       stage,
       updated_at
from public.tug10_transactions
where id = 'TUG10-VJ580X';
