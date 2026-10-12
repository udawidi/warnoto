-- TUG MARA posting guard. Apply after 20261001_tug10_target_stock.sql.
-- Applied to self-host production on 2026-10-12 after explicit approval.
begin;

alter table public.tug_idempotency_keys
  drop constraint if exists tug_idempotency_keys_operation_check;
alter table public.tug_idempotency_keys
  add constraint tug_idempotency_keys_operation_check
  check (operation in ('CREATE','SUBMIT','DECIDE','AMEND','TUG10_FINAL_APPROVE','TUG3_FINAL_APPROVE'));

create or replace function public.tug_mara_resolve(
  p_code text,
  p_prefix text default 'TUG'
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_key text := nullif(ltrim(btrim(coalesce(p_code, '')), '0'), '');
  v_count integer;
  v_row public.mara_catalog;
begin
  if v_key is null then
    raise exception '%_MARA_CATALOG_REQUIRED', coalesce(nullif(p_prefix, ''), 'TUG') using errcode = '23514';
  end if;

  select count(*) into v_count
  from public.mara_catalog
  where nullif(ltrim(btrim(coalesce(kode_material, '')), '0'), '') = v_key;
  if v_count = 0 then
    raise exception '%_MARA_CATALOG_NOT_FOUND', coalesce(nullif(p_prefix, ''), 'TUG') using errcode = 'P0002';
  elsif v_count <> 1 then
    raise exception '%_MARA_CATALOG_AMBIGUOUS', coalesce(nullif(p_prefix, ''), 'TUG') using errcode = '23514';
  end if;

  select * into v_row
  from public.mara_catalog
  where nullif(ltrim(btrim(coalesce(kode_material, '')), '0'), '') = v_key
  order by kode_material
  limit 1;
  if nullif(btrim(coalesce(v_row.kode_material, '')), '') is null
     or nullif(btrim(coalesce(v_row.nama, '')), '') is null
     or nullif(btrim(coalesce(v_row.satuan, '')), '') is null then
    raise exception '%_MARA_CATALOG_INVALID', coalesce(nullif(p_prefix, ''), 'TUG') using errcode = '23514';
  end if;
  return jsonb_build_object(
    'kode_material', btrim(v_row.kode_material),
    'nama', coalesce(v_row.nama, ''),
    'satuan', coalesce(v_row.satuan, ''),
    'material_group', coalesce(v_row.material_group, ''),
    'material_group_desc', coalesce(v_row.material_group_desc, ''),
    'status', coalesce(v_row.status, '')
  );
end;
$$;

create or replace function public.tug3_source_part(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select coalesce(
    nullif(
      regexp_replace(
        regexp_replace(lower(btrim(coalesce(p_value, ''))), '[^a-z0-9]+', '-', 'g'),
        '(^-+|-+$)', '', 'g'
      ),
      ''
    ),
    '-'
  )
$$;

create or replace function public.tug_mara_catalog_data(
  p_data jsonb,
  p_prefix text default 'TUG'
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_data jsonb := coalesce(p_data, '{}'::jsonb);
  v_mara jsonb;
  v_category text;
begin
  v_mara := public.tug_mara_resolve(v_data->>'katalog', p_prefix);
  v_category := coalesce(nullif(v_mara->>'material_group_desc', ''), nullif(v_mara->>'material_group', ''), 'Lainnya');
  return v_data || jsonb_build_object(
    'katalog', v_mara->>'kode_material',
    'name', v_mara->>'nama',
    'category', v_category,
    'satuan', v_mara->>'satuan',
    'maraCode', v_mara->>'kode_material',
    '_maraLocked', true
  );
end;
$$;

revoke all on function public.tug_mara_resolve(text,text) from public, anon, authenticated;
revoke all on function public.tug_mara_catalog_data(jsonb,text) from public, anon, authenticated;
revoke all on function public.tug3_source_part(text) from public, anon, authenticated;

create or replace function public.katalog_fill_satuan_from_mara()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_key text := nullif(ltrim(btrim(coalesce(new.data->>'katalog', '')), '0'), '');
  v_count integer;
  v_mara public.mara_catalog;
  v_tug_context boolean := coalesce(current_setting('app.tug3_final_rpc', true), '') = 'on'
    or coalesce(current_setting('app.tug10_final_rpc', true), '') = 'on'
    or coalesce(current_setting('app.mtu_khs_receipt_rpc', true), '') = 'on';
begin
  if v_key is null then
    return new;
  end if;
  select count(*) into v_count
  from public.mara_catalog
  where nullif(ltrim(btrim(coalesce(kode_material, '')), '0'), '') = v_key;
  if v_count > 1 and v_tug_context then
    raise exception '%_MARA_CATALOG_AMBIGUOUS', case
      when coalesce(current_setting('app.tug3_final_rpc', true), '') = 'on' then 'TUG3'
      when coalesce(current_setting('app.mtu_khs_receipt_rpc', true), '') = 'on' then 'MTU'
      else 'TUG10'
    end using errcode = '23514';
  elsif v_count = 1 then
    select * into v_mara
    from public.mara_catalog
    where nullif(ltrim(btrim(coalesce(kode_material, '')), '0'), '') = v_key
    order by kode_material
    limit 1;
    if nullif(btrim(coalesce(v_mara.kode_material, '')), '') is not null
       and nullif(btrim(coalesce(v_mara.nama, '')), '') is not null
       and nullif(btrim(coalesce(v_mara.satuan, '')), '') is not null then
      new.data := coalesce(new.data, '{}'::jsonb) || jsonb_build_object(
        'katalog', btrim(v_mara.kode_material),
        'name', btrim(v_mara.nama),
        'satuan', btrim(v_mara.satuan),
        'maraCode', btrim(v_mara.kode_material),
        '_maraLocked', true,
        'category', coalesce(nullif(btrim(v_mara.material_group_desc), ''), nullif(btrim(v_mara.material_group), ''), 'Lainnya')
      );
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.katalog_fill_satuan_from_mara() from public, anon, authenticated;

create or replace function public.tug_mara_catalog_write_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_prefix text := case
    when coalesce(current_setting('app.tug3_final_rpc', true), '') = 'on' then 'TUG3'
    when coalesce(current_setting('app.mtu_khs_receipt_rpc', true), '') = 'on' then 'MTU'
    else 'TUG10'
  end;
begin
  if coalesce(current_setting('app.tug3_final_rpc', true), '') <> 'on'
     and coalesce(current_setting('app.tug10_final_rpc', true), '') <> 'on'
     and coalesce(current_setting('app.mtu_khs_receipt_rpc', true), '') <> 'on' then
    return new;
  end if;
  new.data := public.tug_mara_catalog_data(new.data, v_prefix);
  return new;
end;
$$;

drop trigger if exists trg_tug_mara_catalog_write_guard on public.katalog;
create trigger trg_tug_mara_catalog_write_guard
before insert or update on public.katalog
for each row execute function public.tug_mara_catalog_write_guard();
revoke all on function public.tug_mara_catalog_write_guard() from public, anon, authenticated;

create or replace function public.tug_mara_stock_write_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_prefix text := case
    when coalesce(current_setting('app.tug3_final_rpc', true), '') = 'on' then 'TUG3'
    when coalesce(current_setting('app.mtu_khs_receipt_rpc', true), '') = 'on' then 'MTU'
    else 'TUG10'
  end;
  v_data jsonb := coalesce(new.data, '{}'::jsonb);
  v_catalog_data jsonb;
  v_mara_data jsonb;
  v_code text;
  v_category text;
begin
  if coalesce(current_setting('app.tug3_final_rpc', true), '') <> 'on'
     and coalesce(current_setting('app.tug10_final_rpc', true), '') <> 'on'
     and coalesce(current_setting('app.mtu_khs_receipt_rpc', true), '') <> 'on' then
    return new;
  end if;
  select data into v_catalog_data from public.katalog where id = new.katalog_id;
  v_code := coalesce(nullif(btrim(v_catalog_data->>'katalog'), ''), nullif(btrim(v_data->>'katalog'), ''));
  v_mara_data := public.tug_mara_resolve(v_code, v_prefix);
  v_category := coalesce(nullif(v_mara_data->>'material_group_desc', ''), nullif(v_mara_data->>'material_group', ''), 'Lainnya');
  new.data := v_data || jsonb_build_object(
    'katalogId', new.katalog_id,
    'katalog', v_mara_data->>'kode_material',
    'name', v_mara_data->>'nama',
    'unit', v_mara_data->>'satuan',
    'satuan', v_mara_data->>'satuan',
    'category', v_category,
    'maraCode', v_mara_data->>'kode_material',
    '_maraLocked', true
  );
  if new.katalog_id is not null then
    update public.katalog
    set data = public.tug_mara_catalog_data(
      coalesce(v_catalog_data, jsonb_build_object('katalog', v_code)), v_prefix
    )
    where id = new.katalog_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tug_mara_stock_write_guard on public.stocks;
create trigger trg_tug_mara_stock_write_guard
before insert or update on public.stocks
for each row execute function public.tug_mara_stock_write_guard();
revoke all on function public.tug_mara_stock_write_guard() from public, anon, authenticated;

create or replace function public.tug3_guard_legacy_stock_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if coalesce(current_setting('app.tug3_final_rpc', true), '') = 'on'
     or coalesce(current_setting('app.mtu_khs_receipt_rpc', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' and (
       new.data ? '_tug3Applied'
       or new.data->'sourceLot'->>'kind' = 'TUG3_CONTRACT'
     ) then
    raise exception 'TUG3_STOCK_RPC_REQUIRED' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (
       new.data->'_tug3Applied' is distinct from old.data->'_tug3Applied'
       or old.data->'sourceLot'->>'kind' = 'TUG3_CONTRACT'
          and (new.data->>'qty' is distinct from old.data->>'qty'
            or new.data->'sourceLot' is distinct from old.data->'sourceLot')
     ) then
    raise exception 'TUG3_STOCK_RPC_REQUIRED' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tug3_guard_legacy_stock_write on public.stocks;
create trigger trg_tug3_guard_legacy_stock_write
before insert or update on public.stocks
for each row execute function public.tug3_guard_legacy_stock_write();
revoke all on function public.tug3_guard_legacy_stock_write() from public, anon, authenticated;

create or replace function public.tug3_guard_legacy_status_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if coalesce(current_setting('app.tug3_final_rpc', true), '') = 'on'
     or coalesce(current_setting('app.mtu_khs_receipt_rpc', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'APPROVED' and new.status <> old.status then
    raise exception 'TUG3_APPROVED_IMMUTABLE' using errcode = '42501';
  end if;
  if new.status = 'APPROVED' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    raise exception 'TUG3_APPROVAL_RPC_REQUIRED' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.data->'_tug3Applied' is distinct from old.data->'_tug3Applied' then
    raise exception 'TUG3_APPROVAL_RPC_REQUIRED' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tug3_guard_legacy_status_write on public.tug3_transactions;
create trigger trg_tug3_guard_legacy_status_write
before insert or update on public.tug3_transactions
for each row execute function public.tug3_guard_legacy_status_write();
revoke all on function public.tug3_guard_legacy_status_write() from public, anon, authenticated;

create or replace function public.approve_tug3_final(
  p_tug3_id text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor public.profiles;
  v_txn public.tug3_transactions;
  v_data jsonb;
  v_items jsonb;
  v_item jsonb;
  v_mara jsonb;
  v_cat_data jsonb;
  v_stock_data jsonb;
  v_stock public.stocks;
  v_code text;
  v_catalog_id text;
  v_location_id text;
  v_location_upt text;
  v_qty numeric;
  v_old_qty numeric;
  v_already numeric;
  v_effect text;
  v_source_key text;
  v_source_lot jsonb;
  v_contract_no text;
  v_document_no text;
  v_supplier text;
  v_identity text;
  v_mara_key text;
  v_candidate_count integer;
  v_now bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_idx integer;
  v_stock_id text;
  v_category text;
  v_response jsonb;
  v_existing public.tug_idempotency_keys;
  v_hash text;
  v_stocks jsonb := '[]'::jsonb;
  v_katalogs jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'TUG_AUTH_REQUIRED' using errcode = '42501'; end if;
  if nullif(btrim(p_tug3_id), '') is null or p_idempotency_key is null then
    raise exception 'TUG3_INPUT_INVALID' using errcode = '23514';
  end if;
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null then raise exception 'TUG_AUTH_REQUIRED' using errcode = '42501'; end if;
  if v_actor.role not in ('ASMAN','SUPERADMIN') then
    raise exception 'TUG3_APPROVAL_ROLE_DENIED' using errcode = '42501';
  end if;

  v_hash := md5('TUG3_FINAL_APPROVE|' || p_tug3_id);
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select * into v_existing from public.tug_idempotency_keys where key = p_idempotency_key;
  if v_existing.key is not null then
    if v_existing.operation <> 'TUG3_FINAL_APPROVE' or v_existing.actor_id <> v_actor.id
       or v_existing.request_hash is distinct from v_hash then
      raise exception 'TUG_IDEMPOTENCY_REUSE_FORBIDDEN' using errcode = '42501';
    end if;
    return v_existing.response || jsonb_build_object('idempotent', true);
  end if;

  select * into v_txn from public.tug3_transactions where id = p_tug3_id for update;
  if v_txn.id is null then raise exception 'TUG3_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_access_upt(v_txn.upt_id) then raise exception 'TUG3_SCOPE_DENIED' using errcode = '42501'; end if;
  if v_txn.status = 'APPROVED' and v_txn.stage = 'APPROVED' then raise exception 'TUG3_ALREADY_APPROVED'; end if;
  if v_txn.status <> 'PENDING' or v_txn.stage <> 'PENDING_ASMAN' then raise exception 'TUG3_STAGE_INVALID'; end if;
  v_data := coalesce(v_txn.data, '{}'::jsonb);
  v_items := v_data->'stockItems';
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then raise exception 'TUG3_ITEMS_REQUIRED'; end if;
  perform set_config('app.tug3_final_rpc', 'on', true);

  for v_item, v_idx in select value, (ordinality - 1)::integer from jsonb_array_elements(v_items) with ordinality loop
    if nullif(btrim(v_item->>'qty'), '') is null or (v_item->>'qty')::numeric <= 0 then raise exception 'TUG3_QTY_INVALID'; end if;
    v_qty := (v_item->>'qty')::numeric;
    v_location_id := nullif(btrim(coalesce(v_item->>'lokasiTujuanId', v_data->>'lokasiTujuanId')), '');
    select g.upt_id into v_location_upt from public.lokasi l join public.gudang g on g.id = l.gudang_id where l.id = v_location_id;
    if v_location_upt is null then raise exception 'TUG3_LOCATION_NOT_FOUND'; end if;
    if v_location_upt <> v_txn.upt_id then raise exception 'TUG3_LOCATION_SCOPE_DENIED' using errcode = '42501'; end if;

    if coalesce(v_item->>'katalogMode', 'existing') = 'existing' then
      v_catalog_id := nullif(btrim(v_item->>'katalogId'), '');
      if v_catalog_id is null then raise exception 'TUG3_MARA_CATALOG_REQUIRED'; end if;
      select data into v_cat_data from public.katalog where id = v_catalog_id;
      if v_cat_data is null then raise exception 'TUG3_CATALOG_NOT_FOUND' using errcode = 'P0002'; end if;
      v_code := nullif(btrim(v_cat_data->>'katalog'), '');
    else
      v_code := nullif(btrim(v_item->>'katalogBaru'), '');
      v_mara := public.tug_mara_resolve(v_code, 'TUG3');
      v_mara_key := nullif(ltrim(btrim(v_mara->>'kode_material'), '0'), '');
      perform pg_advisory_xact_lock(hashtextextended('TUG3:MARA:' || v_mara_key, 0));
      select count(*) into v_candidate_count
      from public.katalog
      where nullif(ltrim(btrim(data->>'katalog'), '0'), '') = v_mara_key;
      if v_candidate_count > 1 then
        raise exception 'TUG3_CATALOG_AMBIGUOUS' using errcode = '23514';
      end if;
      select id, data into v_catalog_id, v_cat_data from public.katalog
      where nullif(ltrim(btrim(data->>'katalog'), '0'), '') = v_mara_key
      order by id limit 1;
    end if;
    v_mara := public.tug_mara_resolve(v_code, 'TUG3');
    v_category := coalesce(nullif(v_mara->>'material_group_desc', ''), nullif(v_mara->>'material_group', ''), 'Lainnya');
    v_cat_data := coalesce(v_cat_data, jsonb_build_object('id', v_catalog_id))
      || jsonb_build_object('id', v_catalog_id, 'katalog', v_mara->>'kode_material', 'name', v_mara->>'nama',
        'category', v_category, 'satuan', v_mara->>'satuan', 'sapStatus', coalesce(v_cat_data->>'sapStatus', 'SAP'),
        'maraCode', v_mara->>'kode_material', '_maraLocked', true, 'updatedAt', v_now);
    if v_catalog_id is null then
      v_catalog_id := 'KAT-TUG3-' || md5(v_txn.id || ':' || v_idx || ':' || (v_mara->>'kode_material'));
      v_cat_data := jsonb_set(v_cat_data, '{id}', to_jsonb(v_catalog_id), true);
      insert into public.katalog(id, data, created_at) values (v_catalog_id, v_cat_data, v_now);
    else
      update public.katalog set data = v_cat_data where id = v_catalog_id;
    end if;
    v_katalogs := v_katalogs || jsonb_build_array(v_cat_data);

    v_effect := v_txn.id || ':' || v_idx;
    v_contract_no := coalesce(v_data->>'judulKontrak', '');
    v_document_no := coalesce(v_data->>'suratPesananNo', '');
    v_supplier := coalesce(v_data->>'dariSupplier', '');
    v_identity := case
      when v_contract_no <> '' then v_contract_no
      when v_document_no <> '' then v_document_no
      else null
    end;
    if v_identity is not null then
      v_source_key := array_to_string(array[
        public.tug3_source_part('TUG3'),
        public.tug3_source_part(v_txn.upt_id),
        public.tug3_source_part(v_location_id),
        public.tug3_source_part(v_catalog_id),
        public.tug3_source_part(v_supplier),
        public.tug3_source_part(v_identity)
      ], '|');
    else
      v_source_key := array_to_string(array[
        public.tug3_source_part('TUG3'),
        public.tug3_source_part(v_txn.upt_id),
        public.tug3_source_part(v_location_id),
        public.tug3_source_part(v_catalog_id),
        public.tug3_source_part(v_txn.id),
        public.tug3_source_part(v_idx::text)
      ], '|');
    end if;
    v_source_lot := jsonb_build_object('key', v_source_key, 'kind', 'TUG3_CONTRACT', 'supplier', coalesce(v_data->>'dariSupplier',''),
      'contractNo', coalesce(v_data->>'judulKontrak',''), 'sourceDocumentNo', coalesce(v_data->'docNumbers'->>'tug3', v_txn.doc_number, v_txn.id),
      'sourceDate', v_now, 'sourceTransactionId', v_txn.id, 'sourceItemIndex', v_idx, 'status', 'ACTIVE');
    select * into v_stock from public.stocks where katalog_id = v_catalog_id and lokasi_id = v_location_id
      and data->'sourceLot'->>'key' = v_source_key for update;
    v_stock_id := coalesce(v_stock.id, 'STK-TUG3-' || md5(v_txn.id || ':' || v_idx));
    if v_stock.id is null then
      insert into public.stocks(id, katalog_id, lokasi_id, upt_id, data, created_at)
      values (v_stock_id, v_catalog_id, v_location_id, v_txn.upt_id,
        jsonb_build_object('id', v_stock_id, 'katalogId', v_catalog_id, 'lokasiId', v_location_id, 'uptId', v_txn.upt_id,
          'qty', v_qty, 'minQty', 0, 'price', coalesce(nullif(v_item->>'hargaSatuan','')::numeric, 0),
          'jenisBarang', case when coalesce(v_item->>'sapStatus','') ilike '%cadang%' then 'Cadang' else 'Persediaan' end,
          'sapStatus', coalesce(v_item->>'sapStatus','SAP'), 'name', v_mara->>'nama', 'katalog', v_mara->>'kode_material',
          'unit', v_mara->>'satuan', 'category', v_category, 'source', 'TUG3', 'sourceLot', v_source_lot,
           'img', v_item->>'fotoBarang', 'fotoKeseluruhan', v_item->>'fotoBarang',
           'kontrakRefs', jsonb_build_array(jsonb_build_object(
             'noKontrak', v_contract_no, 'supplier', v_supplier,
             'suratPesananNo', v_document_no, 'suratPesananTgl', coalesce(v_data->>'suratPesananTgl', ''),
             'amandemenNo', coalesce(v_data->>'amandemenNo', ''), 'tglMasuk', v_now,
             'docNo', coalesce(v_data->'docNumbers'->>'tug3', v_txn.doc_number, v_txn.id)
           )),
           '_tug3Applied', jsonb_build_object(v_effect, v_qty), 'createdAt', v_now), v_now);
    else
      v_old_qty := coalesce(nullif(v_stock.data->>'qty','')::numeric, 0);
      v_already := coalesce(nullif(v_stock.data->'_tug3Applied'->>v_effect,'')::numeric, 0);
      update public.stocks set data = coalesce(v_stock.data, '{}'::jsonb)
        || jsonb_build_object('qty', v_old_qty + greatest(v_qty - v_already, 0), 'katalogId', v_catalog_id, 'katalog', v_mara->>'kode_material',
          'name', v_mara->>'nama', 'unit', v_mara->>'satuan', 'satuan', v_mara->>'satuan', 'category', v_category,
           'sourceLot', v_source_lot,
           'kontrakRefs', jsonb_build_array(jsonb_build_object(
             'noKontrak', v_contract_no, 'supplier', v_supplier,
             'suratPesananNo', v_document_no, 'suratPesananTgl', coalesce(v_data->>'suratPesananTgl', ''),
             'amandemenNo', coalesce(v_data->>'amandemenNo', ''), 'tglMasuk', v_now,
             'docNo', coalesce(v_data->'docNumbers'->>'tug3', v_txn.doc_number, v_txn.id)
           )),
           '_tug3Applied', coalesce(v_stock.data->'_tug3Applied','{}'::jsonb) || jsonb_build_object(v_effect, v_qty))
      where id = v_stock.id;
    end if;
    select data || jsonb_build_object('id', id, 'katalogId', katalog_id, 'lokasiId', lokasi_id) into v_stock_data from public.stocks where id = v_stock_id;
    v_stocks := v_stocks || jsonb_build_array(v_stock_data);
  end loop;

  v_data := v_data || jsonb_build_object('status','APPROVED','stage','APPROVED','approvedBy',v_actor.id,'approvedAt',v_now,
    'approvedByAsman',v_actor.id,'approvedAtAsman',v_now,'requiredApprover',null);
  update public.tug3_transactions set status='APPROVED', stage='APPROVED', data=v_data, updated_at=v_now where id=v_txn.id;
  select * into v_txn from public.tug3_transactions where id=v_txn.id;
  if to_regclass('public.audit_log') is not null then
    execute 'insert into public.audit_log(user_id,user_name,role,action,entity,entity_id,detail) values ($1,$2,$3,$4,$5,$6,$7)'
      using v_actor.id, v_actor.name, v_actor.role, 'APPROVE', 'TUG3', coalesce(v_txn.doc_number,v_txn.id), jsonb_build_object('stage','APPROVED','atomic',true);
  end if;
  v_response := jsonb_build_object('transaction', v_txn.data || jsonb_build_object('id',v_txn.id,'status',v_txn.status,'stage',v_txn.stage,'uptId',v_txn.upt_id),
    'stocks',v_stocks,'katalogs',v_katalogs,'idempotent',false);
  insert into public.tug_idempotency_keys(key,operation,actor_id,request_hash,response) values (p_idempotency_key,'TUG3_FINAL_APPROVE',v_actor.id,v_hash,v_response);
  return v_response;
end;
$$;

revoke all on function public.approve_tug3_final(text, uuid) from public, anon;
grant execute on function public.approve_tug3_final(text, uuid) to authenticated;

-- MTU keeps its public signature; only the MARA precondition and authoritative
-- stock identity are added. The existing photo, quantity, UPT and idempotency
-- checks remain in the deployed function and are amended below by this wrapper.
create or replace function public.mtu_khs_apply_tug3_receipt(
  p_tug3_transaction_id text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  x public.tug3_transactions; r public.mtu_khs_records; a public.profiles; existing public.mtu_khs_receipts;
  item jsonb; items jsonb; item_qty numeric; total_qty numeric := 0; max_qty numeric; stock_row public.stocks;
  stock_id text; location_id text; catalog_id text; catalog_data jsonb; mara_data jsonb; code text; category text;
  before_qty numeric; after_qty numeric; applied_items jsonb := '[]'::jsonb; item_index integer; foto_barang text; foto_path text;
begin
  select * into x from public.tug3_transactions where id=p_tug3_transaction_id for update;
  select * into a from public.profiles where id=auth.uid();
  if x.id is null or x.mtu_record_id is null or a.role not in ('ASMAN','SUPERADMIN') then raise exception 'MTU_RECEIPT_FORBIDDEN' using errcode='42501'; end if;
  select * into existing from public.mtu_khs_receipts where tug3_transaction_id=x.id or idempotency_key=p_idempotency_key limit 1;
  if existing.id is not null then return jsonb_build_object('receiptId',existing.id,'deduped',true,'qty',existing.qty); end if;
  select * into r from public.mtu_khs_records where id=x.mtu_record_id for update;
  if r.id is null or r.procurement_year <> 2026 or r.sifat_pekerjaan='SUPERVISI' or x.stage <> 'PENDING_ASMAN'
     or not public.mtu_khs_can_access_upt(r.upt_id) or (a.role <> 'SUPERADMIN' and a.upt_id <> r.upt_id) then raise exception 'MTU_RECEIPT_INVALID'; end if;
  items := x.data->'stockItems';
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items)=0 then raise exception 'TUG_ITEMS_REQUIRED'; end if;
  for item,item_index in select value,(ordinality-1)::integer from jsonb_array_elements(items) with ordinality loop
    catalog_id := nullif(btrim(item->>'katalogId'),''); location_id := nullif(btrim(coalesce(item->>'lokasiTujuanId',item->>'lokasiId','')),'');
    foto_barang := nullif(btrim(coalesce(item->>'fotoBarang','')),''); foto_path := x.id || '/item' || item_index || '-fotoBarang.jpg';
    if foto_barang is null or foto_barang like 'data:%' or foto_barang not in ('https://warnoto.com/storage/v1/object/public/tug-photos/'||foto_path,'https://api-staging.warnoto.com/storage/v1/object/public/tug-photos/'||foto_path)
       or not exists (select 1 from storage.objects where bucket_id='tug-photos' and name=foto_path) then raise exception 'MTU_RECEIPT_PHOTO_REQUIRED'; end if;
    if btrim(coalesce(item->>'qty','')) !~ '^[0-9]+([.][0-9]{1,4})?$' then raise exception 'MTU_RECEIPT_ITEM_INVALID'; end if;
    item_qty := (item->>'qty')::numeric;
    select data into catalog_data from public.katalog where id=catalog_id;
    code := coalesce(nullif(btrim(item->>'katalogBaru'),''), nullif(btrim(catalog_data->>'katalog'),''), nullif(btrim(item->'snapshot'->>'katalog'),''));
    mara_data := public.tug_mara_resolve(code,'MTU');
    if catalog_id is null or item_qty <= 0 or r.katalog_id is distinct from catalog_id
       or catalog_data is null or not exists (select 1 from public.lokasi l join public.gudang g on g.id=l.gudang_id where l.id=location_id and g.upt_id=r.upt_id) then raise exception 'MTU_RECEIPT_ITEM_INVALID'; end if;
    total_qty := total_qty + item_qty;
  end loop;
  max_qty := greatest(0,r.qty-coalesce((select sum(qty) from public.mtu_khs_receipts where mtu_record_id=r.id),0));
  if total_qty > max_qty then raise exception 'MTU_RECEIPT_QTY_EXCEEDED'; end if;
  perform set_config('app.mtu_khs_receipt_rpc','on',true);
  for item,item_index in select value,(ordinality-1)::integer from jsonb_array_elements(items) with ordinality loop
    catalog_id := nullif(btrim(item->>'katalogId'),''); location_id := nullif(btrim(coalesce(item->>'lokasiTujuanId',item->>'lokasiId','')),'');
    item_qty := (item->>'qty')::numeric; select data into catalog_data from public.katalog where id=catalog_id;
    code := coalesce(nullif(btrim(item->>'katalogBaru'),''), nullif(btrim(catalog_data->>'katalog'),''), nullif(btrim(item->'snapshot'->>'katalog'),''));
    mara_data := public.tug_mara_resolve(code,'MTU'); category := coalesce(nullif(mara_data->>'material_group_desc',''),nullif(mara_data->>'material_group',''),'Lainnya');
    update public.katalog set data=public.tug_mara_catalog_data(coalesce(catalog_data,jsonb_build_object('katalog',code)),'MTU') where id=catalog_id;
    select * into stock_row from public.stocks where katalog_id=catalog_id and lokasi_id=location_id for update;
    if stock_row.id is null then
      stock_id := 'STK-MTU-'||md5(r.id||':'||catalog_id||':'||location_id);
      insert into public.stocks(id,katalog_id,lokasi_id,upt_id,data,created_at) values (stock_id,catalog_id,location_id,r.upt_id,
        jsonb_build_object('name',mara_data->>'nama','katalog',mara_data->>'kode_material','unit',mara_data->>'satuan','satuan',mara_data->>'satuan','category',category,'qty',item_qty,'price',coalesce(nullif(item->>'hargaSatuan','')::numeric,0),'uptId',r.upt_id,'mtuRecordId',r.id,'mtuTug3Id',x.id,'source','MTU_KHS_TUG3','fotoKeseluruhan',foto_barang,'img',foto_barang,'createdAt',extract(epoch from clock_timestamp())*1000),(extract(epoch from clock_timestamp())*1000)::bigint) returning * into stock_row;
      before_qty := 0;
    else
      stock_id := stock_row.id; before_qty := coalesce((stock_row.data->>'qty')::numeric,0);
      update public.stocks set upt_id=coalesce(upt_id,r.upt_id), data=coalesce(stock_row.data,'{}'::jsonb)||jsonb_build_object('qty',before_qty+item_qty,'name',mara_data->>'nama','katalog',mara_data->>'kode_material','unit',mara_data->>'satuan','satuan',mara_data->>'satuan','category',category,'fotoKeseluruhan',foto_barang,'img',foto_barang,'uptId',r.upt_id,'mtuRecordId',r.id,'mtuTug3Id',x.id,'source','MTU_KHS_TUG3') where id=stock_row.id;
    end if;
    after_qty := before_qty+item_qty;
    applied_items := applied_items||jsonb_build_array(jsonb_build_object('stockId',stock_id,'katalogId',catalog_id,'lokasiId',location_id,'qty',item_qty,'beforeQty',before_qty,'afterQty',after_qty,'itemIndex',item_index,'fotoBarang',foto_barang));
  end loop;
  insert into public.mtu_khs_receipts(mtu_record_id,tug3_transaction_id,qty,items,applied_by,idempotency_key) values (r.id,x.id,total_qty,applied_items,a.id,p_idempotency_key) returning * into existing;
  update public.tug3_transactions set stage='APPROVED',status='APPROVED',data=data||jsonb_build_object(
    'mtuReceiptId',existing.id,'mtuReceiptAppliedAt',now(),
    'approvedBy',a.id,'approvedAt',(extract(epoch from clock_timestamp())*1000)::bigint,
    'approvedByAsman',a.id,'approvedAtAsman',(extract(epoch from clock_timestamp())*1000)::bigint
  ),updated_at=(extract(epoch from clock_timestamp())*1000)::bigint where id=x.id;
  return jsonb_build_object('receiptId',existing.id,'deduped',false,'qty',total_qty,'items',applied_items);
end;
$$;

revoke all on function public.mtu_khs_apply_tug3_receipt(text,text) from public, anon, authenticated;
grant execute on function public.mtu_khs_apply_tug3_receipt(text,text) to authenticated;

-- TUG-10 keeps its existing signature and atomic implementation. The posting
-- context makes its catalog/stock writes pass through the MARA resolver above;
-- invalid, missing, or ambiguous codes abort the whole transaction.
revoke all on function public.approve_tug10_final(text, uuid) from public, anon;
grant execute on function public.approve_tug10_final(text, uuid) to authenticated;

commit;
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
  v_mara_data jsonb;
  v_catalog_code text;
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
      v_mara_data := public.tug_mara_resolve(v_katalog_data->>'katalog', 'TUG10');
      v_katalog_data := public.tug_mara_catalog_data(v_katalog_data, 'TUG10');
      update public.katalog set data = v_katalog_data where id = v_katalog_id;
    else
      v_code := nullif(btrim(v_item->>'katalogBaru'), '');
      if v_code is null then
        raise exception 'TUG10_NEW_CATALOG_INVALID' using errcode = '23514';
      end if;
      v_mara_data := public.tug_mara_resolve(v_code, 'TUG10');
      v_catalog_code := nullif(ltrim(btrim(v_mara_data->>'kode_material'), '0'), '');
      select count(*) into v_candidate_count
      from public.katalog
      where nullif(ltrim(btrim(data->>'katalog'), '0'), '') = v_catalog_code;
      if v_candidate_count > 1 then
        raise exception 'TUG10_CATALOG_AMBIGUOUS' using errcode = '23514';
      elsif v_candidate_count = 1 then
        select id, data into v_katalog_id, v_katalog_data
        from public.katalog
        where nullif(ltrim(btrim(data->>'katalog'), '0'), '') = v_catalog_code
        order by id limit 1;
        v_mara_data := public.tug_mara_resolve(v_katalog_data->>'katalog', 'TUG10');
        v_katalog_data := public.tug_mara_catalog_data(v_katalog_data, 'TUG10');
        update public.katalog set data = v_katalog_data where id = v_katalog_id;
      else
        v_katalog_id := 'KAT-TUG10-' || md5(v_txn.id || ':' || v_idx || ':' || (v_mara_data->>'kode_material'));
        v_katalog_data := public.tug_mara_catalog_data(
          jsonb_build_object(
            'id', v_katalog_id,
            'katalog', v_mara_data->>'kode_material',
            'sapStatus', 'Non-SAP',
            'createdAt', v_now
          ),
          'TUG10'
        );
        insert into public.katalog(id, data, created_at)
        values (v_katalog_id, v_katalog_data, v_now)
        on conflict (id) do nothing;
        select data into v_katalog_data from public.katalog where id = v_katalog_id;
      end if;
    end if;

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

    select data into v_katalog_data from public.katalog where id = v_katalog_id for update;
    v_mara_data := public.tug_mara_resolve(v_katalog_data->>'katalog', 'TUG10');
    v_katalog_data := public.tug_mara_catalog_data(v_katalog_data, 'TUG10');
    update public.katalog set data = v_katalog_data where id = v_katalog_id;
    select data into v_katalog_data from public.katalog where id = v_katalog_id;
    v_katalogs := v_katalogs || jsonb_build_array(v_katalog_data || jsonb_build_object('id', v_katalog_id));

    if v_item->>'statusMaterial' = 'Bongkaran ATTB (MTU)' then
      select * into v_attb from public.attb_list
      where (data->>'sourceTxnId') = v_txn.id and (data->>'sourceItemIdx')::integer = v_idx
      order by id limit 1 for update;
      if v_attb.id is null then
        v_attb_id := 'ATTB-TUG10-' || md5(v_txn.id || ':' || v_idx);
        v_attb_data := jsonb_build_object(
          'id', v_attb_id, 'jenisAset', 'MATERIAL',
          'description', coalesce(v_katalog_data->>'name', '-'),
          'kuantitas', v_qty, 'satuan', coalesce(v_katalog_data->>'satuan', 'unit'),
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
    'approvedAt', v_now, 'approvedByAsman', v_actor.id, 'approvedAtAsman', v_now, 'requiredApprover', null
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
