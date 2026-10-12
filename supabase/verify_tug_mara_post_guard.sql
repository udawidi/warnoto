-- Read-only verifier for 20261012_tug_mara_post_guard.sql.
select
  to_regprocedure('public.tug_mara_resolve(text,text)') is not null as has_mara_resolver,
  to_regprocedure('public.approve_tug3_final(text,uuid)') is not null as has_tug3_final_rpc,
  to_regprocedure('public.approve_tug10_final(text,uuid)') is not null as has_tug10_final_rpc,
  to_regprocedure('public.mtu_khs_apply_tug3_receipt(text,text)') is not null as has_mtu_receipt_rpc;

select c.conname,
       pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where c.conrelid = 'public.tug_idempotency_keys'::regclass
  and c.conname = 'tug_idempotency_keys_operation_check';

select tg.tgname,
       tg.tgenabled,
       p.proname as trigger_function
from pg_trigger tg
join pg_proc p on p.oid = tg.tgfoid
where tg.tgrelid in ('public.stocks'::regclass, 'public.tug3_transactions'::regclass, 'public.katalog'::regclass)
  and not tg.tgisinternal
  and tg.tgname in (
    'katalog_fill_satuan',
    'trg_tug_mara_catalog_write_guard',
    'trg_tug_mara_stock_write_guard',
    'trg_tug3_guard_legacy_stock_write',
    'trg_tug3_guard_legacy_status_write'
  )
order by tg.tgname;

select p.oid::regprocedure as function_name,
       p.prosecdef as security_definer,
       p.proconfig as function_config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('tug_mara_resolve', 'tug3_source_part', 'katalog_fill_satuan_from_mara',
                    'approve_tug3_final', 'approve_tug10_final', 'mtu_khs_apply_tug3_receipt');

select nullif(ltrim(btrim(m.kode_material), '0'), '') as mara_key,
       count(*) as rows_for_key
from public.mara_catalog m
where nullif(ltrim(btrim(m.kode_material), '0'), '') is not null
group by nullif(ltrim(btrim(m.kode_material), '0'), '')
having count(*) > 1
order by mara_key;

-- Existing posted rows that cannot be resolved to exactly one MARA identity.
select s.id as stock_id,
       s.katalog_id,
       s.data->>'katalog' as posted_code,
       count(m.kode_material) as mara_matches
from public.stocks s
left join public.mara_catalog m
  on nullif(ltrim(btrim(m.kode_material), '0'), '') = nullif(ltrim(btrim(coalesce(s.data->>'katalog', '')), '0'), '')
where s.data->'sourceLot'->>'kind' in ('TUG3_CONTRACT', 'TUG10_RETURN')
   or s.data->>'source' = 'MTU_KHS_TUG3'
group by s.id, s.katalog_id, s.data->>'katalog'
having count(m.kode_material) <> 1
order by s.id;
