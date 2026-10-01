-- TUG-10 target stock delta. Apply after 20261001_tug10_atomic_final_approval.sql.
-- The existing migration is kept immutable; this replacement makes explicit
-- MERGE/SEPARATE handling deterministic and fail-closed on ambiguity.
begin;
create or replace function public.approve_tug10_final(
  p_tug10_id text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor public.profiles;
  v_txn public.tug10_transactions;
  v_item jsonb;
  v_data jsonb;
  v_items jsonb;
  v_hash text;
  v_response jsonb;
  v_existing_idempotency public.tug_idempotency_keys;
  v_now bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_idx integer;
  v_qty numeric;
  v_already numeric;
  v_apply numeric;
  v_old_qty numeric;
  v_code text;
  v_catalog_key text;
  v_katalog_id text;
  v_katalog_data jsonb;
  v_stock public.stocks;
  v_stock_id text;
  v_stock_data jsonb;
  v_source_key text;
  v_source_lot jsonb;
  v_effect_key text;
  v_item_mode text;
  v_location_upt text;
  v_attb public.attb_list;
  v_attb_data jsonb;
  v_attb_id text;
  v_stocks jsonb := '[]'::jsonb;
  v_katalogs jsonb := '[]'::jsonb;
  v_attb_rows jsonb := '[]'::jsonb;
  v_target_stock_id text;
  v_candidate_count integer;
  v_return_effects jsonb;
  v_handling text;
begin
  if auth.uid() is null then
    raise exception 'TUG_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_tug10_id is null or btrim(p_tug10_id) = '' or p_idempotency_key is null then
    raise exception 'TUG10_INPUT_INVALID' using errcode = '23514';
  end if;

  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null then
    raise exception 'TUG_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if v_actor.role not in ('ASMAN','SUPERADMIN') then
    raise exception 'TUG10_APPROVAL_ROLE_DENIED' using errcode = '42501';
  end if;

  v_hash := md5('TUG10_FINAL_APPROVE|' || p_tug10_id);
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select * into v_existing_idempotency
  from public.tug_idempotency_keys
  where key = p_idempotency_key;
  if v_existing_idempotency.key is not null then
    if v_existing_idempotency.operation <> 'TUG10_FINAL_APPROVE'
       or v_existing_idempotency.actor_id <> v_actor.id
       or v_existing_idempotency.request_hash is distinct from v_hash then
      raise exception 'TUG_IDEMPOTENCY_REUSE_FORBIDDEN' using errcode = '42501';
    end if;
    return v_existing_idempotency.response || jsonb_build_object('idempotent', true);
  end if;

  select * into v_txn
  from public.tug10_transactions
  where id = p_tug10_id
  for update;
  if v_txn.id is null then
    raise exception 'TUG10_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.can_access_upt(v_txn.upt_id) then
    raise exception 'TUG10_SCOPE_DENIED' using errcode = '42501';
  end if;
  if v_txn.status = 'APPROVED' and v_txn.stage = 'APPROVED' then
    raise exception 'TUG10_ALREADY_APPROVED' using errcode = 'P0001';
  end if;
  if v_txn.status <> 'PENDING' or v_txn.stage <> 'PENDING_ASMAN' then
    raise exception 'TUG10_STAGE_INVALID' using errcode = 'P0001';
  end if;

  v_data := coalesce(v_txn.data, '{}'::jsonb);
  v_items := v_data->'stockItems';
  if coalesce(jsonb_typeof(v_items), '') <> 'array' or coalesce(jsonb_array_length(v_items), 0) = 0 then
    raise exception 'TUG10_ITEMS_REQUIRED' using errcode = '23514';
  end if;
  if v_txn.upt_id is null or btrim(v_txn.upt_id) = '' then
    raise exception 'TUG10_UPT_REQUIRED' using errcode = '23514';
  end if;
  select g.upt_id into v_location_upt
  from public.lokasi l
  join public.gudang g on g.id = l.gudang_id
  where l.id = nullif(btrim(v_data->>'lokasiTujuanId'), '');
  if v_location_upt is null then
    raise exception 'TUG10_LOCATION_NOT_FOUND' using errcode = '23514';
  end if;
  if v_location_upt <> v_txn.upt_id then
    raise exception 'TUG10_LOCATION_SCOPE_DENIED' using errcode = '42501';
  end if;

  perform set_config('app.tug10_final_rpc', 'on', true);

  for v_item, v_idx in
    select value, ordinality::integer - 1
    from jsonb_array_elements(v_items) with ordinality
  loop
    v_qty := nullif(btrim(v_item->>'qty'), '')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'TUG10_QTY_INVALID' using errcode = '23514';
    end if;
    if coalesce(v_item->>'statusMaterial', '') not in ('Material Sisa Baru','Bongkaran','Bongkaran ATTB (MTU)') then
      raise exception 'TUG10_MATERIAL_STATUS_INVALID' using errcode = '23514';
    end if;
    if nullif(btrim(v_item->>'fotoBarangRetur'), '') is null
       or left(btrim(v_item->>'fotoBarangRetur'), 5) = 'data:' then
      raise exception 'TUG10_RECEIPT_PHOTO_INVALID' using errcode = '23514';
    end if;
    if v_item->>'statusMaterial' = 'Bongkaran ATTB (MTU)'
       and (nullif(btrim(v_item->>'fotoNameplate'), '') is null
         or left(btrim(v_item->>'fotoNameplate'), 5) = 'data:') then
      raise exception 'TUG10_NAMEPLATE_REQUIRED' using errcode = '23514';
    end if;

    v_item_mode := coalesce(v_item->>'katalogMode', 'existing');
    if v_item_mode = 'existing' then
      v_katalog_id := nullif(btrim(v_item->>'katalogId'), '');
      if v_katalog_id is null then
        raise exception 'TUG10_CATALOG_REQUIRED' using errcode = '23514';
      end if;
      select data into v_katalog_data from public.katalog where id = v_katalog_id;
      if v_katalog_data is null then
        raise exception 'TUG10_CATALOG_NOT_FOUND' using errcode = 'P0002';
      end if;
    else
      v_code := nullif(btrim(v_item->>'katalogBaru'), '');
      if v_code is null or nullif(btrim(v_item->>'namaBaru'), '') is null then
        raise exception 'TUG10_NEW_CATALOG_INVALID' using errcode = '23514';
      end if;
      v_catalog_key := case
        when regexp_replace(v_code, '[^0-9]', '', 'g') = '' then lower(v_code)
        else coalesce(nullif(ltrim(case when length(regexp_replace(v_code, '[^0-9]', '', 'g')) = 10 and left(regexp_replace(v_code, '[^0-9]', '', 'g'), 3) = '100' then substr(regexp_replace(v_code, '[^0-9]', '', 'g'), 4) else regexp_replace(v_code, '[^0-9]', '', 'g') end, '0'), ''), '0')
      end;
      select id, data into v_katalog_id, v_katalog_data
      from public.katalog
      where lower(coalesce(data->>'katalog', '')) = lower(v_code)
         or (regexp_replace(coalesce(data->>'katalog',''), '[^0-9]', '', 'g') <> ''
             and coalesce(nullif(ltrim(case when length(regexp_replace(data->>'katalog', '[^0-9]', '', 'g')) = 10 and left(regexp_replace(data->>'katalog', '[^0-9]', '', 'g'), 3) = '100' then substr(regexp_replace(data->>'katalog', '[^0-9]', '', 'g'), 4) else regexp_replace(data->>'katalog', '[^0-9]', '', 'g') end, '0'), ''), '0') = v_catalog_key)
      order by id limit 1;
      if v_katalog_id is null then
        v_katalog_id := 'KAT-TUG10-' || md5(v_txn.id || ':' || v_idx || ':' || v_code);
        v_katalog_data := jsonb_build_object(
          'id', v_katalog_id,
          'katalog', v_code,
          'name', v_item->>'namaBaru',
          'category', coalesce(nullif(v_item->>'categoryBaru',''), 'Lainnya'),
          'satuan', coalesce(nullif(v_item->>'satuanBaru',''), 'unit'),
          'sapStatus', 'Non-SAP',
          'createdAt', v_now
        );
        insert into public.katalog(id, data, created_at)
        values (v_katalog_id, v_katalog_data, v_now)
        on conflict (id) do nothing;
        select data into v_katalog_data from public.katalog where id = v_katalog_id;
      end if;
    end if;
    v_katalogs := v_katalogs || jsonb_build_array(v_katalog_data || jsonb_build_object('id', v_katalog_id));

    v_effect_key := v_txn.id || ':' || v_idx;
    v_source_key := 'TUG10|' || v_txn.id || '|' || v_idx;
    v_source_lot := jsonb_build_object(
      'key', v_source_key, 'kind', 'TUG10_RETURN',
      'supplier', coalesce(v_data->>'menyerahkanUnit',''),
      'sourceDocumentNo', coalesce(v_data->'docNumbers'->>'tug10', v_txn.doc_number, v_txn.id),
      'sourceDate', v_now, 'sourceTransactionId', v_txn.id,
      'sourceItemIndex', v_idx, 'status', 'ACTIVE'
    );

    v_handling := upper(nullif(btrim(v_item->>'stockHandling'), ''));
    if v_handling is not null and v_handling not in ('MERGE', 'SEPARATE') then
      raise exception 'TUG10_STOCK_HANDLING_INVALID' using errcode = '23514';
    end if;
    v_target_stock_id := nullif(btrim(v_item->>'targetStockId'), '');
    -- Backcompat: explicit target means MERGE; without a target, exactly one
    -- eligible row means MERGE, zero means a separate deterministic lot, and
    -- ambiguity fails closed.
    if v_handling is null then
      if v_target_stock_id is not null then
        v_handling := 'MERGE';
      else
        select count(*) into v_candidate_count
        from public.stocks
        where katalog_id = v_katalog_id
          and lokasi_id = (v_data->>'lokasiTujuanId')
          and coalesce(upt_id, data->>'uptId') = v_txn.upt_id
          and coalesce(data->'sourceLot'->>'status', '') <> 'NEEDS_SOURCE_ALLOCATION';
        if v_candidate_count > 1 then
          raise exception 'TUG10_TARGET_STOCK_AMBIGUOUS' using errcode = '23514';
        elsif v_candidate_count = 1 then
          select id into v_target_stock_id
          from public.stocks
          where katalog_id = v_katalog_id
            and lokasi_id = (v_data->>'lokasiTujuanId')
            and coalesce(upt_id, data->>'uptId') = v_txn.upt_id
            and coalesce(data->'sourceLot'->>'status', '') <> 'NEEDS_SOURCE_ALLOCATION'
          order by id limit 1;
          v_handling := 'MERGE';
        else
          v_handling := 'SEPARATE';
        end if;
      end if;
    end if;
    if v_handling = 'SEPARATE' then
      v_target_stock_id := null;
    elsif v_target_stock_id is null then
      raise exception 'TUG10_TARGET_STOCK_REQUIRED' using errcode = '23514';
    end if;

    if v_handling = 'MERGE' then
      select * into v_stock
      from public.stocks
      where id = v_target_stock_id
      for update;
      if v_stock.id is null then
        raise exception 'TUG10_TARGET_STOCK_NOT_FOUND' using errcode = 'P0002';
      end if;
      if v_stock.katalog_id is distinct from v_katalog_id
         or v_stock.lokasi_id is distinct from (v_data->>'lokasiTujuanId')
         or coalesce(v_stock.upt_id, v_stock.data->>'uptId') is distinct from v_txn.upt_id then
        raise exception 'TUG10_TARGET_STOCK_MISMATCH' using errcode = '23514';
      end if;
      if coalesce(v_stock.data->'sourceLot'->>'status', '') = 'NEEDS_SOURCE_ALLOCATION' then
        raise exception 'TUG10_TARGET_SOURCE_ALLOCATION_REQUIRED' using errcode = '23514';
      end if;
      v_stock_id := v_target_stock_id;
    else
      v_stock_id := 'STK-TUG10-' || md5(v_txn.id || ':' || v_idx);
      select * into v_stock
      from public.stocks
      where id = v_stock_id
      for update;
    end if;

    if v_stock.id is null then
      v_stock_data := jsonb_build_object(
        'id', v_stock_id, 'katalogId', v_katalog_id, 'lokasiId', v_data->>'lokasiTujuanId',
        'uptId', v_txn.upt_id, 'qty', v_qty, 'minQty', 0, 'price', 0,
        'jenisBarang', case v_item->>'statusMaterial' when 'Bongkaran ATTB (MTU)' then 'ATTB' when 'Bongkaran' then 'Bongkaran' else 'Persediaan' end,
        'sapStatus', 'Non-SAP', 'name', coalesce(v_katalog_data->>'name',''),
        'katalog', coalesce(v_katalog_data->>'katalog',''), 'unit', coalesce(v_katalog_data->>'satuan','unit'),
        'keteranganBarang', coalesce(v_item->>'keteranganBaru', v_item->>'keterangan', ''),
        'source', 'item', 'sourceLot', v_source_lot,
        'returnStatus', v_item->>'statusMaterial', 'img', v_item->>'fotoBarangRetur',
        'fotoKeseluruhan', v_item->>'fotoBarangRetur',
        'tug10ReturnEffects', jsonb_build_object(v_effect_key, jsonb_build_object(
          'qty', v_qty, 'at', v_now,
          'sourceDocumentNo', coalesce(v_data->'docNumbers'->>'tug10', v_txn.doc_number, v_txn.id)
        )), 'createdAt', v_now
      );
      insert into public.stocks(id, katalog_id, lokasi_id, upt_id, data, created_at)
      values (v_stock_id, v_katalog_id, v_data->>'lokasiTujuanId', v_txn.upt_id, v_stock_data, v_now);
      select * into v_stock from public.stocks where id = v_stock_id for update;
    else
      v_stock_data := coalesce(v_stock.data, '{}'::jsonb);
      v_old_qty := coalesce(nullif(v_stock_data->>'qty','')::numeric, 0);
      v_return_effects := coalesce(v_stock_data->'tug10ReturnEffects', '{}'::jsonb);
      v_already := coalesce(
        nullif(v_return_effects->v_effect_key->>'qty','')::numeric,
        nullif(v_return_effects->>v_effect_key,'')::numeric,
        nullif(v_stock_data->'_tug10Applied'->>v_effect_key,'')::numeric,
        0
      );
      if v_already > v_qty then
        raise exception 'TUG10_STOCK_MARKER_EXCEEDS_QTY' using errcode = '23514';
      end if;
      v_apply := v_qty - v_already;
      v_return_effects := v_return_effects || jsonb_build_object(v_effect_key, jsonb_build_object(
        'qty', v_qty, 'at', v_now,
        'sourceDocumentNo', coalesce(v_data->'docNumbers'->>'tug10', v_txn.doc_number, v_txn.id)
      ));
      if v_handling = 'MERGE' then
        v_stock_data := v_stock_data
          || jsonb_build_object('qty', v_old_qty + v_apply, 'img', v_item->>'fotoBarangRetur',
            'fotoKeseluruhan', v_item->>'fotoBarangRetur')
          || jsonb_build_object('tug10ReturnEffects', v_return_effects);
      else
        v_stock_data := v_stock_data
          || jsonb_build_object('qty', v_old_qty + v_apply, 'returnStatus', v_item->>'statusMaterial',
            'img', v_item->>'fotoBarangRetur', 'fotoKeseluruhan', v_item->>'fotoBarangRetur')
          || jsonb_build_object('tug10ReturnEffects', v_return_effects);
      end if;
      update public.stocks
      set data = v_stock_data, upt_id = coalesce(upt_id, v_txn.upt_id)
      where id = v_stock.id;
    end if;

    select data || jsonb_build_object('id', id, 'katalogId', katalog_id, 'lokasiId', lokasi_id) into v_stock_data from public.stocks where id = v_stock.id;
    v_stocks := v_stocks || jsonb_build_array(v_stock_data);

    if v_item->>'statusMaterial' = 'Bongkaran ATTB (MTU)' then
      select * into v_attb from public.attb_list
      where (data->>'sourceTxnId') = v_txn.id and (data->>'sourceItemIdx')::integer = v_idx
      order by id limit 1 for update;
      if v_attb.id is null then
        v_attb_id := 'ATTB-TUG10-' || md5(v_txn.id || ':' || v_idx);
        v_attb_data := jsonb_build_object(
          'id', v_attb_id, 'jenisAset', 'MATERIAL',
          'description', coalesce(v_katalog_data->>'name', v_item->>'namaBaru', '-'),
          'kuantitas', v_qty, 'satuan', coalesce(v_katalog_data->>'satuan', v_item->>'satuanBaru', 'unit'),
          'noEquipment', coalesce(v_item->>'noSeri',''), 'nomorAT', coalesce(v_item->>'noSeri',''),
          'keterangan', 'Material Bongkaran TUG-10 ' || coalesce(v_data->'docNumbers'->>'tug10', v_txn.doc_number, v_txn.id),
          'foto', coalesce(v_item->>'fotoNameplate', v_item->>'fotoBarangRetur'), 'upt', v_txn.upt_id,
          'stage', 'USULAN_AE1', 'approvalStatus', 'DRAFT', 'lanjutBelumLanjut', false,
          'stageHistory', jsonb_build_array(jsonb_build_object('stage','USULAN_AE1','tanggal',v_now,'oleh',v_actor.id,'catatan','Dari penerimaan TUG-10 (Bongkaran ATTB/MTU)')),
          'source', 'TUG10', 'sourceTxnId', v_txn.id, 'sourceItemIdx', v_idx,
          'createdAt', v_now, 'createdBy', v_actor.id, 'updatedAt', v_now, 'updatedBy', v_actor.id
        );
        insert into public.attb_list(id, data, created_at, upt, stage)
        values (v_attb_id, v_attb_data, v_now, v_txn.upt_id, 'USULAN_AE1');
        select * into v_attb from public.attb_list where id = v_attb_id;
      end if;
      select data || jsonb_build_object('id', id, 'upt', upt, 'stage', stage) into v_attb_data from public.attb_list where id = v_attb.id;
      v_attb_rows := v_attb_rows || jsonb_build_array(v_attb_data);
    end if;
  end loop;

  v_data := v_data || jsonb_build_object(
    'status', 'APPROVED', 'stage', 'APPROVED', 'approvedBy', v_actor.id,
    'approvedAt', v_now, 'requiredApprover', null
  );
  update public.tug10_transactions
  set status = 'APPROVED', stage = 'APPROVED', data = v_data,
      updated_at = v_now
  where id = v_txn.id;
  select * into v_txn from public.tug10_transactions where id = v_txn.id;

  if to_regclass('public.audit_log') is not null then
    execute 'insert into public.audit_log(user_id,user_name,role,action,entity,entity_id,detail) values ($1,$2,$3,$4,$5,$6,$7)'
      using v_actor.id, v_actor.name, v_actor.role, 'APPROVE', 'TUG10',
        coalesce(v_txn.doc_number, v_txn.id), jsonb_build_object('stage','APPROVED','atomic',true);
  end if;

  v_response := jsonb_build_object(
    'transaction', v_txn.data || jsonb_build_object('id', v_txn.id, 'status', v_txn.status, 'stage', v_txn.stage, 'uptId', v_txn.upt_id),
    'stocks', v_stocks, 'katalogs', v_katalogs, 'attbDrafts', v_attb_rows, 'idempotent', false
  );
  insert into public.tug_idempotency_keys(key, operation, actor_id, request_hash, response)
  values (p_idempotency_key, 'TUG10_FINAL_APPROVE', v_actor.id, v_hash, v_response);
  return v_response;
end;
$$;

revoke all on function public.approve_tug10_final(text, uuid) from public, anon;
grant execute on function public.approve_tug10_final(text, uuid) to authenticated;
commit;
