-- ROLLBACK PROPOSAL ONLY.
-- Restores the exact approval contract from 20260919_stock_opname_asman_approval_rpc.sql
-- and the previous broad scoped-write policy. Review with a fresh backup first.
begin;

drop policy if exists "Stock opname draft insert by warehouse roles" on public.stock_opname;
drop policy if exists "Stock opname draft update by warehouse roles" on public.stock_opname;
drop policy if exists "Stock opname draft delete by warehouse roles" on public.stock_opname;
drop policy if exists "Authenticated write stock_opname" on public.stock_opname;
drop policy if exists "Scoped write stock_opname" on public.stock_opname;
create policy "Scoped write stock_opname" on public.stock_opname for all to authenticated
  using (public.can_access_upt(upt_id))
  with check (public.can_access_upt(upt_id));

create or replace function public.approve_stock_opname_asman(
  p_opname_id text,
  p_opname_data jsonb,
  p_katalog_rows jsonb default '[]'::jsonb,
  p_stock_rows jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_opname public.stock_opname%rowtype;
  v_profile_role text;
  v_upt_id text;
  v_row jsonb;
  v_id text;
  v_katalog_id text;
  v_lokasi_id text;
  v_payload_upt_id text;
  v_existing_upt_id text;
begin
  if auth.uid() is null then raise exception 'OPNAME_APPROVAL_AUTH_REQUIRED'; end if;
  select p.role into v_profile_role from public.profiles p where p.id = auth.uid();
  if v_profile_role not in ('ASMAN', 'SUPERADMIN') then raise exception 'OPNAME_APPROVAL_ROLE_DENIED'; end if;
  if p_opname_id is null or jsonb_typeof(p_opname_data) <> 'object' then raise exception 'OPNAME_APPROVAL_PAYLOAD_INVALID'; end if;
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
  if p_opname_data->>'status' <> 'SELESAI' then raise exception 'OPNAME_APPROVAL_STATUS_INVALID'; end if;
  if coalesce(p_opname_data->>'uptId', p_opname_data->>'upt_id') is distinct from v_upt_id then raise exception 'OPNAME_APPROVAL_UPT_MISMATCH'; end if;
  if exists (
    select 1
    from jsonb_array_elements(case when jsonb_typeof(p_opname_data->'items') = 'array' then p_opname_data->'items' else '[]'::jsonb end) item
    where coalesce(item->>'fotoKeseluruhan', '') like 'data:%'
       or coalesce(item->>'fotoNameplate', '') like 'data:%'
  ) then raise exception 'OPNAME_APPROVAL_PHOTO_NOT_NORMALIZED'; end if;

  for v_row in select value from jsonb_array_elements(p_katalog_rows) loop
    v_id := nullif(v_row->>'id', '');
    if v_id is null or not exists (
      select 1 from jsonb_array_elements(case when jsonb_typeof(p_opname_data->'items') = 'array' then p_opname_data->'items' else '[]'::jsonb end) item
      where item->>'katalogId' = v_id or item->>'noKatalog' = v_id
    ) then raise exception 'OPNAME_APPROVAL_KATALOG_INVALID'; end if;
    insert into public.katalog(id, data, created_at)
    values (v_id, v_row, coalesce(nullif(v_row->>'createdAt', '')::bigint, (extract(epoch from clock_timestamp()) * 1000)::bigint))
    on conflict (id) do update set data = excluded.data;
  end loop;

  for v_row in select value from jsonb_array_elements(p_stock_rows) loop
    v_id := nullif(v_row->>'id', '');
    v_katalog_id := nullif(v_row->>'katalogId', '');
    v_lokasi_id := nullif(v_row->>'lokasiId', '');
    v_payload_upt_id := nullif(v_row->>'uptId', '');
    if v_id is null or v_katalog_id is null then raise exception 'OPNAME_APPROVAL_STOCK_INVALID'; end if;
    if v_payload_upt_id is not null and v_payload_upt_id is distinct from v_upt_id then raise exception 'OPNAME_APPROVAL_STOCK_INVALID'; end if;
    if not exists (select 1 from public.katalog where id = v_katalog_id) then raise exception 'OPNAME_APPROVAL_KATALOG_MISSING'; end if;
    if not exists (
      select 1 from jsonb_array_elements(case when jsonb_typeof(p_opname_data->'items') = 'array' then p_opname_data->'items' else '[]'::jsonb end) item
      where item->>'katalogId' = v_katalog_id or item->>'stockId' = v_id
    ) then raise exception 'OPNAME_APPROVAL_STOCK_NOT_IN_OPNAME'; end if;
    if v_lokasi_id is not null and not exists (
      select 1 from public.lokasi l join public.gudang g on g.id = l.gudang_id
      where l.id = v_lokasi_id and g.upt_id = v_upt_id
    ) then raise exception 'OPNAME_APPROVAL_LOCATION_SCOPE_DENIED'; end if;
    select coalesce(s.upt_id, g.upt_id) into v_existing_upt_id
    from public.stocks s
    left join public.lokasi l on l.id = s.lokasi_id
    left join public.gudang g on g.id = l.gudang_id
    where s.id = v_id;
    if found then
      if v_existing_upt_id is distinct from v_upt_id then raise exception 'OPNAME_APPROVAL_EXISTING_STOCK_SCOPE_DENIED'; end if;
    elsif v_payload_upt_id is distinct from v_upt_id then
      raise exception 'OPNAME_APPROVAL_NEW_STOCK_UPT_REQUIRED';
    end if;
    v_row := jsonb_set(v_row, '{uptId}', to_jsonb(v_upt_id), true);
    insert into public.stocks(id, katalog_id, lokasi_id, upt_id, data, created_at)
    values (v_id, v_katalog_id, v_lokasi_id, v_upt_id, v_row, coalesce(nullif(v_row->>'createdAt', '')::bigint, (extract(epoch from clock_timestamp()) * 1000)::bigint))
    on conflict (id) do update set katalog_id = excluded.katalog_id, lokasi_id = excluded.lokasi_id, upt_id = excluded.upt_id, data = excluded.data;
  end loop;

  update public.stock_opname
  set data = p_opname_data, status = 'SELESAI'
  where id = p_opname_id;
  return jsonb_build_object('ok', true, 'id', p_opname_id, 'status', 'SELESAI', 'idempotent', false);
end;
$$;

revoke all on function public.approve_stock_opname_asman(text, jsonb, jsonb, jsonb) from public;
grant execute on function public.approve_stock_opname_asman(text, jsonb, jsonb, jsonb) to authenticated;

revoke all on function public.reject_stock_opname_asman(text, text) from public;
drop function if exists public.reject_stock_opname_asman(text, text);
revoke all on function public.update_stock_opname_tug_reference(text, text, text) from public;
drop function if exists public.update_stock_opname_tug_reference(text, text, text);

commit;
