-- BA Non Stock: draft parsial dan TL sebagai pembuat/pengaju.
-- Proposal migration. Jangan apply ke production tanpa persetujuan user.

alter table public.ba_non_stock_items
  alter column material_name drop not null,
  alter column qty drop not null,
  alter column unit drop not null;
alter table public.ba_non_stock_items drop constraint if exists ba_non_stock_items_qty_check;
alter table public.ba_non_stock_items
  add constraint ba_non_stock_items_qty_check check (qty is null or qty > 0);

create or replace function public.save_ba_non_stock_draft(
  p_id text,
  p_expected_version integer,
  p_upt_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  actor public.profiles;
  old_row public.ba_non_stock;
  payload jsonb := coalesce(p_payload, '{}'::jsonb);
  item jsonb;
  item_no integer := 0;
  item_name text;
  item_unit text;
  item_description text;
  item_qty numeric;
  item_qty_text text;
  next_version integer;
  next_kind text := upper(btrim(coalesce(payload->>'kind', 'NON_STOCK')));
  next_date date;
begin
  select * into actor from public.profiles where id = auth.uid();
  if actor.id is null then raise exception 'BA_AUTH_REQUIRED'; end if;
  if actor.role not in ('ADMIN', 'TL', 'SUPERADMIN') then raise exception 'BA_ROLE_DENIED'; end if;
  if p_id is null or btrim(p_id) = '' or p_upt_id is null or btrim(p_upt_id) = '' then raise exception 'BA_REQUIRED_FIELD'; end if;
  if actor.role <> 'SUPERADMIN' and actor.upt_id is distinct from p_upt_id then raise exception 'BA_SCOPE_DENIED'; end if;
  if not public.can_access_upt(p_upt_id) then raise exception 'BA_SCOPE_DENIED'; end if;
  if jsonb_typeof(payload) <> 'object' or public.ba_non_stock_payload_has_data_url(payload) then raise exception 'BA_PHOTO_NOT_STORED'; end if;
  if next_kind not in ('NON_STOCK', 'PINJAM') then raise exception 'BA_REQUIRED_FIELD'; end if;
  if payload ? 'issueDate' and nullif(btrim(payload->>'issueDate'), '') is not null then
    if payload->>'issueDate' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'BA_REQUIRED_FIELD'; end if;
    next_date := (payload->>'issueDate')::date;
  end if;

  select * into old_row from public.ba_non_stock where id = p_id for update;
  if old_row.id is null then
    if p_expected_version is not null then raise exception 'BA_NOT_FOUND'; end if;
    insert into public.ba_non_stock (
      id, upt_id, kind, stage, status, version, warehouse_id, security_guard_id, issue_date,
      sender, destination_unit, reference_document, purpose, recipient_name, recipient_title,
      recipient_unit, driver_name, vehicle_number, photo_label_url, photo_loaded_url, created_by
    ) values (
      p_id, p_upt_id, next_kind, 'DRAFT', 'DRAFT', 1,
      nullif(btrim(coalesce(payload->>'warehouseId', payload->>'gudangId', '')), ''),
      nullif(btrim(coalesce(payload->>'securityGuardId', payload->>'satpamId', '')), ''), next_date,
      nullif(btrim(coalesce(payload->>'sender', payload->>'source', '')), ''),
      nullif(btrim(coalesce(payload->>'destinationUnit', payload->>'unitTujuan', '')), ''),
      nullif(btrim(coalesce(payload->>'referenceDocument', payload->>'reference', payload->>'referensi', '')), ''),
      nullif(btrim(coalesce(payload->>'purpose', payload->>'keperluan', '')), ''),
      nullif(btrim(coalesce(payload->>'recipientName', payload->>'penerimaNama', '')), ''),
      nullif(btrim(coalesce(payload->>'recipientTitle', payload->>'penerimaJabatan', '')), ''),
      nullif(btrim(coalesce(payload->>'recipientUnit', payload->>'penerimaUnit', '')), ''),
      nullif(btrim(coalesce(payload->>'driverName', payload->>'namaPengemudi', '')), ''),
      nullif(btrim(coalesce(payload->>'vehicleNumber', payload->>'nomorKendaraan', '')), ''),
      nullif(btrim(coalesce(payload->>'photoLabelUrl', payload->>'photoLabelPath', '')), ''),
      nullif(btrim(coalesce(payload->>'photoLoadedUrl', payload->>'photoLoadedPath', '')), ''), auth.uid()
    );
    next_version := 1;
  else
    if old_row.upt_id is distinct from p_upt_id then raise exception 'BA_SCOPE_DENIED'; end if;
    if p_expected_version is null or old_row.version <> p_expected_version then raise exception 'BA_VERSION_MISMATCH'; end if;
    if old_row.stage not in ('DRAFT', 'REJECTED') then raise exception 'BA_STAGE_INVALID'; end if;
    if old_row.created_by <> auth.uid() and actor.role <> 'SUPERADMIN' then raise exception 'BA_ROLE_DENIED'; end if;
    update public.ba_non_stock set
      kind = next_kind, stage = 'DRAFT', status = 'DRAFT',
      warehouse_id = nullif(btrim(coalesce(payload->>'warehouseId', payload->>'gudangId', '')), ''),
      security_guard_id = nullif(btrim(coalesce(payload->>'securityGuardId', payload->>'satpamId', '')), ''), issue_date = next_date,
      sender = nullif(btrim(coalesce(payload->>'sender', payload->>'source', '')), ''), destination_unit = nullif(btrim(coalesce(payload->>'destinationUnit', payload->>'unitTujuan', '')), ''),
      reference_document = nullif(btrim(coalesce(payload->>'referenceDocument', payload->>'reference', payload->>'referensi', '')), ''), purpose = nullif(btrim(coalesce(payload->>'purpose', payload->>'keperluan', '')), ''),
      recipient_name = nullif(btrim(coalesce(payload->>'recipientName', payload->>'penerimaNama', '')), ''), recipient_title = nullif(btrim(coalesce(payload->>'recipientTitle', payload->>'penerimaJabatan', '')), ''),
      recipient_unit = nullif(btrim(coalesce(payload->>'recipientUnit', payload->>'penerimaUnit', '')), ''), driver_name = nullif(btrim(coalesce(payload->>'driverName', payload->>'namaPengemudi', '')), ''),
      vehicle_number = nullif(btrim(coalesce(payload->>'vehicleNumber', payload->>'nomorKendaraan', '')), ''), photo_label_url = nullif(btrim(coalesce(payload->>'photoLabelUrl', payload->>'photoLabelPath', '')), ''),
      photo_loaded_url = nullif(btrim(coalesce(payload->>'photoLoadedUrl', payload->>'photoLoadedPath', '')), ''), rejected_by = null, rejected_at = null, rejection_reason = null,
      version = version + 1, updated_at = now()
    where id = p_id returning version into next_version;
  end if;

  delete from public.ba_non_stock_items where ba_id = p_id;
  if jsonb_typeof(payload->'items') = 'array' then
    for item in select value from jsonb_array_elements(payload->'items') loop
      item_no := item_no + 1;
      item_name := nullif(btrim(coalesce(item->>'materialName', item->>'name', '')), '');
      item_unit := nullif(btrim(coalesce(item->>'unit', item->>'satuan', '')), '');
      item_description := btrim(coalesce(item->>'description', item->>'keterangan', ''));
      item_qty_text := nullif(btrim(coalesce(item->>'qty', '')), '');
      if item_name is null and item_unit is null and item_qty_text is null and item_description = '' then continue; end if;
      if item_qty_text is not null and item_qty_text !~ '^[+]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$' then raise exception 'BA_ITEM_INVALID'; end if;
      item_qty := case when item_qty_text is null then null else item_qty_text::numeric end;
      if item_qty is not null and item_qty <= 0 then raise exception 'BA_ITEM_INVALID'; end if;
      insert into public.ba_non_stock_items(ba_id, line_no, material_name, qty, unit, description)
      values (p_id, item_no, item_name, item_qty, item_unit, item_description);
    end loop;
  end if;
  update public.ba_non_stock set updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'version', next_version, 'stage', 'DRAFT', 'status', 'DRAFT');
