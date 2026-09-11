-- Informational, server-derived source history for canonical TUG-8/TUG-9 items.
-- Review and apply on self-host only after the production gate. This migration
-- never changes signed snapshots, hashes, approvals, quantities, or movements.

alter table public.tug_items
  add column if not exists source_snapshot jsonb not null default '{}'::jsonb;

create or replace function public.tug_source_epoch_ms(p_value text)
returns bigint
language plpgsql immutable
set search_path = public
as $$
begin
  if nullif(btrim(p_value), '') is null then return null; end if;
  if p_value ~ '^\d{10,13}$' then
    if p_value::numeric < 1000000000000 then return (p_value::numeric * 1000)::bigint; end if;
    return p_value::bigint;
  end if;
  begin
    return (extract(epoch from p_value::timestamptz) * 1000)::bigint;
  exception when others then
    return null;
  end;
end $$;

create or replace function public.tug_catalog_code_key(p_value text)
returns text
language plpgsql immutable
set search_path = public
as $$
declare v_digits text := regexp_replace(coalesce(p_value,''), '[^0-9]', '', 'g');
begin
  if v_digits = '' then return lower(btrim(coalesce(p_value,''))); end if;
  if length(v_digits) = 10 and left(v_digits,3) = '100' then v_digits := substr(v_digits,4); end if;
  return coalesce(nullif(ltrim(v_digits,'0'),''),'0');
end $$;

-- Internal helper. It is deliberately not executable by client roles.
create or replace function public.tug_source_snapshot_for_stock(
  p_stock_id text,
  p_at timestamptz default now(),
  p_provenance text default 'CREATE'
) returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_data jsonb;
  v_contracts jsonb := '[]'::jsonb;
  v_kind text;
begin
  select coalesce(s.data, '{}'::jsonb) into v_data
  from public.stocks s
  where s.id = p_stock_id;

  if v_data is null then
    return jsonb_build_object('sourceKind','INITIAL_STOCK','contracts','[]'::jsonb,'provenance',p_provenance);
  end if;

  select coalesce(jsonb_agg(q.ref order by q.entry_ms desc nulls last, q.doc_no), '[]'::jsonb)
    into v_contracts
  from (
    select distinct on (coalesce(r.value->>'docNo',''), coalesce(r.value->>'noKontrak',''))
      r.value as ref,
      public.tug_source_epoch_ms(r.value->>'tglMasuk') as entry_ms,
      coalesce(r.value->>'docNo','') as doc_no
    from jsonb_array_elements(
      case when jsonb_typeof(v_data->'kontrakRefs') = 'array'
        then v_data->'kontrakRefs' else '[]'::jsonb end
    ) r(value)
    where nullif(btrim(r.value->>'docNo'),'') is not null
      and nullif(btrim(r.value->>'noKontrak'),'') is not null
      and public.tug_source_epoch_ms(r.value->>'tglMasuk') is not null
      and to_timestamp(public.tug_source_epoch_ms(r.value->>'tglMasuk') / 1000.0) <= p_at
    order by coalesce(r.value->>'docNo',''), coalesce(r.value->>'noKontrak',''),
      public.tug_source_epoch_ms(r.value->>'tglMasuk') desc nulls last
  ) q;

  if jsonb_array_length(v_contracts) > 0 then
    v_kind := 'TUG3_CONTRACT';
  elsif v_data ? '_tug10Applied' or v_data ? 'sourceTxnId'
     or coalesce(v_data->>'source','') in ('TUG10','TUG10_RETURN','item','dupKatalog') then
    v_kind := 'TUG10_RETURN';
  elsif v_data ? 'sapBaselineQty' or v_data ? 'sapBaselineAt'
     or left(coalesce(p_stock_id,''), 8) = 'STK-SAP-'
     or left(coalesce(p_stock_id,''), 8) = 'STK-MIG-'
     or coalesce(v_data->>'source','') in ('SAP','SAP_MIGRATION') then
    v_kind := 'SAP_MIGRATION';
  else
    v_kind := 'INITIAL_STOCK';
  end if;

  return jsonb_build_object('sourceKind',v_kind,'contracts',v_contracts,'provenance',p_provenance);
