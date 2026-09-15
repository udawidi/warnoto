-- PROPOSAL ONLY: source lots for TUG-8/TUG-9.
-- Do not apply to production without an explicit operator gate.
-- Uses existing public.stocks rows; no table or dependency is added.

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
  v_lot jsonb;
  v_contracts jsonb := '[]'::jsonb;
  v_kind text;
begin
  select coalesce(s.data, '{}'::jsonb) into v_data from public.stocks s where s.id=p_stock_id;
  if v_data is null then
    return jsonb_build_object('lotKey',null,'sourceKind','INITIAL_STOCK','contracts','[]'::jsonb,'provenance',p_provenance);
  end if;
  v_lot := case when jsonb_typeof(v_data->'sourceLot')='object' then v_data->'sourceLot' else null end;
  if v_lot is not null and nullif(btrim(v_lot->>'key'),'') is not null then
    v_kind := coalesce(nullif(v_lot->>'kind',''),'INITIAL_STOCK');
    if jsonb_typeof(v_data->'kontrakRefs')='array' then v_contracts := v_data->'kontrakRefs'; end if;
    return jsonb_build_object('lotKey',v_lot->>'key','sourceKind',v_kind,'contracts',v_contracts,'sourceDocumentNo',v_lot->>'sourceDocumentNo','provenance',p_provenance);
  end if;
  select coalesce(jsonb_agg(r.value order by public.tug_source_epoch_ms(r.value->>'tglMasuk') desc nulls last), '[]'::jsonb) into v_contracts
  from jsonb_array_elements(case when jsonb_typeof(v_data->'kontrakRefs')='array' then v_data->'kontrakRefs' else '[]'::jsonb end) r(value)
  where public.tug_source_epoch_ms(r.value->>'tglMasuk') is not null and to_timestamp(public.tug_source_epoch_ms(r.value->>'tglMasuk') / 1000.0) <= p_at;
  if jsonb_array_length(v_contracts)>0 then v_kind:='TUG3_CONTRACT';
  elsif v_data ? '_tug10Applied' or coalesce(v_data->>'source','') in ('TUG10','TUG10_RETURN','item','dupKatalog') then v_kind:='TUG10_RETURN';
  elsif v_data ? 'sapBaselineQty' or left(p_stock_id,8) in ('STK-SAP-','STK-MIG-') then v_kind:='SAP_MIGRATION';
  else v_kind:='INITIAL_STOCK'; end if;
  return jsonb_build_object('lotKey',null,'sourceKind',v_kind,'contracts',v_contracts,'provenance',p_provenance);
end $$;

-- Shared server guard. Canonical create/amend integrations should call this
-- before accepting an outgoing stock reference.
create or replace function public.tug_assert_source_lot_available(p_stock_id text)
returns void language plpgsql stable security definer set search_path=public as $$
declare d jsonb;
begin
  select coalesce(data,'{}'::jsonb) into d from public.stocks where id=p_stock_id;
  if d is null then raise exception 'TUG_STOCK_NOT_FOUND'; end if;
  if coalesce(d->'sourceLot'->>'status','')='NEEDS_SOURCE_ALLOCATION'
     or (jsonb_typeof(d->'kontrakRefs')='array' and jsonb_array_length(d->'kontrakRefs')>1 and d->'sourceLot' is null) then
    raise exception 'TUG_SOURCE_ALLOCATION_REQUIRED';
  end if;
end $$;

revoke all on function public.tug_source_snapshot_for_stock(text,timestamptz,text) from public, anon, authenticated;
revoke all on function public.tug_assert_source_lot_available(text) from public, anon, authenticated;

create or replace function public.tug_items_source_lot_guard()
returns trigger language plpgsql security definer set search_path=public as $$
declare typ text;
begin
  select doc_type into typ from public.tug_transactions where id=new.transaction_id;
  if typ in ('TUG8','TUG9') then perform public.tug_assert_source_lot_available(new.stock_id); end if;
  return new;
end $$;
drop trigger if exists tug_items_source_lot_guard on public.tug_items;
create trigger tug_items_source_lot_guard before insert or update of stock_id on public.tug_items
for each row execute function public.tug_items_source_lot_guard();
revoke all on function public.tug_items_source_lot_guard() from public, anon, authenticated;

