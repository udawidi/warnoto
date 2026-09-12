-- PROPOSAL ONLY: MTU KHS reconciliation and TUG-3 receipt integration.
-- Do not apply to production without explicit user approval.

alter table public.tug3_transactions
  add column if not exists mtu_record_id text references public.mtu_khs_records(id) on delete set null;
create index if not exists idx_tug3_transactions_mtu_record on public.tug3_transactions(mtu_record_id);
alter table public.stocks add column if not exists upt_id text;
create index if not exists idx_stocks_upt on public.stocks(upt_id);

create table if not exists public.mtu_khs_reconciliations (
  record_id text primary key references public.mtu_khs_records(id) on delete cascade,
  status text not null check (status in ('BELUM_DICEK', 'BELUM_TUG', 'SEBAGIAN', 'SUDAH_TUG')),
  note text not null default '',
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.mtu_khs_stock_links (
  id uuid primary key default gen_random_uuid(),
  mtu_record_id text not null references public.mtu_khs_records(id) on delete cascade,
  stock_id text not null references public.stocks(id) on delete restrict,
  qty numeric(18,4) not null check (qty > 0),
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mtu_record_id, stock_id)
);
alter table public.mtu_khs_stock_links add column if not exists updated_by uuid references auth.users(id);

create table if not exists public.mtu_khs_receipts (
  id uuid primary key default gen_random_uuid(),
  mtu_record_id text not null references public.mtu_khs_records(id) on delete restrict,
  tug3_transaction_id text not null references public.tug3_transactions(id) on delete restrict,
  qty numeric(18,4) not null check (qty > 0),
  items jsonb not null default '[]'::jsonb,
  applied_by uuid not null references auth.users(id),
  applied_at timestamptz not null default now(),
  idempotency_key text not null,
  unique (tug3_transaction_id),
  unique (idempotency_key)
);
create index if not exists idx_mtu_khs_receipts_record on public.mtu_khs_receipts(mtu_record_id, applied_at);

alter table public.mtu_khs_reconciliations enable row level security;
alter table public.mtu_khs_stock_links enable row level security;
alter table public.mtu_khs_receipts enable row level security;

drop policy if exists "MTU KHS reconciliation scoped" on public.mtu_khs_reconciliations;
create policy "MTU KHS reconciliation scoped" on public.mtu_khs_reconciliations
  for select using (exists (select 1 from public.mtu_khs_records r where r.id = record_id and public.mtu_khs_can_access_upt(r.upt_id)));
drop policy if exists "MTU KHS stock links scoped" on public.mtu_khs_stock_links;
create policy "MTU KHS stock links scoped" on public.mtu_khs_stock_links
  for select using (exists (select 1 from public.mtu_khs_records r where r.id = mtu_record_id and public.mtu_khs_can_access_upt(r.upt_id)));
drop policy if exists "MTU KHS receipts scoped" on public.mtu_khs_receipts;
create policy "MTU KHS receipts scoped" on public.mtu_khs_receipts
  for select using (exists (select 1 from public.mtu_khs_records r where r.id = mtu_record_id and public.mtu_khs_can_access_upt(r.upt_id)));

revoke all on public.mtu_khs_reconciliations, public.mtu_khs_stock_links, public.mtu_khs_receipts from anon, authenticated;
grant select on public.mtu_khs_reconciliations, public.mtu_khs_stock_links, public.mtu_khs_receipts to authenticated;

create or replace function public.mtu_khs_set_reconciliation(
  p_record_id text,
  p_status text,
  p_note text default ''
) returns public.mtu_khs_reconciliations
language plpgsql security definer set search_path = public
as $$
declare r public.mtu_khs_records; a public.profiles; result public.mtu_khs_reconciliations;
begin
  select * into r from public.mtu_khs_records where id = p_record_id for update;
  select * into a from public.profiles where id = auth.uid();
  if not found or r.id is null or r.procurement_year <> 2024 or r.sifat_pekerjaan = 'SUPERVISI'
     or p_status not in ('BELUM_DICEK', 'BELUM_TUG', 'SEBAGIAN', 'SUDAH_TUG')
     or not public.mtu_khs_can_access_upt(r.upt_id)
     or not (a.role = 'SUPERADMIN' or (a.role = 'TL' and a.upt_id = r.upt_id)) then
    raise exception 'MTU_RECONCILIATION_FORBIDDEN' using errcode = '42501';
  end if;
  insert into public.mtu_khs_reconciliations(record_id, status, note, updated_by, updated_at)
  values (r.id, p_status, left(coalesce(p_note, ''), 2000), a.id, now())
  on conflict (record_id) do update set status = excluded.status, note = excluded.note,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at
  returning * into result;
  return result;
