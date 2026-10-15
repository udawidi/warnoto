-- BA Pengeluaran Material Non Stock / Pinjam.
-- Applied and verified on self-host production on 2026-10-15.

create table if not exists public.ba_non_stock (
  id text primary key,
  upt_id text not null,
  kind text not null check (kind in ('NON_STOCK', 'PINJAM')),
  stage text not null default 'DRAFT' check (stage in ('DRAFT', 'PENDING_TL', 'APPROVED', 'REJECTED')),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED')),
  version integer not null default 1 check (version > 0),
  doc_number text unique,
  sequence_year integer,
  sequence_value bigint,
  warehouse_id text,
  security_guard_id text,
  issue_date date,
  sender text,
  destination_unit text,
  reference_document text,
  purpose text,
  recipient_name text,
  recipient_title text,
  recipient_unit text,
  driver_name text,
  vehicle_number text,
  photo_label_url text,
  photo_loaded_url text,
  recipient_snapshot jsonb not null default '{}'::jsonb,
  security_guard_snapshot jsonb not null default '{}'::jsonb,
  tl_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id) on delete restrict,
  submitted_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  rejected_by uuid references public.profiles(id) on delete set null,
  rejection_reason text,
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ba_non_stock_state_pair check (
    (stage = 'DRAFT' and status = 'DRAFT')
    or (stage = 'PENDING_TL' and status = 'PENDING')
    or (stage = 'APPROVED' and status = 'APPROVED')
    or (stage = 'REJECTED' and status = 'REJECTED')
  ),
  constraint ba_non_stock_sequence_pair check (
    (sequence_year is null and sequence_value is null)
    or (sequence_year is not null and sequence_value is not null and sequence_year >= 2000 and sequence_value > 0)
  ),
  constraint ba_non_stock_number_final check (status <> 'APPROVED' or (doc_number is not null and sequence_year is not null and sequence_value is not null))
);

create index if not exists ba_non_stock_scope_idx
  on public.ba_non_stock (upt_id, status, updated_at desc);
create index if not exists ba_non_stock_search_idx
  on public.ba_non_stock (doc_number, sender, recipient_name, reference_document);
create unique index if not exists ba_non_stock_sequence_unique_idx
  on public.ba_non_stock (upt_id, sequence_year, sequence_value)
  where sequence_year is not null and sequence_value is not null;

create table if not exists public.ba_non_stock_items (
  ba_id text not null references public.ba_non_stock(id) on delete cascade,
  line_no integer not null check (line_no > 0),
  material_name text not null,
  qty numeric not null check (qty > 0),
  unit text not null,
  description text not null default '',
  primary key (ba_id, line_no)
);

create index if not exists ba_non_stock_items_name_idx
  on public.ba_non_stock_items (lower(material_name));

create table if not exists public.ba_non_stock_counters (
  upt_id text not null,
  year integer not null check (year >= 2000),
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (upt_id, year)
);

alter table public.ba_non_stock enable row level security;
alter table public.ba_non_stock_items enable row level security;
alter table public.ba_non_stock_counters enable row level security;

drop policy if exists "Scoped read ba non stock" on public.ba_non_stock;
create policy "Scoped read ba non stock"
  on public.ba_non_stock for select to authenticated
  using (public.can_access_upt(upt_id));

drop policy if exists "Scoped read ba non stock items" on public.ba_non_stock_items;
create policy "Scoped read ba non stock items"
  on public.ba_non_stock_items for select to authenticated
  using (exists (
    select 1 from public.ba_non_stock b
    where b.id = ba_non_stock_items.ba_id
      and public.can_access_upt(b.upt_id)
  ));

revoke all on public.ba_non_stock from anon, authenticated;
revoke all on public.ba_non_stock_items from anon, authenticated;
revoke all on public.ba_non_stock_counters from anon, authenticated;
grant select on public.ba_non_stock, public.ba_non_stock_items to authenticated;

create or replace function public.ba_non_stock_payload_has_data_url(p_payload jsonb)
returns boolean
language sql immutable
as $$
  select coalesce(p_payload::text ~* 'data:', false)
$$;

create or replace function public.ba_non_stock_photo_path(p_photo text, p_id text)
returns text
language plpgsql immutable
as $$
declare
  v text := btrim(coalesce(p_photo, ''));
  p text;
