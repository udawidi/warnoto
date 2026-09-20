-- Stock Opname/Count: harden the UPT boundary already used by the app.
-- Idempotent and intentionally aborts before NOT NULL/RLS changes when legacy
-- rows cannot be mapped to a real UPT.
begin;

do $$
declare
  v_table text;
  v_column text;
  v_type text;
begin
  if to_regprocedure('public.can_access_upt(text)') is null then
    raise exception 'Stock Opname isolation requires public.can_access_upt(text)';
  end if;
  foreach v_table in array array['stock_opname', 'stock_count'] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'Stock Opname isolation requires public.%', v_table;
    end if;
  end loop;
  foreach v_table in array array['upt', 'profiles'] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'Stock Opname isolation requires public.%', v_table;
    end if;
  end loop;
  select c.data_type into v_type
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'upt' and c.column_name = 'id';
  if v_type <> 'text' then raise exception 'public.upt.id must be text'; end if;
  select c.data_type into v_type
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'profiles' and c.column_name = 'upt_id';
  if v_type <> 'text' then raise exception 'public.profiles.upt_id must be text'; end if;
end $$;

alter table public.stock_opname add column if not exists upt_id text;
alter table public.stock_count add column if not exists upt_id text;

-- Prefer an already stamped row, then resolve legacy actor IDs through profiles.
update public.stock_opname o
set upt_id = nullif(trim(coalesce(o.data->>'uptId', o.data->>'upt_id')), '')
where o.upt_id is null
  and exists (
    select 1 from public.upt u
    where u.id = nullif(trim(coalesce(o.data->>'uptId', o.data->>'upt_id')), '')
  );
update public.stock_count c
set upt_id = nullif(trim(coalesce(c.data->>'uptId', c.data->>'upt_id')), '')
where c.upt_id is null
  and exists (
    select 1 from public.upt u
    where u.id = nullif(trim(coalesce(c.data->>'uptId', c.data->>'upt_id')), '')
  );
update public.stock_opname o
set upt_id = p.upt_id
from public.profiles p
where o.upt_id is null
  and nullif(trim(o.data->>'dibuatOleh'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and p.id = (o.data->>'dibuatOleh')::uuid;
update public.stock_count c
set upt_id = p.upt_id
from public.profiles p
where c.upt_id is null
  and nullif(trim(coalesce(c.data->>'uploadedBy', c.data->>'createdBy')), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and p.id = coalesce(nullif(trim(c.data->>'uploadedBy'), ''), nullif(trim(c.data->>'createdBy'), ''))::uuid;

do $$
declare
  v_opname_null bigint;
  v_count_null bigint;
  v_opname_orphan bigint;
  v_count_orphan bigint;
begin
  select count(*) into v_opname_null from public.stock_opname where upt_id is null;
  select count(*) into v_count_null from public.stock_count where upt_id is null;
  select count(*) into v_opname_orphan from public.stock_opname o left join public.upt u on u.id = o.upt_id where u.id is null;
  select count(*) into v_count_orphan from public.stock_count c left join public.upt u on u.id = c.upt_id where u.id is null;
  if v_opname_null > 0 or v_count_null > 0 or v_opname_orphan > 0 or v_count_orphan > 0 then
    raise exception 'Stock Opname isolation dibatalkan — upt_id unresolved/orphan: stock_opname null=% orphan=%, stock_count null=% orphan=%',
      v_opname_null, v_opname_orphan, v_count_null, v_count_orphan;
  end if;
end $$;

alter table public.stock_opname alter column upt_id set not null;
alter table public.stock_count alter column upt_id set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_opname_upt_id_fkey' and conrelid = 'public.stock_opname'::regclass) then
    alter table public.stock_opname add constraint stock_opname_upt_id_fkey foreign key (upt_id) references public.upt(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_count_upt_id_fkey' and conrelid = 'public.stock_count'::regclass) then
    alter table public.stock_count add constraint stock_count_upt_id_fkey foreign key (upt_id) references public.upt(id) on delete restrict;
  end if;
end $$;

create index if not exists idx_stock_opname_upt_id on public.stock_opname (upt_id);
create index if not exists idx_stock_count_upt_id on public.stock_count (upt_id);

-- Remove every previous policy name, including policies introduced outside the
-- repository. This prevents an old permissive policy from OR-ing with the new one.
do $$
declare p record;
begin
  for p in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public' and tablename in ('stock_opname', 'stock_count')
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

alter table public.stock_opname enable row level security;
alter table public.stock_count enable row level security;
revoke all on table public.stock_opname, public.stock_count from public, anon, authenticated;
grant select, insert, update, delete on table public.stock_opname, public.stock_count to authenticated;
grant all on table public.stock_opname, public.stock_count to service_role;

create policy "Scoped read stock_opname" on public.stock_opname
  for select to authenticated using (public.can_access_upt(upt_id));
create policy "Scoped write stock_opname" on public.stock_opname
  for all to authenticated
  using (public.can_access_upt(upt_id))
  with check (public.can_access_upt(upt_id));
create policy "Scoped read stock_count" on public.stock_count
  for select to authenticated using (public.can_access_upt(upt_id));
create policy "Scoped write stock_count" on public.stock_count
  for all to authenticated
  using (public.can_access_upt(upt_id))
  with check (public.can_access_upt(upt_id));

commit;