-- Atomically split a legacy aggregate row. Result IDs are deterministic, so a
-- retry with the same idempotency key returns the original lot IDs.
create or replace function public.tug_split_stock_source_lots(
  p_stock_id text, p_expected_qty numeric, p_allocations jsonb, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  a public.profiles := public.tug_actor();
  s public.stocks;
  d jsonb;
  marker jsonb;
  x jsonb;
  total numeric := 0;
  lot_id text;
  ids jsonb := '[]'::jsonb;
  idx integer := 0;
  v_upt_id text;
  lot_data jsonb;
  one_contracts jsonb;
  contract_count integer := 0;
  return_count integer := 0;
begin
  if a.role not in ('TL','SUPERADMIN') then raise exception 'TUG_SOURCE_SPLIT_FORBIDDEN' using errcode='42501'; end if;
  if nullif(btrim(p_idempotency_key),'') is null then raise exception 'TUG_IDEMPOTENCY_REQUIRED'; end if;
  select * into s from public.stocks where id=p_stock_id for update;
  if s.id is null then raise exception 'TUG_STOCK_NOT_FOUND'; end if;
  select g.upt_id into v_upt_id from public.lokasi l join public.gudang g on g.id=l.gudang_id where l.id=s.lokasi_id;
  if a.role='TL' and (v_upt_id is null or not public.can_access_upt(v_upt_id)) then raise exception 'TUG_SOURCE_SPLIT_SCOPE_FORBIDDEN' using errcode='42501'; end if;
  d := coalesce(s.data,'{}'::jsonb);
  marker := d->'sourceLotSplit';
  if marker->>'idempotencyKey'=p_idempotency_key then return marker; end if;
  select count(distinct coalesce(value->>'supplier','') || '|' || coalesce(value->>'docNo','') || '|' || coalesce(value->>'noKontrak','')) into contract_count
    from jsonb_array_elements(case when jsonb_typeof(d->'kontrakRefs')='array' then d->'kontrakRefs' else '[]'::jsonb end);
  return_count := case when jsonb_typeof(d->'_tug10Applied')='object' then jsonb_object_length(d->'_tug10Applied') else 0 end;
  if coalesce(d->'sourceLot'->>'status','') <> 'NEEDS_SOURCE_ALLOCATION'
     and not (contract_count > 1 or return_count > 1 or (contract_count > 0 and return_count > 0)
       or (return_count > 0 and coalesce(d->>'source','') not in ('TUG10','TUG10_RETURN','item','dupKatalog'))) then
    raise exception 'TUG_SOURCE_SPLIT_NOT_REQUIRED';
  end if;
  if coalesce(s.lokasi_id,'')='' then raise exception 'TUG_LOCATION_REQUIRED'; end if;
  if p_expected_qty is null or p_expected_qty <= 0 or coalesce(s.data->>'qty','0')::numeric <> p_expected_qty then raise exception 'TUG_SOURCE_SPLIT_STALE'; end if;
  if jsonb_typeof(p_allocations)<>'array' or jsonb_array_length(p_allocations)=0 then raise exception 'TUG_SOURCE_SPLIT_ALLOCATIONS_REQUIRED'; end if;
  for x in select value from jsonb_array_elements(p_allocations) loop
    if nullif(btrim(x->>'key'),'') is null or coalesce((x->>'qty')::numeric,0)<=0 then raise exception 'TUG_SOURCE_SPLIT_INVALID_ALLOCATION'; end if;
    if coalesce(x->>'kind','') not in ('TUG3_CONTRACT','TUG10_RETURN','SAP_MIGRATION','INITIAL_STOCK') then raise exception 'TUG_SOURCE_SPLIT_INVALID_KIND'; end if;
    if jsonb_typeof(x->'contracts')='array' and jsonb_array_length(x->'contracts')>1 then raise exception 'TUG_SOURCE_SPLIT_MULTI_SOURCE_LOT'; end if;
    total := total + (x->>'qty')::numeric;
  end loop;
  if total <> p_expected_qty then raise exception 'TUG_SOURCE_SPLIT_TOTAL_MISMATCH'; end if;
  if exists (select 1 from (select value->>'key' k, count(*) n from jsonb_array_elements(p_allocations) group by value->>'key' having count(*)>1) q) then raise exception 'TUG_SOURCE_SPLIT_DUPLICATE_KEY'; end if;
  for x in select value from jsonb_array_elements(p_allocations) loop
    idx := idx + 1;
    lot_id := p_stock_id || ':LOT:' || md5(x->>'key');
    one_contracts := case
      when jsonb_typeof(x->'contracts')='array' and jsonb_array_length(x->'contracts')>0 then x->'contracts'
      when coalesce(x->>'supplier','')<>'' or coalesce(x->>'contractNo','')<>'' or coalesce(x->>'sourceDocumentNo','')<>''
        then jsonb_build_array(jsonb_build_object('docNo',coalesce(x->>'sourceDocumentNo',''), 'supplier',coalesce(x->>'supplier',''), 'noKontrak',coalesce(x->>'contractNo',''), 'tglMasuk',coalesce(x->>'sourceDate','')))
      else '[]'::jsonb end;
    lot_data := jsonb_set(jsonb_set(d - 'kontrakRefs','{qty}',to_jsonb((x->>'qty')::numeric),true),'{kontrakRefs}',one_contracts,true);
    lot_data := jsonb_set(lot_data,'{sourceLot}',(x - 'qty' - 'contracts'),true);
    insert into public.stocks(id,katalog_id,lokasi_id,data,created_at)
    values(lot_id,s.katalog_id,s.lokasi_id,lot_data,s.created_at)
    on conflict (id) do update set data=excluded.data;
    ids := ids || jsonb_build_array(lot_id);
  end loop;
  marker := jsonb_build_object('idempotencyKey',p_idempotency_key,'sourceStockId',p_stock_id,'lotIds',ids,'totalQty',p_expected_qty);
  update public.stocks set data=jsonb_set(jsonb_set(d,'{qty}',to_jsonb(0::numeric),true),'{sourceLotSplit}',marker,true) where id=p_stock_id;
  return marker;
end $$;

revoke all on function public.tug_split_stock_source_lots(text,numeric,jsonb,text) from public, anon;
grant execute on function public.tug_split_stock_source_lots(text,numeric,jsonb,text) to authenticated;