begin
  if v = '' or v ~* '^data:' or v ~ '[.][.]' then return null; end if;
  if v ~* '^https://[^/]+/storage/v1/object/public/tug-photos/' then
    p := regexp_replace(v, '^https://[^/]+/storage/v1/object/public/tug-photos/', '', 'i');
  elsif v ~* '^tug-photos/' then
    p := regexp_replace(v, '^tug-photos/', '', 'i');
  else
    p := v;
  end if;
  if p !~ ('^ba-non-stock/' || regexp_replace(coalesce(p_id, ''), '[^A-Za-z0-9_-]', '', 'g') || '/(label|loaded)[.][A-Za-z0-9]+$') then
    return null;
  end if;
  return p;
end
$$;

create or replace function public.ba_non_stock_assert_complete(p_row public.ba_non_stock)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  label_path text;
  loaded_path text;
  satpam_row public.satpam;
begin
  if p_row.kind not in ('NON_STOCK', 'PINJAM')
     or p_row.issue_date is null
     or nullif(btrim(p_row.warehouse_id), '') is null
     or nullif(btrim(p_row.sender), '') is null
     or nullif(btrim(p_row.destination_unit), '') is null
     or nullif(btrim(p_row.reference_document), '') is null
     or nullif(btrim(p_row.purpose), '') is null
     or nullif(btrim(p_row.recipient_name), '') is null
     or nullif(btrim(p_row.recipient_title), '') is null
     or nullif(btrim(p_row.recipient_unit), '') is null then
    raise exception 'BA_REQUIRED_FIELD';
  end if;
  if not exists (select 1 from public.gudang g where g.id = p_row.warehouse_id and g.upt_id = p_row.upt_id) then
    raise exception 'BA_SCOPE_DENIED';
  end if;
  if nullif(btrim(p_row.security_guard_id), '') is null then raise exception 'BA_SATPAM_INVALID'; end if;
  select * into satpam_row from public.satpam s where s.id = p_row.security_guard_id;
  if satpam_row.id is null or satpam_row.data->>'gudangId' is distinct from p_row.warehouse_id then
    raise exception 'BA_SATPAM_INVALID';
  end if;
  if not exists (
    select 1 from public.ba_non_stock_items i
    where i.ba_id = p_row.id
      and nullif(btrim(i.material_name), '') is not null
      and i.qty > 0
      and nullif(btrim(i.unit), '') is not null
  ) or exists (
    select 1 from public.ba_non_stock_items i
    where i.ba_id = p_row.id
      and (nullif(btrim(i.material_name), '') is null or i.qty <= 0 or nullif(btrim(i.unit), '') is null)
  ) then
    raise exception 'BA_ITEM_INVALID';
  end if;
  label_path := public.ba_non_stock_photo_path(p_row.photo_label_url, p_row.id);
  loaded_path := public.ba_non_stock_photo_path(p_row.photo_loaded_url, p_row.id);
  if label_path is null or loaded_path is null then raise exception 'BA_PHOTO_REQUIRED'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'tug-photos' and name = label_path)
     or not exists (select 1 from storage.objects where bucket_id = 'tug-photos' and name = loaded_path) then
    raise exception 'BA_PHOTO_NOT_STORED';
  end if;
end
$$;

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
  next_version integer;
  next_stage text := 'DRAFT';
  next_status text := 'DRAFT';
  next_kind text := upper(btrim(coalesce(payload->>'kind', 'NON_STOCK')));
  next_date date;