end $$;

revoke all on function public.tug_source_epoch_ms(text) from public, anon, authenticated;
revoke all on function public.tug_catalog_code_key(text) from public, anon, authenticated;
revoke all on function public.tug_source_snapshot_for_stock(text,timestamptz,text) from public, anon, authenticated;

-- Recover contract references that were written to TUG-3 but not to the stock
-- row. The update is append-only and deduped by (docNo,noKontrak).
do $$
declare
  r record;
  v_refs jsonb;
begin
  for r in
    select st.id as stock_id,
      jsonb_build_object(
        'docNo', coalesce(t.doc_number, t.data->'docNumbers'->>'tug3', t.id),
        'supplier', coalesce(t.data->>'dariSupplier',''),
        'noKontrak', coalesce(t.data->>'judulKontrak',''),
        'tglMasuk', coalesce(nullif(t.data->>'approvedAtAsman',''), nullif(i.value->>'tglMasuk',''), nullif(t.data->>'tanggalDiterima',''),
          to_char(to_timestamp(t.created_at / 1000.0), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
        'suratPesananNo', coalesce(t.data->>'suratPesananNo',''),
        'suratPesananTgl', coalesce(t.data->>'suratPesananTgl',''),
        'amandemenNo', coalesce(t.data->>'amandemenNo','')
      ) as contract_ref
    from public.tug3_transactions t
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(t.data->'stockItems') = 'array'
        then t.data->'stockItems' else '[]'::jsonb end
    ) i(value)
    left join public.katalog item_k
      on nullif(i.value->>'katalogBaru','') is not null
     and public.tug_catalog_code_key(item_k.data->>'katalog') = public.tug_catalog_code_key(i.value->>'katalogBaru')
    join public.stocks st
      on st.katalog_id = coalesce(nullif(coalesce(i.value->>'katalogId',i.value->>'katalog_id'),''), item_k.id)
     and st.lokasi_id = nullif(coalesce(i.value->>'lokasiTujuanId',i.value->>'lokasi_id',t.data->>'lokasiTujuanId'),'')
    join public.lokasi st_loc on st_loc.id = st.lokasi_id
    join public.gudang st_gudang on st_gudang.id = st_loc.gudang_id and st_gudang.upt_id = t.upt_id
    where upper(coalesce(t.status,'')) = 'APPROVED'
      and nullif(btrim(coalesce(t.doc_number, t.data->'docNumbers'->>'tug3', t.id)),'') is not null
      and nullif(btrim(t.data->>'judulKontrak'),'') is not null
  loop
    select case when jsonb_typeof(s.data->'kontrakRefs') = 'array'
      then s.data->'kontrakRefs' else '[]'::jsonb end
      into v_refs from public.stocks s where s.id = r.stock_id;
    if not exists (
      select 1 from jsonb_array_elements(v_refs) old_ref
      where coalesce(old_ref->>'docNo','') = coalesce(r.contract_ref->>'docNo','')
        and coalesce(old_ref->>'noKontrak','') = coalesce(r.contract_ref->>'noKontrak','')
    ) then
      update public.stocks
      set data = jsonb_set(coalesce(data,'{}'::jsonb), '{kontrakRefs}', v_refs || jsonb_build_array(r.contract_ref), true)
      where id = r.stock_id;
    end if;
  end loop;
end $$;

-- Keep the public RPC signatures unchanged. Source metadata is ignored from
-- p_items and generated from the locked server stock row in the same transaction.
create or replace function public.tug_create_transaction(
  p_document jsonb,
  p_items jsonb,
  p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare a public.profiles := public.tug_actor(); v_doc_type text := upper(coalesce(p_document->>'docType', ''));
  v_upt_id text := coalesce(nullif(p_document->>'uptId',''), nullif(p_document->>'upt_id',''), a.upt_id);
  v_seq bigint; v_id uuid; v_hash text; v_doc_number text; v_identity jsonb; v_unit_code text;
  v_response jsonb;
begin
  v_response := public.tug_idempotency_response(p_idempotency_key,'CREATE',a.id,public.tug_request_hash('CREATE',jsonb_build_object('document',p_document,'items',p_items)));
  if v_response is not null then return v_response; end if;
  if v_doc_type not in ('TUG8','TUG9') then raise exception 'TUG_CANONICAL_DOC_TYPE_FORBIDDEN'; end if;
  if v_upt_id is null then raise exception 'TUG_UPT_REQUIRED'; end if;
  perform public.tug_assert_upt_scope(a, v_upt_id);
  if a.role not in ('ADMIN','TL','ADMIN_UIT','ADMIN_ULTG','SUPERADMIN') then raise exception 'TUG_CREATE_FORBIDDEN' using errcode='42501'; end if;
  perform public.tug_assert_items(p_items, true);
  perform public.tug_assert_canonical_item_refs(p_items);
  update public.tug_global_document_counters set last_value=last_value+1,updated_at=now() where upt_id=v_upt_id returning last_value,document_unit_code into v_seq,v_unit_code;
  if v_seq is null or v_unit_code is null then raise exception 'TUG_DOCUMENT_UNIT_CONFIG_REQUIRED'; end if;
  v_doc_number := public.tug_doc_number(v_seq,v_doc_type,v_unit_code);
  select coalesce(jsonb_build_object('tl_name',p.name,'tl_phone',p.official_phone,'tl_id',p.id),'{}'::jsonb) into v_identity
  from public.profiles p where p.role='TL' and p.upt_id=v_upt_id order by p.created_at limit 1;
  v_identity := coalesce(v_identity,'{}'::jsonb);
  v_hash := public.tug_hash(p_document, p_items, v_doc_number, v_identity);
  insert into public.tug_transactions(doc_type,doc_number,doc_sequence,upt_id,stage,document,document_hash,identity_snapshot,created_by)
  values(v_doc_type, v_doc_number, v_seq, v_upt_id, 'DRAFT', p_document, v_hash, v_identity, a.id)
  returning id into v_id;
  insert into public.tug_items(transaction_id,line_no,stock_id,katalog_id,lokasi_id,qty,unit,snapshot,source_snapshot)
  select v_id, ord::integer, st.id, st.katalog_id, st.lokasi_id, (x.value->>'qty')::numeric, x.value->>'unit',
    jsonb_set(jsonb_set(jsonb_set(x.value,'{stockId}',to_jsonb(st.id),true),'{katalogId}',coalesce(to_jsonb(st.katalog_id),'null'::jsonb),true),'{lokasiId}',coalesce(to_jsonb(st.lokasi_id),'null'::jsonb),true),
    public.tug_source_snapshot_for_stock(st.id, now(), 'CREATE')
  from jsonb_array_elements(p_items) with ordinality as x(value,ord)
  join public.stocks st on st.id=nullif(btrim(x.value->>'stockId'),'');
  if v_doc_type in ('TUG8','TUG9') then perform public.tug_assert_outgoing_stock_scope(v_id,v_upt_id); end if;
  insert into public.tug_approvals(transaction_id,event_type,actor_id,actor_snapshot,document_hash,transaction_version,evidence)
  values(v_id,'CREATED',a.id,jsonb_build_object('name',a.name,'role',a.role,'upt_id',a.upt_id),v_hash,1,jsonb_build_object('internal_signature','approval evidence only; not PSrE certified'));
  v_response := jsonb_build_object('id',v_id,'docNumber',v_doc_number,'docSequence',v_seq,'status','DRAFT','version',1,'identitySnapshot',v_identity);
  insert into public.tug_idempotency_keys(key,operation,actor_id,request_hash,response)
  values(p_idempotency_key,'CREATE',a.id,public.tug_request_hash('CREATE',jsonb_build_object('document',p_document,'items',p_items)),v_response);
  return v_response;
end $$;

create or replace function public.tug_amend(
  p_transaction_id uuid, p_expected_version integer, p_document jsonb, p_items jsonb, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare a public.profiles := public.tug_actor(); t public.tug_transactions; v_hash text; v_response jsonb;
begin
  v_response := public.tug_idempotency_response(p_idempotency_key,'AMEND',a.id,public.tug_request_hash('AMEND',jsonb_build_object('transactionId',p_transaction_id,'document',p_document,'items',p_items)));
  if v_response is not null then return v_response; end if;
  select * into t from public.tug_transactions where id=p_transaction_id for update;
  if t.id is null or t.status <> 'PENDING' or t.version <> p_expected_version then raise exception 'TUG_VERSION_MISMATCH'; end if;
  perform public.tug_assert_upt_scope(a, t.upt_id);
  if a.role not in ('TL','SUPERADMIN') then raise exception 'TUG_AMEND_FORBIDDEN' using errcode='42501'; end if;
  perform public.tug_assert_items(p_items, true);
  perform public.tug_assert_canonical_item_refs(p_items);
  delete from public.tug_items where transaction_id=t.id;
  insert into public.tug_items(transaction_id,line_no,stock_id,katalog_id,lokasi_id,qty,unit,snapshot,source_snapshot)
  select t.id, ord::integer, st.id, st.katalog_id, st.lokasi_id, (x.value->>'qty')::numeric, x.value->>'unit',
    jsonb_set(jsonb_set(jsonb_set(x.value,'{stockId}',to_jsonb(st.id),true),'{katalogId}',coalesce(to_jsonb(st.katalog_id),'null'::jsonb),true),'{lokasiId}',coalesce(to_jsonb(st.lokasi_id),'null'::jsonb),true),
    public.tug_source_snapshot_for_stock(st.id, now(), 'AMEND')
  from jsonb_array_elements(p_items) with ordinality as x(value,ord)
  join public.stocks st on st.id=nullif(btrim(x.value->>'stockId'),'');
  perform public.tug_assert_outgoing_stock_scope(t.id,t.upt_id);
  v_hash := public.tug_hash(p_document, p_items, t.doc_number, t.identity_snapshot);
  update public.tug_transactions set document=p_document, document_hash=v_hash, version=version+1, updated_at=now() where id=t.id returning * into t;
  insert into public.tug_approvals(transaction_id,event_type,stage,actor_id,actor_snapshot,document_hash,transaction_version,evidence)
  values(t.id,'AMENDED',t.stage,a.id,jsonb_build_object('name',a.name,'role',a.role,'upt_id',a.upt_id),v_hash,t.version,jsonb_build_object('internal_signature','approval evidence only; not PSrE certified'));
  v_response := jsonb_build_object('id',t.id,'version',t.version,'status',t.status,'stage',t.stage,'docNumber',t.doc_number);
  insert into public.tug_idempotency_keys(key,operation,actor_id,request_hash,response)
  values(p_idempotency_key,'AMEND',a.id,public.tug_request_hash('AMEND',jsonb_build_object('transactionId',p_transaction_id,'document',p_document,'items',p_items)),v_response);
  return v_response;
end $$;

-- Existing canonical items get one immutable snapshot. Empty snapshots only are
-- updated, so retries cannot overwrite a reviewed historical result.
update public.tug_items i
set source_snapshot = public.tug_source_snapshot_for_stock(i.stock_id, t.created_at, 'HISTORICAL_BACKFILL')
from public.tug_transactions t
where t.id=i.transaction_id
  and t.doc_type in ('TUG8','TUG9')
  and (i.source_snapshot is null or i.source_snapshot = '{}'::jsonb);

revoke all on function public.tug_create_transaction(jsonb,jsonb,uuid) from public, anon;
revoke all on function public.tug_amend(uuid,integer,jsonb,jsonb,uuid) from public, anon;
grant execute on function public.tug_create_transaction(jsonb,jsonb,uuid) to authenticated;
grant execute on function public.tug_amend(uuid,integer,jsonb,jsonb,uuid) to authenticated;
