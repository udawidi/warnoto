-- PROPOSAL ONLY — apply to production self-host only after explicit approval.
-- Stock Opname: TL-controlled freeze, server timestamps, and Realtime publication.

begin;

alter table public.stock_opname
  add column if not exists updated_at timestamptz not null default clock_timestamp();

create or replace function public.stock_opname_set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists trg_stock_opname_set_updated_at on public.stock_opname;
create trigger trg_stock_opname_set_updated_at
before insert or update on public.stock_opname
for each row execute function public.stock_opname_set_updated_at();

create or replace function public.guard_stock_opname_freeze_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null
     and (
       (tg_op = 'INSERT' and coalesce(new.data->'freeze'->>'aktif', 'false') = 'true')
       or (tg_op = 'UPDATE' and new.data->'freeze' is distinct from old.data->'freeze')
     )
     and not exists (
       select 1 from public.profiles p
       where p.id = auth.uid() and p.role = 'TL'
     ) then
    raise exception 'STOCK_OPNAME_FREEZE_ROLE_DENIED';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stock_opname_guard_freeze on public.stock_opname;
create trigger trg_stock_opname_guard_freeze
before insert or update on public.stock_opname
for each row execute function public.guard_stock_opname_freeze_change();

create or replace function public.set_stock_opname_freeze(
  p_opname_id text,
  p_active boolean,
  p_gudang_ids text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_opname public.stock_opname%rowtype;
  v_data jsonb;
  v_freeze jsonb;
  v_ids text[];
  v_now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then raise exception 'STOCK_OPNAME_FREEZE_AUTH_REQUIRED'; end if;
  select * into v_actor from public.profiles where id = auth.uid();
  if not found or v_actor.role <> 'TL' or v_actor.upt_id is null then raise exception 'STOCK_OPNAME_FREEZE_ROLE_DENIED'; end if;
  if nullif(trim(p_opname_id), '') is null then raise exception 'STOCK_OPNAME_FREEZE_ID_REQUIRED'; end if;

  select * into v_opname
  from public.stock_opname
  where id = p_opname_id
  for update;
  if not found then raise exception 'STOCK_OPNAME_FREEZE_NOT_FOUND'; end if;
  if v_opname.upt_id is distinct from v_actor.upt_id then raise exception 'STOCK_OPNAME_FREEZE_SCOPE_DENIED'; end if;

  if p_active then
    if v_opname.status in ('SELESAI', 'DITOLAK') then raise exception 'STOCK_OPNAME_FREEZE_TERMINAL'; end if;
    select coalesce(
      array_agg(distinct nullif(trim(g), '')) filter (where nullif(trim(g), '') is not null),
      '{}'::text[]
    )
      into v_ids
    from unnest(coalesce(p_gudang_ids, '{}'::text[])) as ids(g);
    if cardinality(v_ids) = 0 then raise exception 'STOCK_OPNAME_FREEZE_GUDANG_REQUIRED'; end if;
    if exists (
      select 1
      from unnest(v_ids) as ids(gudang_id)
      where not exists (
        select 1 from public.gudang g
        where g.id = ids.gudang_id and g.upt_id = v_opname.upt_id
      )
      or not (
        v_opname.data->>'gudangId' = ids.gudang_id
        or exists (
          select 1
          from jsonb_array_elements(case when jsonb_typeof(v_opname.data->'items') = 'array' then v_opname.data->'items' else '[]'::jsonb end) item
          cross join lateral jsonb_array_elements(case when jsonb_typeof(item->'lokasiBreakdown') = 'array' then item->'lokasiBreakdown' else '[]'::jsonb end) block
          where block->>'gudangId' = ids.gudang_id
        )
      )
    ) then raise exception 'STOCK_OPNAME_FREEZE_GUDANG_SCOPE_DENIED'; end if;
    v_freeze := jsonb_build_object(
      'aktif', true,
      'gudangIds', to_jsonb(v_ids),
      'at', v_now_ms,
      'by', auth.uid()::text,
      'unfrozenAt', null
    );
  else
    v_freeze := coalesce(v_opname.data->'freeze', '{}'::jsonb)
      || jsonb_build_object('aktif', false, 'unfrozenAt', v_now_ms);
  end if;

  v_data := jsonb_set(v_opname.data, '{freeze}', v_freeze, true);
  update public.stock_opname
  set data = v_data
  where id = p_opname_id;

  return jsonb_build_object(
    'ok', true,
    'id', p_opname_id,
    'data', v_data,
    'updated_at', v_now_ms
  );
end;
$$;

revoke all on function public.set_stock_opname_freeze(text, boolean, text[]) from public;
grant execute on function public.set_stock_opname_freeze(text, boolean, text[]) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'stock_opname'
     ) then
    alter publication supabase_realtime add table public.stock_opname;
  end if;
end;
$$;

commit;