begin
  select * into actor from public.profiles where id = auth.uid();
  if actor.id is null then raise exception 'BA_AUTH_REQUIRED'; end if;
  if actor.role not in ('ADMIN', 'SUPERADMIN') then raise exception 'BA_ROLE_DENIED'; end if;
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
      p_id, p_upt_id, next_kind, next_stage, next_status, 1,
      nullif(btrim(coalesce(payload->>'warehouseId', payload->>'gudangId', '')), ''),
      nullif(btrim(coalesce(payload->>'securityGuardId', payload->>'satpamId', '')), ''),
      next_date,
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
      nullif(btrim(coalesce(payload->>'photoLoadedUrl', payload->>'photoLoadedPath', '')), ''),
      auth.uid()
    );
    next_version := 1;
  else
    if p_expected_version is null or old_row.version <> p_expected_version then raise exception 'BA_VERSION_MISMATCH'; end if;
    if old_row.stage not in ('DRAFT', 'REJECTED') then raise exception 'BA_STAGE_INVALID'; end if;
    if old_row.created_by <> auth.uid() and actor.role <> 'SUPERADMIN' then raise exception 'BA_ROLE_DENIED'; end if;
    update public.ba_non_stock set
      kind = next_kind,
      stage = next_stage,
      status = next_status,
      warehouse_id = nullif(btrim(coalesce(payload->>'warehouseId', payload->>'gudangId', '')), ''),
      security_guard_id = nullif(btrim(coalesce(payload->>'securityGuardId', payload->>'satpamId', '')), ''),
      issue_date = next_date,
      sender = nullif(btrim(coalesce(payload->>'sender', payload->>'source', '')), ''),
      destination_unit = nullif(btrim(coalesce(payload->>'destinationUnit', payload->>'unitTujuan', '')), ''),
      reference_document = nullif(btrim(coalesce(payload->>'referenceDocument', payload->>'reference', payload->>'referensi', '')), ''),
      purpose = nullif(btrim(coalesce(payload->>'purpose', payload->>'keperluan', '')), ''),
      recipient_name = nullif(btrim(coalesce(payload->>'recipientName', payload->>'penerimaNama', '')), ''),
      recipient_title = nullif(btrim(coalesce(payload->>'recipientTitle', payload->>'penerimaJabatan', '')), ''),
      recipient_unit = nullif(btrim(coalesce(payload->>'recipientUnit', payload->>'penerimaUnit', '')), ''),
      driver_name = nullif(btrim(coalesce(payload->>'driverName', payload->>'namaPengemudi', '')), ''),
      vehicle_number = nullif(btrim(coalesce(payload->>'vehicleNumber', payload->>'nomorKendaraan', '')), ''),
      photo_label_url = nullif(btrim(coalesce(payload->>'photoLabelUrl', payload->>'photoLabelPath', '')), ''),
      photo_loaded_url = nullif(btrim(coalesce(payload->>'photoLoadedUrl', payload->>'photoLoadedPath', '')), ''),
      version = version + 1,
      updated_at = now()
    where id = p_id
    returning version into next_version;
  end if;

  delete from public.ba_non_stock_items where ba_id = p_id;
  if jsonb_typeof(payload->'items') = 'array' then
    for item in select value from jsonb_array_elements(payload->'items') loop
      item_no := item_no + 1;
      item_name := nullif(btrim(coalesce(item->>'materialName', item->>'name', '')), '');
      item_unit := nullif(btrim(coalesce(item->>'unit', item->>'satuan', '')), '');
      item_description := btrim(coalesce(item->>'description', item->>'keterangan', ''));
      if nullif(btrim(coalesce(item->>'materialName', item->>'name', '')), '') is null
         and nullif(btrim(coalesce(item->>'qty', '')), '') is null
         and nullif(btrim(coalesce(item->>'unit', item->>'satuan', '')), '') is null
         and item_description = '' then
        continue;
      end if;
      if item_name is null or item_unit is null or item->>'qty' is null or item->>'qty' !~ '^[+]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$' then raise exception 'BA_ITEM_INVALID'; end if;
      item_qty := (item->>'qty')::numeric;
      if item_qty <= 0 then raise exception 'BA_ITEM_INVALID'; end if;
      insert into public.ba_non_stock_items(ba_id, line_no, material_name, qty, unit, description)
      values (p_id, item_no, item_name, item_qty, item_unit, item_description);
    end loop;
  end if;
  update public.ba_non_stock set updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'version', next_version, 'stage', next_stage, 'status', next_status);
end
$$;

create or replace function public.submit_ba_non_stock(
  p_id text,
  p_expected_version integer
)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  actor public.profiles;
  row public.ba_non_stock;
  guard_data jsonb;
begin
  select * into actor from public.profiles where id = auth.uid();
  if actor.id is null then raise exception 'BA_AUTH_REQUIRED'; end if;
  if actor.role not in ('ADMIN', 'SUPERADMIN') then raise exception 'BA_ROLE_DENIED'; end if;
  select * into row from public.ba_non_stock where id = p_id for update;
  if row.id is null then raise exception 'BA_NOT_FOUND'; end if;
  if p_expected_version is null or row.version <> p_expected_version then raise exception 'BA_VERSION_MISMATCH'; end if;
  if row.created_by <> auth.uid() and actor.role <> 'SUPERADMIN' then raise exception 'BA_ROLE_DENIED'; end if;
  if row.stage <> 'DRAFT' or row.status <> 'DRAFT' then raise exception 'BA_STAGE_INVALID'; end if;
  perform public.ba_non_stock_assert_complete(row);
  select data into guard_data from public.satpam where id = row.security_guard_id;
  update public.ba_non_stock set
    stage = 'PENDING_TL', status = 'PENDING', version = version + 1,
    recipient_snapshot = jsonb_build_object('name', row.recipient_name, 'title', row.recipient_title, 'unit', row.recipient_unit),
    security_guard_snapshot = coalesce(guard_data, '{}'::jsonb) || jsonb_build_object('id', row.security_guard_id),
    submitted_by = auth.uid(), submitted_at = now(), updated_at = now()
  where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'version', row.version + 1, 'stage', 'PENDING_TL', 'status', 'PENDING');