end;
$$;

create or replace function public.mtu_khs_link_stock(
  p_record_id text,
  p_stock_id text,
  p_qty numeric
) returns public.mtu_khs_stock_links
language plpgsql security definer set search_path = public
as $$
declare r public.mtu_khs_records; s public.stocks; a public.profiles; result public.mtu_khs_stock_links;
  max_qty numeric; linked_qty numeric;
begin
  select * into r from public.mtu_khs_records where id = p_record_id for update;
  select * into s from public.stocks where id = p_stock_id;
  select * into a from public.profiles where id = auth.uid();
  if r.id is null or s.id is null or p_qty is null or p_qty <= 0
     or r.procurement_year <> 2024 or r.sifat_pekerjaan = 'SUPERVISI'
     or r.katalog_id is null or s.katalog_id is distinct from r.katalog_id
     or coalesce(s.upt_id, (select g.upt_id from public.lokasi l join public.gudang g on g.id = l.gudang_id where l.id = s.lokasi_id)) <> r.upt_id
     or not exists (
       select 1 from public.lokasi l join public.gudang g on g.id = l.gudang_id
       where l.id = s.lokasi_id and g.upt_id = r.upt_id
     )
     or not public.mtu_khs_can_access_upt(r.upt_id)
     or not (a.role = 'SUPERADMIN' or (a.role = 'TL' and a.upt_id = r.upt_id)) then
    raise exception 'MTU_STOCK_REFERENCE_INVALID';
  end if;
  max_qty := greatest(0, coalesce(nullif(r.data->>'remainingQty','')::numeric,
    r.qty - coalesce(nullif(r.data->>'installedQty','')::numeric, 0)));
  select coalesce(sum(qty), 0) into linked_qty from public.mtu_khs_stock_links where mtu_record_id = r.id and stock_id <> s.id;
  if linked_qty + p_qty > max_qty then raise exception 'MTU_STOCK_REFERENCE_QTY_EXCEEDED'; end if;
  insert into public.mtu_khs_stock_links(mtu_record_id, stock_id, qty, created_by, updated_by)
  values (r.id, s.id, p_qty, a.id, a.id)
  on conflict (mtu_record_id, stock_id) do update set qty = excluded.qty, updated_by = excluded.updated_by, updated_at = now()
  returning * into result;
  return result;
end;
$$;

-- Keep the existing function signature while adding canonical TUG-8/9, UPT and
-- catalog checks. Usage links are references only and never touch stocks.
create or replace function public.mtu_khs_link_approved_tug(p_record_id text, p_tug_item_id uuid, p_qty numeric)
returns public.mtu_khs_usage_links language plpgsql security definer set search_path = public
as $$
declare r public.mtu_khs_records; i public.tug_items; t public.tug_transactions; result public.mtu_khs_usage_links;
begin
  select * into r from public.mtu_khs_records where id = p_record_id for update;
  select * into i from public.tug_items where id = p_tug_item_id;
  select * into t from public.tug_transactions where id = i.transaction_id;
  if r.id is null or i.id is null or t.id is null or r.sifat_pekerjaan = 'SUPERVISI' or not public.mtu_khs_can_access_upt(r.upt_id)
     or t.upt_id <> r.upt_id or t.doc_type not in ('TUG8','TUG9') or t.status <> 'FINAL_APPROVED'
     or i.katalog_id is distinct from r.katalog_id
     or not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('SUPERADMIN','PENGADAAN','TL')) then
    raise exception 'MTU_TUG_NOT_APPROVED';
  end if;
  if p_qty is null or p_qty <= 0 or p_qty > i.qty then raise exception 'MTU_TUG_NOT_APPROVED'; end if;
  if exists (select 1 from public.mtu_khs_usage_links where mtu_record_id = r.id and tug_item_id = p_tug_item_id::text) then raise exception 'MTU_TUG_NOT_APPROVED'; end if;
  if coalesce((select sum(qty) from public.mtu_khs_usage_links where mtu_record_id = r.id and status = 'APPROVED'),0) + p_qty > r.qty then raise exception 'MTU_TUG_NOT_APPROVED'; end if;
  insert into public.mtu_khs_usage_links(id, mtu_record_id, tug_item_id, qty, status, created_by, data)
  values ('MTU-USE-' || gen_random_uuid()::text, r.id, p_tug_item_id::text, p_qty, 'APPROVED', auth.uid(),
    jsonb_build_object('docNumber', t.doc_number, 'docType', t.doc_type, 'finalApprovedAt', t.final_approved_at,
      'katalogId', i.katalog_id, 'uptId', t.upt_id)) returning * into result;
  return result;
