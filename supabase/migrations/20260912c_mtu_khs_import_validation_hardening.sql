begin;

-- Keep import rows reviewable even when optional master references are not mapped yet.
alter table public.mtu_khs_import_rows
  add column if not exists validation_warnings jsonb not null default '[]'::jsonb;

create or replace function public.mtu_khs_validate_import_row(p_normalized jsonb, p_batch_uit_id text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized jsonb := coalesce(p_normalized, '{}'::jsonb);
  errors text[] := array[]::text[];
  warnings text[] := array[]::text[];
  sifat text := upper(coalesce(nullif(btrim(normalized->>'sifatPekerjaan'), ''), 'MATERIAL'));
  code text := nullif(nullif(btrim(normalized->>'mtuCode'), ''), '-');
  qty_text text := nullif(btrim(normalized->>'qty'), '');
  qty_value numeric;
  target_upt text := nullif(btrim(normalized->>'uptId'), '');
  target_ultg text := nullif(btrim(normalized->>'ultgId'), '');
  target_gi text := nullif(btrim(normalized->>'garduIndukId'), '');
  target_bay text := nullif(btrim(normalized->>'bayId'), '');
  target_gudang text := nullif(btrim(normalized->>'gudangId'), '');
  source_bay text := nullif(nullif(btrim(normalized->>'bayName'), ''), '-');
  source_has_location boolean := (
    nullif(nullif(btrim(normalized->>'giName'), ''), '-') is not null
    or nullif(nullif(btrim(normalized->>'bayName'), ''), '-') is not null
    or nullif(nullif(btrim(normalized->>'location'), ''), '-') is not null
  );
begin
  if sifat not in ('MATERIAL', 'SUPERVISI') then
    errors := errors || 'MTU_SIFAT_INVALID';
  end if;

  if sifat = 'MATERIAL' and code is null then
    errors := errors || 'MTU_CODE_REQUIRED';
  end if;

  if qty_text is not null then
    if qty_text !~ '^[[:space:]]*[+-]?([0-9]+([.][0-9]+)?|[.][0-9]+)[[:space:]]*$' then
      errors := errors || 'MTU_QTY_INVALID';
    else
      begin
        qty_value := qty_text::numeric;
        if qty_value < 0 then errors := errors || 'MTU_QTY_INVALID'; end if;
      exception when others then
        errors := errors || 'MTU_QTY_INVALID';
      end;
    end if;
  end if;

  if target_upt is null or not exists (select 1 from public.upt where id = target_upt) then
    errors := errors || 'MTU_MAPPING_REQUIRED:UPT';
  elsif p_batch_uit_id is not null and not exists (
    select 1 from public.upt where id = target_upt and uit_id = p_batch_uit_id
  ) then
    errors := errors || 'MTU_HIERARCHY_INVALID:UPT_UIT';
  end if;

  if target_ultg is not null and not exists (
    select 1 from public.ultg where id = target_ultg and upt_id = target_upt
  ) then
    errors := errors || 'MTU_HIERARCHY_INVALID:ULTG';
  end if;

  -- A Bay carries its parent GI. Gudang is a mutually exclusive physical target.
  if target_gudang is not null and (target_gi is not null or target_bay is not null) then
    errors := errors || 'MTU_TARGET_EXCLUSIVE:GUDANG';
  end if;
  if source_has_location and target_gi is null and target_bay is null and target_gudang is null then
    errors := errors || 'MTU_MAPPING_REQUIRED:SITE';
  end if;
  if source_bay is not null and upper(source_bay) <> 'SPARE' and target_bay is null and target_gudang is null then
    errors := errors || 'MTU_MAPPING_REQUIRED:BAY';
  end if;

  if target_gi is not null then
    if target_ultg is null then
      errors := errors || 'MTU_MAPPING_REQUIRED:ULTG';
    elsif not exists (
      select 1 from public.mtu_khs_gardu_induk gi
      where gi.id = target_gi and gi.upt_id = target_upt and gi.ultg_id = target_ultg
    ) then
      errors := errors || 'MTU_HIERARCHY_INVALID:GI';
    end if;
  end if;

  if target_bay is not null then
    if target_gi is null then
      errors := errors || 'MTU_MAPPING_REQUIRED:GI';
    elsif not exists (
      select 1
      from public.mtu_khs_gardu_induk_bay bay
      join public.mtu_khs_gardu_induk gi on gi.id = bay.gardu_induk_id
      where bay.id = target_bay and gi.id = target_gi and gi.upt_id = target_upt
    ) then
      errors := errors || 'MTU_HIERARCHY_INVALID:BAY';
    end if;
  end if;

  if target_gudang is not null and not exists (
    select 1 from public.gudang where id = target_gudang and upt_id = target_upt
  ) then
    errors := errors || 'MTU_HIERARCHY_INVALID:GUDANG';
  end if;

  -- Optional references never block review/commit and are never auto-created.
  if nullif(btrim(normalized->>'provider'), '') is not null and nullif(btrim(normalized->>'supplierId'), '') is null then
    warnings := warnings || 'MTU_MAPPING_REQUIRED:SUPPLIER';
  elsif nullif(btrim(normalized->>'supplierId'), '') is not null and not exists (
    select 1 from public.supplier where id = normalized->>'supplierId'
  ) then
    warnings := warnings || 'MTU_MAPPING_INVALID:SUPPLIER';
  end if;
  if code is not null and nullif(btrim(normalized->>'mtuSpecId'), '') is null then
    warnings := warnings || 'MTU_MAPPING_REQUIRED:SPEC';
  elsif nullif(btrim(normalized->>'mtuSpecId'), '') is not null and not exists (
    select 1 from public.mtu_khs_specs where id = normalized->>'mtuSpecId'
  ) then
    warnings := warnings || 'MTU_MAPPING_INVALID:SPEC';
  end if;
  if code is not null and nullif(btrim(normalized->>'katalogId'), '') is null then
    warnings := warnings || 'MTU_MAPPING_REQUIRED:KATALOG';
  elsif nullif(btrim(normalized->>'katalogId'), '') is not null and not exists (
    select 1 from public.katalog where id = normalized->>'katalogId'
  ) then
    warnings := warnings || 'MTU_MAPPING_INVALID:KATALOG';
  end if;

  return jsonb_build_object('errors', to_jsonb(errors), 'warnings', to_jsonb(warnings));
end;
$$;

revoke all on function public.mtu_khs_validate_import_row(jsonb, text) from public;

create or replace function public.mtu_khs_stage_import(p_batch_id text, p_procurement_year integer, p_uit_id text, p_source_file text, p_file_sha256 text, p_sheet_name text, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public
as $$
declare actor public.profiles; row_item jsonb; n integer := 0; issues jsonb; normalized jsonb; source_row integer;
begin
  select * into actor from public.profiles where id = auth.uid();
  if actor.id is null or actor.role not in ('SUPERADMIN','PENGADAAN','ADMIN_LOG_PUSAT') then raise exception 'MTU_SCOPE_DENIED'; end if;
  if coalesce(btrim(p_file_sha256), '') !~ '^[0-9a-fA-F]{64}$' then raise exception 'MTU_IMPORT_PROVENANCE_INVALID'; end if;
  if nullif(btrim(p_sheet_name), '') is null then raise exception 'MTU_IMPORT_PROVENANCE_INVALID'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'MTU_IMPORT_PROVENANCE_INVALID'; end if;
  if jsonb_array_length(p_rows) = 0 then raise exception 'MTU_IMPORT_PROVENANCE_INVALID'; end if;
  if p_uit_id is not null and not exists (select 1 from public.uit where id = p_uit_id) then raise exception 'MTU_SCOPE_DENIED'; end if;
  if exists (select 1 from public.mtu_khs_import_batches where file_sha256 = coalesce(p_file_sha256,'') and sheet_name = coalesce(p_sheet_name,'')) then raise exception 'MTU_IMPORT_ALREADY_STAGED'; end if;
  insert into public.mtu_khs_import_batches(id, procurement_year, uit_id, source_file, file_sha256, sheet_name, status, created_by)
  values (p_batch_id, p_procurement_year, p_uit_id, p_source_file, coalesce(p_file_sha256,''), coalesce(p_sheet_name,''), 'REVIEW', auth.uid());
  for row_item in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    if coalesce(row_item->>'rawRowSha256', '') !~ '^[0-9a-fA-F]{64}$' then raise exception 'MTU_IMPORT_PROVENANCE_INVALID'; end if;
    normalized := coalesce(row_item->'source','{}'::jsonb);
    issues := public.mtu_khs_validate_import_row(normalized, p_uit_id);
    source_row := case when row_item->>'rowNumber' ~ '^[0-9]+$' then (row_item->>'rowNumber')::integer else n end;
    insert into public.mtu_khs_import_rows(id, batch_id, source_row, raw_data, normalized_data, validation_errors, validation_warnings, duplicate_candidate, raw_row_sha256)
    values (p_batch_id || '-' || n::text, p_batch_id, source_row, coalesce(row_item->'rawData','{}'::jsonb), normalized, coalesce(issues->'errors','[]'::jsonb), coalesce(issues->'warnings','[]'::jsonb), coalesce((row_item->>'duplicateCandidate')::boolean,false), coalesce(row_item->>'rawRowSha256',''));
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.mtu_khs_stage_import(text,integer,text,text,text,text,jsonb) from public;
grant execute on function public.mtu_khs_stage_import(text,integer,text,text,text,text,jsonb) to authenticated;

create or replace function public.mtu_khs_update_import_row_mapping(p_row_id text, p_mapping jsonb)
returns public.mtu_khs_import_rows language plpgsql security definer set search_path = public
as $$
declare row_item public.mtu_khs_import_rows; batch_item public.mtu_khs_import_batches; actor public.profiles; merged jsonb; issues jsonb;
begin
  select * into row_item from public.mtu_khs_import_rows where id = p_row_id for update;
  if not found then raise exception 'MTU_IMPORT_ROW_NOT_FOUND'; end if;
  select * into batch_item from public.mtu_khs_import_batches where id = row_item.batch_id for update;
  if not found then raise exception 'MTU_IMPORT_NOT_FOUND'; end if;
  select * into actor from public.profiles where id = auth.uid();
  if actor.id is null or actor.role not in ('SUPERADMIN','PENGADAAN','ADMIN_LOG_PUSAT','ASMAN_LOG_UIT') then raise exception 'MTU_SCOPE_DENIED'; end if;
  if actor.role = 'ASMAN_LOG_UIT' and actor.uit_id is distinct from batch_item.uit_id then raise exception 'MTU_SCOPE_DENIED'; end if;
  if batch_item.status not in ('STAGED','REVIEW') then raise exception 'MTU_IMPORT_ALREADY_COMMITTED'; end if;
  if p_mapping is not null and jsonb_typeof(p_mapping) <> 'object' then raise exception 'MTU_MAPPING_INVALID'; end if;
  merged := row_item.normalized_data || coalesce(p_mapping, '{}'::jsonb);
  issues := public.mtu_khs_validate_import_row(merged, batch_item.uit_id);
  update public.mtu_khs_import_rows
  set normalized_data = merged, validation_errors = coalesce(issues->'errors','[]'::jsonb), validation_warnings = coalesce(issues->'warnings','[]'::jsonb)
  where id = row_item.id returning * into row_item;
  return row_item;
end;
$$;

revoke all on function public.mtu_khs_update_import_row_mapping(text,jsonb) from public;
grant execute on function public.mtu_khs_update_import_row_mapping(text,jsonb) to authenticated;

create or replace function public.mtu_khs_commit_import(p_batch_id text, p_idempotency_key text)
returns integer language plpgsql security definer set search_path = public
as $$
declare b public.mtu_khs_import_batches; row_item record; inserted_count integer := 0; issues jsonb; qty_value numeric;
begin
  select * into b from public.mtu_khs_import_batches where id = p_batch_id for update;
  if not found then raise exception 'MTU_IMPORT_NOT_FOUND'; end if;
  if b.committed_at is not null then
    if b.commit_idempotency_key = p_idempotency_key then return coalesce((b.summary->>'committedCount')::integer, 0); end if;
    raise exception 'MTU_IMPORT_ALREADY_COMMITTED';
  end if;
  if b.status <> 'APPROVED' then raise exception 'MTU_APPROVER_INVALID'; end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('SUPERADMIN','PENGADAAN','ADMIN_LOG_PUSAT')) then raise exception 'MTU_APPROVER_INVALID'; end if;
  for row_item in select * from public.mtu_khs_import_rows where batch_id = b.id order by source_row for update loop
    issues := public.mtu_khs_validate_import_row(row_item.normalized_data, b.uit_id);
    update public.mtu_khs_import_rows
    set validation_errors = coalesce(issues->'errors','[]'::jsonb), validation_warnings = coalesce(issues->'warnings','[]'::jsonb)
    where id = row_item.id;
    if jsonb_array_length(coalesce(issues->'errors','[]'::jsonb)) > 0 then raise exception 'MTU_MAPPING_REQUIRED'; end if;
    qty_value := case when nullif(btrim(row_item.normalized_data->>'qty'),'') is null then 0 else (row_item.normalized_data->>'qty')::numeric end;
    insert into public.mtu_khs_records(id, upt_id, ultg_id, gardu_induk_id, bay_id, gudang_id, mtu_spec_id, katalog_id, supplier_id, procurement_year, sifat_pekerjaan, qty, data, created_by)
    values (
      'MTU-' || gen_random_uuid()::text,
      row_item.normalized_data->>'uptId',
      nullif(row_item.normalized_data->>'ultgId',''),
      nullif(row_item.normalized_data->>'garduIndukId',''),
      nullif(row_item.normalized_data->>'bayId',''),
      nullif(row_item.normalized_data->>'gudangId',''),
      case when exists (select 1 from public.mtu_khs_specs where id = nullif(row_item.normalized_data->>'mtuSpecId','')) then nullif(row_item.normalized_data->>'mtuSpecId','') else null end,
      case when exists (select 1 from public.katalog where id = nullif(row_item.normalized_data->>'katalogId','')) then nullif(row_item.normalized_data->>'katalogId','') else null end,
      case when exists (select 1 from public.supplier where id = nullif(row_item.normalized_data->>'supplierId','')) then nullif(row_item.normalized_data->>'supplierId','') else null end,
      b.procurement_year,
      coalesce(row_item.normalized_data->>'sifatPekerjaan','MATERIAL'),
      case when coalesce(row_item.normalized_data->>'sifatPekerjaan','MATERIAL') = 'SUPERVISI' then 0 else qty_value end,
      row_item.normalized_data,
      auth.uid()
    );
    inserted_count := inserted_count + 1;
  end loop;
  update public.mtu_khs_import_batches set status = 'APPROVED', committed_at = now(), commit_idempotency_key = p_idempotency_key, summary = summary || jsonb_build_object('committedCount', inserted_count) where id = b.id;
  return inserted_count;
end;
$$;

revoke all on function public.mtu_khs_commit_import(text, text) from public;
grant execute on function public.mtu_khs_commit_import(text, text) to authenticated;

commit;
