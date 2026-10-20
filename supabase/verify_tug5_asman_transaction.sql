-- Production-safe workflow smoke test. All TEST- rows are rolled back.
-- Run with psql -v ON_ERROR_STOP=1; never remove the final ROLLBACK.
begin;

do $$
declare
  actor_id uuid;
  actor_upt text;
  draft_actor_id uuid;
  draft_upt text;
  draft_id text;
  draft_result jsonb;
  parent_id text;
  child_id text;
  result jsonb;
  transfer_type text;
  expected_child_type text;
  expected_reference text;
  parent_row public.tug_workflow_transactions;
  child_row public.tug_workflow_transactions;
begin
  select p.id, p.upt_id into actor_id, actor_upt
    from public.profiles p
    join public.upt u on u.id = p.upt_id
    join public.uit i on i.id = u.uit_id
   where p.role = 'ASMAN'
   limit 1;
  if actor_id is null then raise exception 'No scoped ASMAN profile available for smoke test'; end if;

  select p.id, p.upt_id into draft_actor_id, draft_upt
    from public.profiles p
    join public.upt u on u.id = p.upt_id
   where p.role in ('ADMIN', 'TL')
   limit 1;
  if draft_actor_id is null then raise exception 'No scoped ADMIN/TL profile available for smoke test'; end if;
  perform set_config('request.jwt.claim.sub', draft_actor_id::text, true);
  draft_id := 'TEST-TUG5-DRAFT-' || gen_random_uuid()::text;
  draft_result := public.save_tug_workflow_transaction(
    draft_id, 'TUG5', draft_upt, null, null, 'DRAFT', 'DRAFT',
    null, null, '{"docType":"TUG5","stockItems":[{}]}'::jsonb, null);
  if draft_result->>'ok' <> 'true' or draft_result->>'version' <> '1' then
    raise exception 'Partial TUG-5 draft was not saved';
  end if;
  draft_result := public.save_tug_workflow_transaction(
    draft_id, 'TUG5', draft_upt, null, null, 'DRAFT', 'DRAFT',
    null, null, '{"docType":"TUG5","stockItems":[{"katalogSnapshot":{"katalog":"TEST","name":"Smoke","satuan":"BH"}}]}'::jsonb, 1);
  if draft_result->>'ok' <> 'true' or draft_result->>'version' <> '2' then
    raise exception 'TUG-5 draft update was not saved';
  end if;
  perform set_config('request.jwt.claim.sub', actor_id::text, true);

  foreach transfer_type in array array['INTRACOMPANY', 'INTERCOMPANY'] loop
    parent_id := 'TEST-TUG5-' || gen_random_uuid()::text;
    child_id := 'TEST-TUG5-CHILD-' || gen_random_uuid()::text;
    expected_child_type := case when transfer_type = 'INTRACOMPANY' then 'TUG7' else 'TUG5' end;
    expected_reference := case when transfer_type = 'INTRACOMPANY' then 'tug7Id' else 'draftTug5UITId' end;

    insert into public.tug_workflow_transactions
      (id, doc_type, upt_id, created_by, stage, status, data)
    values
      (parent_id, 'TUG5', actor_upt, actor_id, 'PENDING_ASMAN', 'PENDING',
       jsonb_build_object('jenisTransfer', transfer_type, 'stockItems',
         jsonb_build_array(jsonb_build_object('katalogId', 'TEST-MATERIAL', 'qty', 1, 'permintaan', 2))));

    result := public.approve_tug5_asman_with_child(
      parent_id, 1, child_id,
      jsonb_build_object('stockItems', jsonb_build_array(jsonb_build_object('qty', 999)),
        'docSubType', 'SPOOFED', 'uptId', 'SPOOFED'));
    if result->>'ok' <> 'true' or result->>'idempotent' <> 'false' then
      raise exception 'First approval failed for %', transfer_type;
    end if;

    select * into parent_row from public.tug_workflow_transactions where id = parent_id;
    select * into child_row from public.tug_workflow_transactions where id = child_id;
    if parent_row.stage <> 'APPROVED' or parent_row.status <> 'APPROVED'
       or parent_row.version <> 2 or parent_row.data->>expected_reference <> child_id
       or child_row.doc_type <> expected_child_type or child_row.uit_id is null
       or child_row.upt_id is not null or child_row.parent_workflow_id <> parent_id
       or child_row.data->'stockItems'->0->>'qty' <> (case when transfer_type = 'INTRACOMPANY' then '2' else '1' end)
       or child_row.data->>'uptId' = 'SPOOFED' then
      raise exception 'Parent/child invariant failed for %', transfer_type;
    end if;
    if transfer_type = 'INTERCOMPANY' and child_row.data->>'docSubType' <> 'UIT_INTERCOMPANY' then
      raise exception 'Intercompany subtype was not set by server';
    end if;

    result := public.approve_tug5_asman_with_child(parent_id, 1, child_id, '{}'::jsonb);
    if result->>'idempotent' <> 'true' then raise exception 'Retry is not idempotent for %', transfer_type; end if;
  end loop;

  parent_id := 'TEST-TUG5-GUARD-' || gen_random_uuid()::text;
  insert into public.tug_workflow_transactions
    (id, doc_type, upt_id, created_by, stage, status, data)
  values (parent_id, 'TUG5', actor_upt, actor_id, 'PENDING_ASMAN', 'PENDING', '{}'::jsonb);
  begin
    update public.tug_workflow_transactions set stage = 'PENDING_MANAGER' where id = parent_id;
    raise exception 'Stage guard allowed PENDING_MANAGER';
  exception when others then
    if sqlerrm <> 'TUG_WORKFLOW_ASMAN_FINAL_ONLY' then raise; end if;
  end;

  raise notice 'PASS: partial draft save/update, both transfer routes, idempotency, spoof protection, and stage guard';
end
$$;

rollback;

select 'smoke_rows_persisted=' || count(*)
  from public.tug_workflow_transactions
 where id like 'TEST-TUG5-%';

select 'mara_authenticated_select=' || has_table_privilege('authenticated', 'public.mara_catalog', 'select')
  || ',mara_rows=' || (select count(*) from public.mara_catalog);

begin read only;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select id::text from public.profiles where role = 'ADMIN' limit 1), true);
set local role authenticated;
select 'mara_visible_to_authenticated=' || count(*) from public.mara_catalog;
rollback;