end;
$$;

-- Apply one final MTU-linked TUG-3/4 receipt atomically. The unique transaction
-- and idempotency keys make retries safe; stock is never changed by MTU UI code.
create or replace function public.mtu_khs_apply_tug3_receipt(
  p_tug3_transaction_id text,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare x public.tug3_transactions; r public.mtu_khs_records; a public.profiles; existing public.mtu_khs_receipts;
  item jsonb; items jsonb; item_qty numeric; total_qty numeric := 0; max_qty numeric; stock_row public.stocks;
  stock_id text; location_id text; catalog_id text; catalog_data jsonb; before_qty numeric; after_qty numeric; applied_items jsonb := '[]'::jsonb;
begin
  select * into x from public.tug3_transactions where id = p_tug3_transaction_id for update;
  select * into a from public.profiles where id = auth.uid();
  if x.id is null or x.mtu_record_id is null or a.role not in ('ASMAN','SUPERADMIN') then raise exception 'MTU_RECEIPT_FORBIDDEN' using errcode = '42501'; end if;
  select * into existing from public.mtu_khs_receipts where tug3_transaction_id = x.id or idempotency_key = p_idempotency_key limit 1;
  if existing.id is not null then return jsonb_build_object('receiptId', existing.id, 'deduped', true, 'qty', existing.qty); end if;
  select * into r from public.mtu_khs_records where id = x.mtu_record_id for update;
  if r.id is null or r.procurement_year <> 2026 or r.sifat_pekerjaan = 'SUPERVISI' or x.stage <> 'PENDING_ASMAN'
     or not public.mtu_khs_can_access_upt(r.upt_id) or (a.role <> 'SUPERADMIN' and a.upt_id <> r.upt_id) then
    raise exception 'MTU_RECEIPT_INVALID';
  end if;
  items := x.data->'stockItems';
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then raise exception 'TUG_ITEMS_REQUIRED'; end if;
  for item in select value from jsonb_array_elements(items) loop
    catalog_id := nullif(btrim(coalesce(item->>'katalogId', '')), '');
    location_id := nullif(btrim(coalesce(item->>'lokasiTujuanId', item->>'lokasiId', '')), '');
    if btrim(coalesce(item->>'qty', '')) !~ '^[0-9]+([.][0-9]{1,4})?$' then raise exception 'MTU_RECEIPT_ITEM_INVALID'; end if;
    item_qty := (item->>'qty')::numeric;
    if catalog_id is null or item_qty <= 0 or r.katalog_id is distinct from catalog_id
       or not exists (select 1 from public.katalog where id = catalog_id)
       or not exists (select 1 from public.lokasi l join public.gudang g on g.id = l.gudang_id where l.id = location_id and g.upt_id = r.upt_id) then
      raise exception 'MTU_RECEIPT_ITEM_INVALID';
    end if;
    total_qty := total_qty + item_qty;
  end loop;
  max_qty := greatest(0, r.qty - coalesce((select sum(qty) from public.mtu_khs_receipts where mtu_record_id = r.id), 0));
  if total_qty > max_qty then raise exception 'MTU_RECEIPT_QTY_EXCEEDED'; end if;
  for item in select value from jsonb_array_elements(items) loop
    catalog_id := nullif(btrim(item->>'katalogId'), '');
    location_id := nullif(btrim(coalesce(item->>'lokasiTujuanId', item->>'lokasiId', '')), '');
    select data into catalog_data from public.katalog where id = catalog_id;
    if btrim(coalesce(item->>'qty', '')) !~ '^[0-9]+([.][0-9]{1,4})?$' then raise exception 'MTU_RECEIPT_ITEM_INVALID'; end if;
    item_qty := (item->>'qty')::numeric;
    select * into stock_row from public.stocks where katalog_id = catalog_id and lokasi_id = location_id for update;
    if stock_row.id is null then
      stock_id := 'STK-MTU-' || md5(r.id || ':' || catalog_id || ':' || location_id);
      insert into public.stocks(id, katalog_id, lokasi_id, upt_id, data, created_at)
      values (stock_id, catalog_id, location_id, r.upt_id, jsonb_build_object(
        'name', coalesce(nullif(item->>'namaBaru',''), item->'snapshot'->>'name', item->'snapshot'->>'materialName', catalog_data->>'name', catalog_data->>'nama', ''),
        'katalog', coalesce(item->'snapshot'->>'katalog', nullif(item->>'katalogBaru',''), catalog_data->>'katalog', catalog_id),
        'unit', coalesce(nullif(item->>'satuanBaru',''), item->>'unit', item->'snapshot'->>'satuan', catalog_data->>'satuan', 'unit'),
        'qty', item_qty, 'price', coalesce(nullif(item->>'hargaSatuan','')::numeric, nullif(catalog_data->>'price','')::numeric, 0),
        'uptId', r.upt_id, 'mtuRecordId', r.id, 'mtuTug3Id', x.id, 'source', 'MTU_KHS_TUG3',
        'createdAt', extract(epoch from clock_timestamp()) * 1000),
        (extract(epoch from clock_timestamp()) * 1000)::bigint)
      returning * into stock_row;
      before_qty := 0;
    else
      stock_id := stock_row.id;
      before_qty := coalesce((stock_row.data->>'qty')::numeric, 0);
      update public.stocks set upt_id = coalesce(upt_id, r.upt_id), data = jsonb_set(coalesce(data, '{}'::jsonb), '{qty}', to_jsonb(before_qty + item_qty), true)
        || jsonb_build_object('uptId', r.upt_id, 'mtuRecordId', r.id, 'mtuTug3Id', x.id, 'source', 'MTU_KHS_TUG3')
      where id = stock_row.id;
    end if;
    after_qty := before_qty + item_qty;
    applied_items := applied_items || jsonb_build_array(jsonb_build_object('stockId', stock_id, 'katalogId', catalog_id,
      'lokasiId', location_id, 'qty', item_qty, 'beforeQty', before_qty, 'afterQty', after_qty));
  end loop;
  insert into public.mtu_khs_receipts(mtu_record_id, tug3_transaction_id, qty, items, applied_by, idempotency_key)
  values (r.id, x.id, total_qty, applied_items, a.id, p_idempotency_key)
  returning * into existing;
  update public.tug3_transactions set stage = 'APPROVED', status = 'APPROVED', data = data || jsonb_build_object('mtuReceiptId', existing.id, 'mtuReceiptAppliedAt', now()) , updated_at = (extract(epoch from clock_timestamp()) * 1000)::bigint where id = x.id;
  return jsonb_build_object('receiptId', existing.id, 'deduped', false, 'qty', total_qty, 'items', applied_items);
end;
$$;

do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('mtu_khs_set_reconciliation','mtu_khs_link_stock','mtu_khs_link_approved_tug','mtu_khs_apply_tug3_receipt')
  loop execute format('revoke all on function %s from public, anon, authenticated', f); end loop;
end $$;
grant execute on function public.mtu_khs_set_reconciliation(text,text,text), public.mtu_khs_link_stock(text,text,numeric), public.mtu_khs_link_approved_tug(text,uuid,numeric), public.mtu_khs_apply_tug3_receipt(text,text) to authenticated;

-- Preserve the deployed change-request contract while allowing catalog mapping
-- for 2026 records. The server, not the form, remains the source of truth.
create or replace function public.mtu_khs_submit_change(p_record_id text, p_expected_version integer, p_patch jsonb, p_idempotency_key text)
returns public.mtu_khs_change_requests
language plpgsql security definer set search_path = public
as $$
declare r public.mtu_khs_records; requester public.profiles; result public.mtu_khs_change_requests; target_role text; target_upt text; target_uit text; effective_gi text; effective_bay text;
begin
  select * into r from public.mtu_khs_records where id = p_record_id for update;
  if not found or not public.mtu_khs_can_access_upt(r.upt_id) then raise exception 'MTU_SCOPE_DENIED'; end if;
  if p_expected_version is null or p_expected_version <> r.version then raise exception 'MTU_VERSION_CONFLICT'; end if;
  effective_gi := case when p_patch ? 'garduIndukId' then nullif(p_patch->>'garduIndukId','') else r.gardu_induk_id end;
  effective_bay := case when p_patch ? 'bayId' then nullif(p_patch->>'bayId','') else r.bay_id end;
  if effective_gi is not null and not exists (select 1 from public.mtu_khs_gardu_induk gi where gi.id = effective_gi and gi.upt_id = r.upt_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if effective_bay is not null and not exists (select 1 from public.mtu_khs_gardu_induk_bay bay join public.mtu_khs_gardu_induk gi on gi.id = bay.gardu_induk_id where bay.id = effective_bay and gi.upt_id = r.upt_id and gi.id = effective_gi) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if p_patch ? 'gudangId' and not exists (select 1 from public.gudang g where g.id = p_patch->>'gudangId' and g.upt_id = r.upt_id) then raise exception 'MTU_HIERARCHY_INVALID'; end if;
  if coalesce(p_patch, '{}'::jsonb) ? 'katalogId'
     and not exists (select 1 from public.katalog k where k.id = nullif(btrim(p_patch->>'katalogId'), '')) then
    raise exception 'MTU_MAPPING_REQUIRED';
  end if;
  if exists (select 1 from public.mtu_khs_change_requests where record_id = r.id and patch->>'_idempotency_key' = p_idempotency_key) then select * into result from public.mtu_khs_change_requests where record_id = r.id and patch->>'_idempotency_key' = p_idempotency_key limit 1; return result; end if;
  select * into requester from public.profiles where id = auth.uid();
  if requester.role not in ('TL', 'PENGADAAN', 'SUPERADMIN') then raise exception 'Role tidak boleh mengajukan perubahan MTU'; end if;
  if requester.role = 'TL' and exists (select 1 from jsonb_object_keys(coalesce(p_patch,'{}'::jsonb)) key where key not in ('location','onsiteDate','garduIndukId','bayId','gudangId','serialNumber','installationStatus','installationPlanDate','installationDate','reason')) then raise exception 'MTU_FIELD_FORBIDDEN'; end if;
  if requester.role = 'PENGADAAN' and exists (select 1 from jsonb_object_keys(coalesce(p_patch,'{}'::jsonb)) key where key not in ('vendor','noKontrak','tanggalKontrak','noSpmk','tanggalSerahTerima','price','documentId','mtuCode','katalogId','reason')) then raise exception 'MTU_FIELD_FORBIDDEN'; end if;
  select u.uit_id into target_uit from public.upt u where u.id = r.upt_id;
  if requester.role = 'PENGADAAN' then target_role := 'ASMAN_LOG_UIT'; target_upt := null; else target_role := 'ASMAN'; target_upt := r.upt_id; end if;
  insert into public.mtu_khs_change_requests(id, record_id, requested_by, requester_role, approver_role, approver_upt_id, approver_uit_id, patch)
  values ('MTU-CHG-' || gen_random_uuid()::text, r.id, auth.uid(), requester.role, target_role, target_upt, target_uit, coalesce(p_patch, '{}'::jsonb) || jsonb_build_object('_idempotency_key', p_idempotency_key))
  returning * into result;
  return result;
end;
$$;

create or replace function public.mtu_khs_decide_change(p_change_id text, p_decision text, p_note text default '')
returns public.mtu_khs_change_requests
language plpgsql security definer set search_path = public
as $$
declare c public.mtu_khs_change_requests; r public.mtu_khs_records; p public.profiles; result public.mtu_khs_change_requests;
  new_data jsonb; source_row integer; source_hash text; source_key jsonb; sheet_name text;
begin
  if p_decision not in ('APPROVED', 'REJECTED') then raise exception 'Keputusan approval tidak valid'; end if;
  select * into c from public.mtu_khs_change_requests where id = p_change_id and status = 'PENDING' for update;
  if not found then raise exception 'Perubahan MTU tidak ditemukan atau sudah diputus'; end if;
  select * into r from public.mtu_khs_records where id = c.record_id for update;
  select * into p from public.profiles where id = auth.uid();
  if p.role <> 'SUPERADMIN' and c.approver_role = 'ASMAN' and not (p.role = 'ASMAN' and p.upt_id = c.approver_upt_id) then raise exception 'Bukan ASMAN UPT tujuan'; end if;
  if p.role <> 'SUPERADMIN' and c.approver_role = 'ASMAN_LOG_UIT' and not (p.role = 'ASMAN_LOG_UIT' and p.uit_id = c.approver_uit_id) then raise exception 'Bukan ASMAN_LOG_UIT tujuan'; end if;
  update public.mtu_khs_change_requests set status = p_decision, decision_note = p_note, decided_by = auth.uid(), decided_at = now() where id = c.id returning * into result;
  if p_decision = 'APPROVED' then
    new_data := r.data || (c.patch - '_idempotency_key');
    update public.mtu_khs_records set data = new_data, updated_at = now(), version = version + 1,
      katalog_id = case when c.patch ? 'katalogId' then nullif(btrim(c.patch->>'katalogId'), '') else katalog_id end,
      lifecycle_status = case when c.patch ? 'lifecycleStatus' then nullif(c.patch->>'lifecycleStatus','') else lifecycle_status end,
      gardu_induk_id = case when c.patch ? 'garduIndukId' then nullif(c.patch->>'garduIndukId','') else gardu_induk_id end,
      bay_id = case when c.patch ? 'bayId' then nullif(c.patch->>'bayId','') else bay_id end,
      gudang_id = case when c.patch ? 'gudangId' then nullif(c.patch->>'gudangId','') else gudang_id end
    where id = r.id and version = r.version;
    if not found then raise exception 'MTU_VERSION_CONFLICT'; end if;
    source_row := nullif(r.data->'_migration'->>'sourceRow','')::integer;
    source_hash := coalesce(r.data->'_migration'->>'rawRowSha256','');
    source_key := jsonb_build_object(
      'procurementYear', r.procurement_year,
      'provider', coalesce(r.data->>'vendor',r.data->>'provider',''),
      'uptName', coalesce(r.data->>'uptName',''), 'ultgName', coalesce(r.data->>'ultgName',''),
      'giName', coalesce(r.data->>'giName',''), 'bayName', coalesce(r.data->>'bayName',''),
      'mtuCode', coalesce(r.data->>'mtuCode',''), 'sifatPekerjaan', r.sifat_pekerjaan
    );
    sheet_name := case when r.procurement_year = 2024 then 'Input KHS 2024' when r.procurement_year = 2026 then 'Input KHS 2026' else '' end;
    insert into public.mtu_khs_sheet_sync_jobs(id, change_request_id, record_id, sheet_id, sheet_name, source_row, source_row_sha256, source_key, patch, before_data, after_data)
    values ('MTU-SHEET-' || gen_random_uuid()::text, c.id, r.id, '1Fd978ThcVpCmGEbADILLbjpsGfpWtdKlJdnNdvnzOiw', sheet_name, source_row, source_hash, source_key, c.patch - '_idempotency_key', to_jsonb(r.data), new_data)
    on conflict (change_request_id) do nothing;
  end if;
  return result;
end;
$$;

revoke all on function public.mtu_khs_submit_change(text, integer, jsonb, text) from public, anon, authenticated;
revoke all on function public.mtu_khs_decide_change(text, text, text) from public, anon, authenticated;
grant execute on function public.mtu_khs_submit_change(text, integer, jsonb, text), public.mtu_khs_decide_change(text, text, text) to authenticated;