end
$$;

create or replace function public.submit_ba_non_stock(p_id text, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog
as $$
declare actor public.profiles; row public.ba_non_stock; guard_data jsonb;
begin
  select * into actor from public.profiles where id = auth.uid();
  if actor.id is null then raise exception 'BA_AUTH_REQUIRED'; end if;
  if actor.role not in ('ADMIN', 'TL', 'SUPERADMIN') then raise exception 'BA_ROLE_DENIED'; end if;
  select * into row from public.ba_non_stock where id = p_id for update;
  if row.id is null then raise exception 'BA_NOT_FOUND'; end if;
  if actor.role <> 'SUPERADMIN' and actor.upt_id is distinct from row.upt_id then raise exception 'BA_SCOPE_DENIED'; end if;
  if p_expected_version is null or row.version <> p_expected_version then raise exception 'BA_VERSION_MISMATCH'; end if;
  if row.created_by <> auth.uid() and actor.role <> 'SUPERADMIN' then raise exception 'BA_ROLE_DENIED'; end if;
  if row.stage <> 'DRAFT' or row.status <> 'DRAFT' then raise exception 'BA_STAGE_INVALID'; end if;
  perform public.ba_non_stock_assert_complete(row);
  select data into guard_data from public.satpam where id = row.security_guard_id;
  update public.ba_non_stock set stage = 'PENDING_TL', status = 'PENDING', version = version + 1,
    recipient_snapshot = jsonb_build_object('name', row.recipient_name, 'title', row.recipient_title, 'unit', row.recipient_unit),
    security_guard_snapshot = coalesce(guard_data, '{}'::jsonb) || jsonb_build_object('id', row.security_guard_id),
    submitted_by = auth.uid(), submitted_at = now(), updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'version', row.version + 1, 'stage', 'PENDING_TL', 'status', 'PENDING');
end
$$;
