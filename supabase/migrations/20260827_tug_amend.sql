-- TL amend for canonical TUG-8/TUG-9 while still PENDING.  This file is
-- intentionally migration-only: review it and run it on self-host only after
-- an explicit production gate. It does not alter TUG-15 history/reporting.

alter table public.tug_approvals drop constraint if exists tug_approvals_event_type_check;
alter table public.tug_approvals add constraint tug_approvals_event_type_check
  check (event_type in ('CREATED','SUBMITTED','PREPARED','REVIEWED','APPROVED','REJECTED','DRAWN_ACK','AMENDED'));

alter table public.tug_idempotency_keys drop constraint if exists tug_idempotency_keys_operation_check;
alter table public.tug_idempotency_keys add constraint tug_idempotency_keys_operation_check
  check (operation in ('CREATE','SUBMIT','DECIDE','AMEND'));

-- Same shape as tug_create_transaction's item insert + tug_hash recompute,
-- but rewrites an existing PENDING row in place: doc_number/doc_sequence and
-- created_by never change, only document/items/version/hash.
create or replace function public.tug_amend(
  p_transaction_id uuid,
  p_expected_version integer,
  p_document jsonb,
  p_items jsonb,
  p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare a public.profiles := public.tug_actor(); t public.tug_transactions; v_hash text; v_response jsonb;
begin
  v_response := public.tug_idempotency_response(p_idempotency_key,'AMEND',a.id,public.tug_request_hash('AMEND',jsonb_build_object('transactionId',p_transaction_id,'document',p_document,'items',p_items)));
  if v_response is not null then return v_response; end if;
  select * into t from public.tug_transactions where id=p_transaction_id for update;
  if t.id is null or t.status <> 'PENDING' or t.version <> p_expected_version then
    raise exception 'TUG_VERSION_MISMATCH';
  end if;
  perform public.tug_assert_upt_scope(a, t.upt_id);
  if a.role not in ('TL','SUPERADMIN') then raise exception 'TUG_AMEND_FORBIDDEN' using errcode='42501'; end if;
  perform public.tug_assert_items(p_items, true);
  perform public.tug_assert_canonical_item_refs(p_items);
  delete from public.tug_items where transaction_id=t.id;
  insert into public.tug_items(transaction_id,line_no,stock_id,katalog_id,lokasi_id,qty,unit,snapshot)
  select t.id, ord::integer, st.id, st.katalog_id, st.lokasi_id, (x.value->>'qty')::numeric, x.value->>'unit',
    jsonb_set(
      jsonb_set(
        jsonb_set(x.value,'{stockId}',to_jsonb(st.id),true),
        '{katalogId}',coalesce(to_jsonb(st.katalog_id),'null'::jsonb),true),
      '{lokasiId}',coalesce(to_jsonb(st.lokasi_id),'null'::jsonb),true)
  from jsonb_array_elements(p_items) with ordinality as x(value,ord)
  join public.stocks st on st.id=nullif(btrim(x.value->>'stockId'),'');
  perform public.tug_assert_outgoing_stock_scope(t.id,t.upt_id);
  v_hash := public.tug_hash(p_document, p_items, t.doc_number, t.identity_snapshot);
  update public.tug_transactions set document=p_document, document_hash=v_hash, version=version+1, updated_at=now()
  where id=t.id returning * into t;
  insert into public.tug_approvals(transaction_id,event_type,stage,actor_id,actor_snapshot,document_hash,transaction_version,evidence)
  values(t.id,'AMENDED',t.stage,a.id,jsonb_build_object('name',a.name,'role',a.role,'upt_id',a.upt_id),v_hash,t.version,jsonb_build_object('internal_signature','approval evidence only; not PSrE certified'));
  v_response := jsonb_build_object('id',t.id,'version',t.version,'status',t.status,'stage',t.stage,'docNumber',t.doc_number);
  insert into public.tug_idempotency_keys(key,operation,actor_id,request_hash,response)
  values(p_idempotency_key,'AMEND',a.id,public.tug_request_hash('AMEND',jsonb_build_object('transactionId',p_transaction_id,'document',p_document,'items',p_items)),v_response);
  return v_response;
end $$;

grant execute on function public.tug_amend(uuid,integer,jsonb,jsonb,uuid) to authenticated;
