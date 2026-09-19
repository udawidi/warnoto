\pset pager off
\pset format aligned
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"9e304a97-18bd-46c7-9439-34be574f02cc","role":"authenticated"}', true);
select 'UIT-JBM' as actor,
       (select count(*) from public.maturity_audits where upt_id='UPT-SBY') as sby_audits,
       (select count(*) from public.maturity_audits where upt_id='UPT-MLG') as mlg_audits,
       (select count(*) from public.maturity_5s_assessments where upt_id='UPT-SBY') as sby_5s,
       (select count(*) from public.maturity_5s_assessments where upt_id='UPT-MLG') as mlg_5s,
       (select count(*) from public.maturity_assessments where upt_id is null) as orphan_assessments;
select public.can_access_maturity_upt((select unit.id from public.upt unit where unit.uit_id is distinct from (select uit_id from public.profiles where id = auth.uid()) limit 1)) as cross_uit_access_allowed;
rollback;
select id, upt_id, data->'_migration' as migration_scope from public.maturity_assessments where upt_id is null;
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"8ed47f50-ae79-4237-98e7-09cf93f7a19b","role":"authenticated"}', true);
select 'HAR_UIT' as actor, public.can_access_maturity_upt('UPT-SBY') as own_upt_access, (select count(*) from public.maturity_audits) as visible_audits;
rollback;
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d7104036-60a5-4526-aae9-12491fdd5f97","role":"authenticated"}', true);
select 'UPT-SBY' as actor,
       (select count(*) from public.maturity_audits where upt_id='UPT-SBY') as sby_audits,
       (select count(*) from public.maturity_audits where upt_id='UPT-MLG') as mlg_audits,
       (select count(*) from public.maturity_5s_assessments where upt_id='UPT-SBY') as sby_5s,
       (select count(*) from public.maturity_5s_assessments where upt_id='UPT-MLG') as mlg_5s,
       (select count(*) from public.maturity_assessments where upt_id is null) as orphan_assessments;
rollback;
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3437604b-8a4d-45e9-9966-d741428460aa","role":"authenticated"}', true);
select 'PUSAT' as actor,
       (select count(*) from public.maturity_audits where upt_id='UPT-SBY') as sby_audits,
       (select count(*) from public.maturity_audits where upt_id='UPT-MLG') as mlg_audits,
       (select count(*) from public.maturity_5s_assessments where upt_id='UPT-SBY') as sby_5s,
       (select count(*) from public.maturity_5s_assessments where upt_id='UPT-MLG') as mlg_5s,
       (select count(*) from public.maturity_assessments where upt_id is null) as orphan_assessments;
rollback;
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3437604b-8a4d-45e9-9966-d741428460aa","role":"authenticated"}', true);
do $$
begin
  begin
    insert into public.maturity_aspect_reviews(audit_id, upt_id, aspect_id, item_id, state, reviewed_at)
    select a.id, case when a.upt_id = 'UPT-SBY' then 'UPT-MLG' else 'UPT-SBY' end, 'E2E-MISMATCH', 'E2E-MISMATCH', 'REJECTED', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
    from public.maturity_audits a where a.upt_id is not null limit 1;
    raise exception 'E2E expected review mismatch rejection did not happen';
  exception when others then
    if position('MATURITY_REVIEW_UPT_MISMATCH' in sqlerrm) = 0 then raise; end if;
    raise notice 'review_mismatch_rejected=true';
  end;
end $$;
rollback;
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3437604b-8a4d-45e9-9966-d741428460aa","role":"authenticated"}', true);
do $$
declare h_id text;
begin
  select id into h_id from public.maturity_audit_history where upt_id is not null limit 1;
  begin
    execute format('update public.maturity_audit_history set score = score where id = %L', h_id);
    raise exception 'E2E expected history non-target update rejection did not happen';
  exception when insufficient_privilege then
    raise notice 'history_non_target_update_rejected=true';
  end;
end $$;
rollback;
