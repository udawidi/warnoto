-- PROPOSAL ONLY: GI shadow warehouse for TUG-3/10 and TUG-8/9.
-- Do not apply to production without explicit user approval.
-- Depends on 20260911_mtu_khs.sql, 20260805_multi_upt_rls_gelombang3.sql,
-- 20260821b_tug3_transactions.sql, and 20260824_tug10_transactions.sql.

begin;

-- A GI is represented by durable rows in the existing warehouse chain. This
-- keeps all existing FK/RLS/RPC validation paths unchanged.
create or replace function public.mtu_khs_gi_has_history(p_gi_id text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_prefix text := 'GILOK-' || p_gi_id;
begin
  if exists (select 1 from public.mtu_khs_records where gardu_induk_id = p_gi_id) then return true; end if;
  if exists (
    select 1 from public.stocks s
    where s.lokasi_id = v_prefix or s.data->>'lokasiId' = v_prefix
  ) then return true; end if;
  if exists (
    select 1 from public.tug3_transactions t
    where t.stage in ('PENDING_TL','MENUNGGU_TUG4','PENDING_ASMAN')
      and t.data::text like '%' || v_prefix || '%'
  ) then return true; end if;
  if exists (
    select 1 from public.tug10_transactions t
    where t.stage in ('PENDING_TL','PENDING_ASMAN')
      and t.data::text like '%' || v_prefix || '%'
  ) then return true; end if;
  -- A final canonical item keeps the location and its UPT immutable even when
  -- its current stock quantity later reaches zero.
  if to_regclass('public.tug_items') is not null and exists (
    select 1
    from public.tug_items i
    join public.tug_transactions t on t.id = i.transaction_id
    where i.lokasi_id = v_prefix and t.status = 'FINAL_APPROVED'
  ) then return true; end if;
  return false;
end;
$$;
revoke all on function public.mtu_khs_gi_has_history(text) from public;
revoke all on function public.mtu_khs_gi_has_history(text) from public, authenticated;

do $$
declare conflict_id text;
begin
  select g.id into conflict_id
  from public.mtu_khs_gardu_induk gi
  join public.gudang g on g.id = 'GI-' || gi.id
  where g.data->>'__gi' is distinct from 'true'
     or g.data->>'giId' is distinct from gi.id
  limit 1;
  if conflict_id is not null then
    raise exception 'GI_SHADOW_ID_CONFLICT:gudang:%', conflict_id;
  end if;
  select l.id into conflict_id
  from public.mtu_khs_gardu_induk gi
  join public.lokasi l on l.id = 'GILOK-' || gi.id
  where l.data->>'__gi' is distinct from 'true'
     or l.data->>'giId' is distinct from gi.id
  limit 1;
  if conflict_id is not null then
    raise exception 'GI_SHADOW_ID_CONFLICT:lokasi:%', conflict_id;
  end if;
end $$;

create or replace function public.mtu_khs_sync_gi_shadow()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_gudang_id text := 'GI-' || new.id;
  v_lokasi_id text := 'GILOK-' || new.id;
  v_name text := coalesce(nullif(new.data->>'nama',''), nullif(new.data->>'name',''), new.normalized_name, new.id);
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
  v_data jsonb := coalesce(new.data, '{}'::jsonb) || jsonb_build_object(
    '__gi', true, 'giId', new.id, 'giActive', new.active, 'uptId', new.upt_id, 'nama', v_name, 'kode', v_name
  );
begin
  if exists (select 1 from public.gudang where id = v_gudang_id and (
    data->>'__gi' is distinct from 'true' or data->>'giId' is distinct from new.id
  )) then
    raise exception 'GI_SHADOW_ID_CONFLICT:gudang:%', v_gudang_id;
  end if;
  if exists (select 1 from public.lokasi where id = v_lokasi_id and (
    data->>'__gi' is distinct from 'true' or data->>'giId' is distinct from new.id
  )) then
    raise exception 'GI_SHADOW_ID_CONFLICT:lokasi:%', v_lokasi_id;
  end if;
  insert into public.gudang(id, upt_id, data, created_at)
  values (v_gudang_id, new.upt_id, v_data, v_now)
  on conflict (id) do update set
    upt_id = excluded.upt_id,
    data = public.gudang.data || excluded.data;
  insert into public.lokasi(id, gudang_id, status, data, created_at)
  values (v_lokasi_id, v_gudang_id, case when new.active then 'ACTIVE' else 'ARCHIVED' end,
    v_data || jsonb_build_object('gudangId', v_gudang_id), v_now)
  on conflict (id) do update set
    gudang_id = excluded.gudang_id,
    status = excluded.status,
    data = public.lokasi.data || excluded.data;
  return new;
end;
$$;
revoke all on function public.mtu_khs_sync_gi_shadow() from public;

create or replace function public.mtu_khs_guard_gi_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.upt_id is distinct from old.upt_id and public.mtu_khs_gi_has_history(old.id) then
    raise exception 'MTU_GI_UPT_IMMUTABLE';
  end if;
  return new;
end;
$$;
revoke all on function public.mtu_khs_guard_gi_update() from public;

drop trigger if exists trg_mtu_khs_guard_gi_update on public.mtu_khs_gardu_induk;
create trigger trg_mtu_khs_guard_gi_update
before update on public.mtu_khs_gardu_induk
for each row execute function public.mtu_khs_guard_gi_update();
drop trigger if exists trg_mtu_khs_sync_gi_shadow on public.mtu_khs_gardu_induk;
create trigger trg_mtu_khs_sync_gi_shadow
after insert or update of upt_id, ultg_id, normalized_name, data, active
on public.mtu_khs_gardu_induk
for each row execute function public.mtu_khs_sync_gi_shadow();

-- Helper used only by the idempotent backfill below; it delegates to the same
-- trigger body without relying on a client session or RLS.
create or replace function public.mtu_khs_sync_gi_shadow_for(p_gi_id text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  update public.mtu_khs_gardu_induk set data = public.mtu_khs_gardu_induk.data where id = p_gi_id;
end;
$$;
revoke all on function public.mtu_khs_sync_gi_shadow_for(text) from public;

-- Backfill every GI, including inactive rows needed by historical FK references.
do $$
declare gi record;
begin
  for gi in select * from public.mtu_khs_gardu_induk order by id loop
    perform public.mtu_khs_sync_gi_shadow_for(gi.id);
  end loop;
end $$;
drop function public.mtu_khs_sync_gi_shadow_for(text);

-- Re-define the write RPC so moving a used GI across UPTs is impossible.
create or replace function public.mtu_khs_upsert_gardu_induk(p_id text, p_ultg_id text, p_data jsonb)
returns public.mtu_khs_gardu_induk language plpgsql security definer set search_path = public
as $$
declare result public.mtu_khs_gardu_induk; target_upt text; target_name text; old_upt text;
begin
  select u.upt_id into target_upt from public.ultg u where u.id = p_ultg_id;
  target_name := upper(regexp_replace(btrim(coalesce(p_data->>'normalizedName', p_data->>'nama', p_data->>'name', p_id)), '\s+', ' ', 'g'));
  if target_upt is null or target_name = '' then raise exception 'MTU_MASTER_INVALID'; end if;
  if not public.mtu_khs_can_access_upt(target_upt) then raise exception 'MTU_SCOPE_DENIED'; end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('SUPERADMIN','ADMIN_LOG_PUSAT','ADMIN_UIT','TL')) then raise exception 'MTU_SCOPE_DENIED'; end if;
  select upt_id into old_upt from public.mtu_khs_gardu_induk where id = p_id;
  if old_upt is not null and old_upt is distinct from target_upt and public.mtu_khs_gi_has_history(p_id) then raise exception 'MTU_GI_UPT_IMMUTABLE'; end if;
  insert into public.mtu_khs_gardu_induk(id, upt_id, ultg_id, normalized_name, data, active, created_by)
  values (p_id, target_upt, p_ultg_id, target_name, coalesce(p_data,'{}'::jsonb) || jsonb_build_object('normalizedName', target_name), coalesce((p_data->>'active')::boolean, true), auth.uid())
  on conflict (id) do update set upt_id = excluded.upt_id, ultg_id = excluded.ultg_id, normalized_name = excluded.normalized_name, data = excluded.data, active = excluded.active, updated_at = now()
  returning * into result;
  return result;
end;
$$;
revoke all on function public.mtu_khs_upsert_gardu_induk(text,text,jsonb) from public;
grant execute on function public.mtu_khs_upsert_gardu_induk(text,text,jsonb) to authenticated;

create or replace function public.mtu_khs_deactivate_site_master(p_table_name text, p_id text)
returns boolean language plpgsql security definer set search_path = public
as $$
declare target_upt text;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('SUPERADMIN','ADMIN_LOG_PUSAT','ADMIN_UIT','TL')) then raise exception 'MTU_SCOPE_DENIED'; end if;
  if p_table_name = 'mtu_khs_gardu_induk' then
    select gi.upt_id into target_upt from public.mtu_khs_gardu_induk gi where gi.id = p_id;
    if not public.mtu_khs_can_access_upt(target_upt) then raise exception 'MTU_SCOPE_DENIED'; end if;
    if public.mtu_khs_gi_has_history(p_id) then raise exception 'MTU_MASTER_IN_USE'; end if;
    update public.mtu_khs_gardu_induk set active = false, updated_at = now() where id = p_id;
  elsif p_table_name = 'mtu_khs_gardu_induk_bay' then
    select gi.upt_id into target_upt from public.mtu_khs_gardu_induk_bay bay join public.mtu_khs_gardu_induk gi on gi.id = bay.gardu_induk_id where bay.id = p_id;
    if not public.mtu_khs_can_access_upt(target_upt) then raise exception 'MTU_SCOPE_DENIED'; end if;
    if exists (select 1 from public.mtu_khs_records where bay_id = p_id) then raise exception 'MTU_MASTER_IN_USE'; end if;
    update public.mtu_khs_gardu_induk_bay set active = false, updated_at = now() where id = p_id;
  else raise exception 'MTU_MASTER_INVALID'; end if;
  return true;
end;
$$;
revoke all on function public.mtu_khs_deactivate_site_master(text,text) from public;
grant execute on function public.mtu_khs_deactivate_site_master(text,text) to authenticated;

commit;