end
$$;

create or replace function public.decide_ba_non_stock(
  p_id text,
  p_expected_version integer,
  p_decision text,
  p_reason text
)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  actor public.profiles;
  row public.ba_non_stock;
  decision text := upper(btrim(coalesce(p_decision, '')));
  year_no integer := extract(year from clock_timestamp())::integer;
  month_no text := to_char(clock_timestamp(), 'MM');
  next_seq bigint;
  doc_no text;
begin
  select * into actor from public.profiles where id = auth.uid();
  if actor.id is null then raise exception 'BA_AUTH_REQUIRED'; end if;
  if actor.role not in ('TL', 'SUPERADMIN') then raise exception 'BA_ROLE_DENIED'; end if;
  select * into row from public.ba_non_stock where id = p_id for update;
  if row.id is null then raise exception 'BA_NOT_FOUND'; end if;
  if actor.role = 'TL' and actor.upt_id is distinct from row.upt_id then raise exception 'BA_SCOPE_DENIED'; end if;
  if p_expected_version is null or row.version <> p_expected_version then raise exception 'BA_VERSION_MISMATCH'; end if;
  if row.stage <> 'PENDING_TL' or row.status <> 'PENDING' then raise exception 'BA_STAGE_INVALID'; end if;
  if decision not in ('APPROVE', 'REJECT') then raise exception 'BA_REQUIRED_FIELD'; end if;
  if decision = 'REJECT' then
    if nullif(btrim(p_reason), '') is null then raise exception 'BA_REJECT_REASON_REQUIRED'; end if;
    update public.ba_non_stock set
      stage = 'REJECTED', status = 'REJECTED', version = version + 1,
      rejected_by = auth.uid(), rejection_reason = btrim(p_reason), rejected_at = now(), updated_at = now()
    where id = p_id;
    return jsonb_build_object('ok', true, 'id', p_id, 'version', row.version + 1, 'stage', 'REJECTED', 'status', 'REJECTED', 'docNumber', row.doc_number);
  end if;

  perform public.ba_non_stock_assert_complete(row);
  insert into public.ba_non_stock_counters(upt_id, year, last_value, updated_at)
  values (row.upt_id, year_no, 1, now())
  on conflict (upt_id, year) do update set last_value = public.ba_non_stock_counters.last_value + 1, updated_at = now()
  returning last_value into next_seq;
  doc_no := lpad(next_seq::text, 3, '0') || '.BA/' || row.upt_id || '/' || month_no || '/' || year_no::text;
  update public.ba_non_stock set
    stage = 'APPROVED', status = 'APPROVED', version = version + 1,
    doc_number = doc_no, sequence_year = year_no, sequence_value = next_seq,
    tl_snapshot = jsonb_build_object('id', actor.id, 'name', actor.name, 'title', actor.jabatan, 'role', actor.role, 'uptId', actor.upt_id),
    approved_by = auth.uid(), approved_at = now(), updated_at = now()
  where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'version', row.version + 1, 'stage', 'APPROVED', 'status', 'APPROVED', 'docNumber', doc_no);
end
$$;

revoke all on function public.ba_non_stock_payload_has_data_url(jsonb) from public, anon, authenticated;
revoke all on function public.ba_non_stock_photo_path(text, text) from public, anon, authenticated;
revoke all on function public.ba_non_stock_assert_complete(public.ba_non_stock) from public, anon, authenticated;
revoke all on function public.save_ba_non_stock_draft(text, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.submit_ba_non_stock(text, integer) from public, anon, authenticated;
revoke all on function public.decide_ba_non_stock(text, integer, text, text) from public, anon, authenticated;
grant execute on function public.save_ba_non_stock_draft(text, integer, text, jsonb) to authenticated;
grant execute on function public.submit_ba_non_stock(text, integer) to authenticated;
grant execute on function public.decide_ba_non_stock(text, integer, text, text) to authenticated;

