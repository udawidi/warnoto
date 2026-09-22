-- PROPOSAL ONLY. Apply to production self-host only after explicit approval.
-- Stock Opname approval records the SAP baseline and review notes. It never changes active qty.
begin;

create or replace function public.approve_stock_opname_asman(
  p_opname_id text,
  p_opname_data jsonb,
  p_katalog_rows jsonb default '[]'::jsonb,
  p_stock_rows jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_opname public.stock_opname%rowtype;
  v_items jsonb;
  v_final_items jsonb;
  v_final_data jsonb;
  v_profile_role text;
  v_upt_id text;
  v_item jsonb;
  v_row jsonb;
  v_existing public.stocks%rowtype;
  v_existing_upt_id text;
  v_existing_gudang_id text;
  v_safe_row jsonb;
  v_key text;
  v_catalog_id text;
  v_payload_qty numeric;
  v_existing_qty numeric;
  v_sap_qty numeric;
  v_now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_is_sap boolean;
  v_rep_item jsonb;
  v_group record;
begin
  if auth.uid() is null then raise exception 'OPNAME_APPROVAL_AUTH_REQUIRED'; end if;
  select p.role into v_profile_role from public.profiles p where p.id = auth.uid();
  if coalesce(v_profile_role, '') not in ('ASMAN', 'SUPERADMIN') then raise exception 'OPNAME_APPROVAL_ROLE_DENIED'; end if;
  if p_opname_id is null or jsonb_typeof(p_opname_data) <> 'object' or jsonb_typeof(p_opname_data->'items') <> 'array' then raise exception 'OPNAME_APPROVAL_PAYLOAD_INVALID'; end if;
  if jsonb_typeof(p_katalog_rows) <> 'array' or jsonb_typeof(p_stock_rows) <> 'array' then raise exception 'OPNAME_APPROVAL_ROWS_INVALID'; end if;

  select * into v_opname from public.stock_opname where id = p_opname_id for update;
  if not found then raise exception 'OPNAME_APPROVAL_NOT_FOUND'; end if;
  v_upt_id := v_opname.upt_id;
  if v_upt_id is null or not public.can_access_upt(v_upt_id) then raise exception 'OPNAME_APPROVAL_SCOPE_DENIED'; end if;
  if v_opname.status = 'SELESAI' then
    if (v_opname.data - 'approvedByAsman' - 'approvedAtAsman' - 'freeze') =
       (p_opname_data - 'approvedByAsman' - 'approvedAtAsman' - 'freeze') then
      return jsonb_build_object('ok', true, 'id', p_opname_id, 'status', 'SELESAI', 'idempotent', true);
    end if;
    raise exception 'OPNAME_APPROVAL_ALREADY_FINAL';
  end if;
  if v_opname.status <> 'PENDING_ASMAN' then raise exception 'OPNAME_APPROVAL_STATUS_INVALID'; end if;
  v_items := v_opname.data->'items';
  if jsonb_typeof(v_items) <> 'array' then raise exception 'OPNAME_APPROVAL_STORED_ITEMS_INVALID'; end if;
  if p_opname_data->>'status' <> 'SELESAI' then raise exception 'OPNAME_APPROVAL_STATUS_INVALID'; end if;
  if coalesce(nullif(trim(p_opname_data->>'uptId'), ''), nullif(trim(p_opname_data->>'upt_id'), ''), v_upt_id) is distinct from v_upt_id then raise exception 'OPNAME_APPROVAL_UPT_MISMATCH'; end if;

  -- The stored pending snapshot is authoritative. The only item change allowed
  -- at approval is stamping a server-validated catalog id for a new material.
  for v_row in select value from jsonb_array_elements(p_katalog_rows) loop
    v_catalog_id := nullif(v_row->>'id', '');
    if v_catalog_id is null then raise exception 'OPNAME_APPROVAL_KATALOG_INVALID'; end if;
    if not exists (
      select 1 from jsonb_array_elements(v_items) item
      where item->>'katalogId' = v_catalog_id
         or item->>'noKatalog' = v_row->>'katalog'
    ) then raise exception 'OPNAME_APPROVAL_KATALOG_INVALID'; end if;
  end loop;
  select coalesce(jsonb_agg(
           case when nullif(item->>'katalogId', '') is null and match.catalog_id is not null
                then jsonb_set(item, '{katalogId}', to_jsonb(match.catalog_id), true)
                else item end
           order by item_rows.ord
         ), '[]'::jsonb)
    into v_final_items
    from jsonb_array_elements(v_items) with ordinality item_rows(item, ord)
    left join lateral (
      select nullif(row->>'id', '') catalog_id
      from jsonb_array_elements(p_katalog_rows) rows(row)
      where row->>'katalog' = item_rows.item->>'noKatalog'
      order by row->>'id'
      limit 1
    ) match on true;
  if p_opname_data->'items' <> v_final_items then raise exception 'OPNAME_APPROVAL_SNAPSHOT_MISMATCH'; end if;
  if exists (select 1 from jsonb_array_elements(v_final_items) item where item->>'fotoKeseluruhan' like 'data:%' or item->>'fotoNameplate' like 'data:%') then raise exception 'OPNAME_APPROVAL_PHOTO_NOT_NORMALIZED'; end if;

  v_is_sap := coalesce(v_opname.data->>'jenisAlur', p_opname_data->>'jenisAlur') = 'SAP';
  -- The comparison is catalog-level. SAP is stored only on the first lot row.
  for v_group in
    with item_rows as (
      select value item, ordinality ord,
             coalesce(nullif(value->>'katalogId',''), nullif(value->>'noKatalog',''), 'row:' || ordinality::text) key,
             case when (value->>'qtySistem') ~ '^([0-9]+)(\.[0-9]+)?$' then (value->>'qtySistem')::numeric else 0 end system_qty,
             case when (value->>'qtsFisik') ~ '^([0-9]+)(\.[0-9]+)?$' then (value->>'qtsFisik')::numeric else null end physical_qty,
             case when (value->>'qtySAP') ~ '^([0-9]+)(\.[0-9]+)?$' then (value->>'qtySAP')::numeric else null end sap_qty
        from jsonb_array_elements(v_final_items) with ordinality
    ), grouped as (
      select key, max(sap_qty) sap_qty, sum(system_qty) system_qty,
             sum(physical_qty) physical_qty, bool_and(physical_qty is not null) counted,
             coalesce(min(ord) filter (where sap_qty is not null), min(ord)) rep_ord
        from item_rows group by key
    )
    select g.key, g.sap_qty, g.system_qty, g.physical_qty, g.counted, r.item rep_item
      from grouped g join item_rows r on r.key = g.key and r.ord = g.rep_ord
  loop
    if not v_group.counted then raise exception 'OPNAME_APPROVAL_PHYSICAL_QTY_REQUIRED'; end if;
    v_sap_qty := v_group.sap_qty;
    if (v_is_sap and (v_sap_qty is null or v_sap_qty <> v_group.physical_qty or v_group.physical_qty <> v_group.system_qty))
       or ((not v_is_sap) and v_group.physical_qty <> v_group.system_qty) then
      v_rep_item := v_group.rep_item;
      if nullif(btrim(v_rep_item->>'keterangan'), '') is null then raise exception 'OPNAME_APPROVAL_NOTE_REQUIRED:%', v_group.key; end if;
    end if;
  end loop;

  -- Catalog metadata may be created, but a missing stock row is never invented by approval.
  for v_row in select value from jsonb_array_elements(p_katalog_rows) loop
    v_catalog_id := nullif(v_row->>'id', '');
    if v_catalog_id is null then raise exception 'OPNAME_APPROVAL_KATALOG_INVALID'; end if;
    if not exists (select 1 from jsonb_array_elements(v_final_items) item where item->>'katalogId' = v_catalog_id or item->>'noKatalog' = v_row->>'katalog') then raise exception 'OPNAME_APPROVAL_KATALOG_INVALID'; end if;
    insert into public.katalog(id, data, created_at) values (v_catalog_id, v_row, coalesce(nullif(v_row->>'createdAt','')::bigint, v_now_ms)) on conflict (id) do update set data = excluded.data;
  end loop;

  -- Client rows may carry photos/history/baseline metadata, but qty is immutable here.
  for v_row in select value from jsonb_array_elements(p_stock_rows) loop
    v_catalog_id := nullif(v_row->>'katalogId', '');
    if nullif(v_row->>'id','') is null or v_catalog_id is null then raise exception 'OPNAME_APPROVAL_STOCK_INVALID'; end if;
    select * into v_existing from public.stocks where id = v_row->>'id' for update;
    if not found then raise exception 'OPNAME_APPROVAL_STOCK_NOT_FOUND'; end if;
    select coalesce(v_existing.upt_id, g.upt_id), g.id
      into v_existing_upt_id, v_existing_gudang_id
      from public.lokasi l
      left join public.gudang g on g.id = l.gudang_id
     where l.id = v_existing.lokasi_id;
    v_existing_upt_id := coalesce(v_existing_upt_id, v_existing.upt_id);
    if v_existing.katalog_id is distinct from v_catalog_id or v_existing_upt_id is distinct from v_upt_id then raise exception 'OPNAME_APPROVAL_STOCK_SCOPE_DENIED'; end if;
    v_payload_qty := nullif(v_row->>'qty','')::numeric;
    v_existing_qty := nullif(v_existing.data->>'qty','')::numeric;
    if v_payload_qty is distinct from v_existing_qty then raise exception 'OPNAME_APPROVAL_QTY_MUTATION'; end if;
    if not exists (select 1 from jsonb_array_elements(v_final_items) item where item->>'stockId' = v_row->>'id' or item->>'katalogId' = v_catalog_id) then raise exception 'OPNAME_APPROVAL_STOCK_NOT_IN_OPNAME'; end if;
    -- Keep typed identity authoritative. Client data may carry history/photos,
    -- but may not move a stock to another UPT, warehouse, location, catalog, or qty.
    v_safe_row := jsonb_set(v_row, '{id}', to_jsonb(v_existing.id), true);
    v_safe_row := jsonb_set(v_safe_row, '{katalogId}', coalesce(to_jsonb(v_existing.katalog_id), 'null'::jsonb), true);
    v_safe_row := jsonb_set(v_safe_row, '{lokasiId}', coalesce(to_jsonb(v_existing.lokasi_id), 'null'::jsonb), true);
    v_safe_row := jsonb_set(v_safe_row, '{gudangId}', coalesce(to_jsonb(v_existing_gudang_id), 'null'::jsonb), true);
    v_safe_row := jsonb_set(v_safe_row, '{uptId}', to_jsonb(v_upt_id), true);
    v_safe_row := jsonb_set(v_safe_row, '{qty}', coalesce(v_existing.data->'qty', 'null'::jsonb), true);
    update public.stocks set data = v_safe_row where id = v_row->>'id';
  end loop;

  -- Stamp the catalog-level SAP baseline on all matching same-UPT lots. Do not sum it.
  if v_is_sap then
    if exists (
      with item_rows as (
        select nullif(item->>'katalogId', '') katalog_id,
               case when (item->>'qtySAP') ~ '^([0-9]+)(\.[0-9]+)?$' then (item->>'qtySAP')::numeric else null end sap_qty
        from jsonb_array_elements(v_final_items) item
      )
      select 1 from item_rows
       where katalog_id is not null and sap_qty is not null
       group by katalog_id
      having count(distinct sap_qty) > 1
    ) then raise exception 'OPNAME_APPROVAL_SAP_DUPLICATE_CONFLICT'; end if;
    for v_row in
      with item_rows as (
        select nullif(item->>'katalogId', '') katalog_id,
               case when (item->>'qtySAP') ~ '^([0-9]+)(\.[0-9]+)?$' then (item->>'qtySAP')::numeric else null end sap_qty
        from jsonb_array_elements(v_final_items) item
      )
      select jsonb_build_object('katalogId', katalog_id, 'qtySAP', min(sap_qty))
      from item_rows
      where katalog_id is not null and sap_qty is not null
      group by katalog_id
    loop
      v_catalog_id := nullif(v_row->>'katalogId','');
      if v_catalog_id is null then continue; end if;
      v_sap_qty := (v_row->>'qtySAP')::numeric;
      update public.stocks s set data = jsonb_set(jsonb_set(coalesce(s.data,'{}'::jsonb), '{sapBaselineQty}', to_jsonb(v_sap_qty), true), '{sapBaselineAt}', to_jsonb(v_now_ms), true)
       where s.katalog_id = v_catalog_id and coalesce(s.upt_id, (select g.upt_id from public.lokasi l join public.gudang g on g.id=l.gudang_id where l.id=s.lokasi_id)) = v_upt_id;
    end loop;
  end if;

  -- Final document is based on the locked server snapshot. Only approval
  -- metadata is accepted from the caller; item quantities/notes/photos remain
  -- exactly what was submitted by the warehouse.
  v_final_data := jsonb_set(v_opname.data, '{items}', v_final_items, true);
  v_final_data := jsonb_set(v_final_data, '{status}', '"SELESAI"'::jsonb, true);
  v_final_data := jsonb_set(v_final_data, '{approvedByAsman}', to_jsonb(auth.uid()::text), true);
  v_final_data := jsonb_set(v_final_data, '{approvedAtAsman}', to_jsonb(v_now_ms), true);
  if jsonb_typeof(p_opname_data->'catatanAsman') = 'string' then
    v_final_data := jsonb_set(v_final_data, '{catatanAsman}', p_opname_data->'catatanAsman', true);
  end if;
  if jsonb_typeof(p_opname_data->'notulen') = 'array' then
    v_final_data := jsonb_set(v_final_data, '{notulen}', p_opname_data->'notulen', true);
  end if;
  update public.stock_opname set data = v_final_data, status = 'SELESAI', updated_at = clock_timestamp() where id = p_opname_id;
  return jsonb_build_object('ok', true, 'id', p_opname_id, 'status', 'SELESAI', 'idempotent', false);
end;
$$;

create or replace function public.update_stock_opname_tug_reference(
  p_opname_id text,
  p_item_key text,
  p_tug_reference text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_opname public.stock_opname%rowtype;
  v_role text;
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_matches int := 0;
  v_new_items jsonb := '[]'::jsonb;
begin
  select p.role into v_role from public.profiles p where p.id = auth.uid();
  if auth.uid() is null or coalesce(v_role, '') not in ('ADMIN','TL','SUPERADMIN') then raise exception 'OPNAME_TUG_REFERENCE_ROLE_DENIED'; end if;
  select * into v_opname from public.stock_opname where id = p_opname_id for update;
  if not found or v_opname.status <> 'SELESAI' or not public.can_access_upt(v_opname.upt_id) then raise exception 'OPNAME_TUG_REFERENCE_SCOPE_DENIED'; end if;
  v_items := coalesce(v_opname.data->'items', '[]'::jsonb);
  for v_item in select value from jsonb_array_elements(v_items) loop
    if coalesce(v_item->>'stockId', v_item->>'id', v_item->>'katalogId', v_item->>'noKatalog') = p_item_key then v_matches := v_matches + 1; end if;
  end loop;
  if v_matches <> 1 then raise exception 'OPNAME_TUG_REFERENCE_ITEM_AMBIGUOUS'; end if;
  for v_item in select value from jsonb_array_elements(v_items) loop
    if coalesce(v_item->>'stockId', v_item->>'id', v_item->>'katalogId', v_item->>'noKatalog') = p_item_key then v_new_items := v_new_items || jsonb_build_array(jsonb_set(v_item, '{tugReference}', coalesce(to_jsonb(nullif(btrim(p_tug_reference),'')), 'null'::jsonb), true)); else v_new_items := v_new_items || jsonb_build_array(v_item); end if;
  end loop;
  update public.stock_opname set data = jsonb_set(v_opname.data, '{items}', v_new_items, true), updated_at = clock_timestamp() where id = p_opname_id;
  return jsonb_build_object('ok', true, 'opname', jsonb_set(v_opname.data, '{items}', v_new_items, true));
end;
$$;

create or replace function public.reject_stock_opname_asman(
  p_opname_id text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_opname public.stock_opname%rowtype;
  v_role text;
  v_now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_data jsonb;
begin
  select p.role into v_role from public.profiles p where p.id = auth.uid();
  if auth.uid() is null or coalesce(v_role, '') not in ('ASMAN','SUPERADMIN') then raise exception 'OPNAME_REJECTION_ROLE_DENIED'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'OPNAME_REJECTION_REASON_REQUIRED'; end if;
  select * into v_opname from public.stock_opname where id = p_opname_id for update;
  if not found then raise exception 'OPNAME_REJECTION_NOT_FOUND'; end if;
  if not public.can_access_upt(v_opname.upt_id) then raise exception 'OPNAME_REJECTION_SCOPE_DENIED'; end if;
  if v_opname.status <> 'PENDING_ASMAN' then raise exception 'OPNAME_REJECTION_STATUS_INVALID'; end if;
  v_data := jsonb_set(jsonb_set(jsonb_set(jsonb_set(v_opname.data,
    '{status}', '"DITOLAK"'::jsonb, true),
    '{rejectedBy}', to_jsonb(auth.uid()::text), true),
    '{rejectedAt}', to_jsonb(v_now_ms), true),
    '{rejectReason}', to_jsonb(btrim(p_reason)), true);
  update public.stock_opname set data = v_data, status = 'DITOLAK', updated_at = clock_timestamp() where id = p_opname_id;
  return jsonb_build_object('ok', true, 'opname', v_data);
end;
$$;

-- Direct draft writes are warehouse work. Approval, rejection, and post-final TUG
-- references pass through the SECURITY DEFINER functions above.
drop policy if exists "Authenticated write stock_opname" on public.stock_opname;
drop policy if exists "Scoped write stock_opname" on public.stock_opname;
drop policy if exists "Stock opname draft insert by warehouse roles" on public.stock_opname;
drop policy if exists "Stock opname draft update by warehouse roles" on public.stock_opname;
drop policy if exists "Stock opname draft delete by warehouse roles" on public.stock_opname;

create policy "Stock opname draft insert by warehouse roles" on public.stock_opname
  for insert to authenticated
  with check (
    public.can_access_upt(upt_id)
    and status in ('DRAFT','PENDING_ASMAN')
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role in ('ADMIN','TL','SUPERADMIN'))
  );

create policy "Stock opname draft update by warehouse roles" on public.stock_opname
  for update to authenticated
  using (
    public.can_access_upt(upt_id)
    and status = 'DRAFT'
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role in ('ADMIN','TL','SUPERADMIN'))
  )
  with check (
    public.can_access_upt(upt_id)
    and status in ('DRAFT','PENDING_ASMAN')
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role in ('ADMIN','TL','SUPERADMIN'))
  );

create policy "Stock opname draft delete by warehouse roles" on public.stock_opname
  for delete to authenticated
  using (
    public.can_access_upt(upt_id)
    and status = 'DRAFT'
    and exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role in ('ADMIN','TL','SUPERADMIN'))
  );

revoke all on function public.approve_stock_opname_asman(text, jsonb, jsonb, jsonb) from public;
grant execute on function public.approve_stock_opname_asman(text, jsonb, jsonb, jsonb) to authenticated;
revoke all on function public.update_stock_opname_tug_reference(text, text, text) from public;
grant execute on function public.update_stock_opname_tug_reference(text, text, text) to authenticated;
revoke all on function public.reject_stock_opname_asman(text, text) from public;
grant execute on function public.reject_stock_opname_asman(text, text) to authenticated;
commit;
