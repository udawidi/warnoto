-- Apply as one transaction after review. Existing rows and older clients keep their original JSON.
begin;

create or replace function public.master_media_compact(p_table text, p_id text, p_data jsonb, variadic p_fields text[])
returns jsonb language plpgsql immutable strict security invoker set search_path = pg_catalog as $$
declare
  field text;
  image text;
begin
  foreach field in array p_fields loop
    image := p_data ->> field;
    if left(image, 11) = 'data:image/' then
      p_data := jsonb_set(p_data, array[field], to_jsonb('wmedia:' || p_table || ':' || field || ':' || md5(image) || ':' || p_id));
    end if;
  end loop;
  return p_data;
end $$;

create or replace view public.stocks_compact with (security_invoker = true) as
select id, upt_id, xmin::text as revision, public.master_media_compact('stocks', id, data, 'img') as data from public.stocks;
create or replace view public.gudang_compact with (security_invoker = true) as
select id, public.master_media_compact('gudang', id, data, 'denahImageData', 'fotoGudang') as data from public.gudang;
create or replace view public.sub_gudang_compact with (security_invoker = true) as
select id, public.master_media_compact('sub_gudang', id, data, 'denahImageData') as data from public.sub_gudang;
revoke all on public.stocks_compact, public.gudang_compact, public.sub_gudang_compact from public, anon, authenticated;
grant select on public.stocks_compact, public.gudang_compact, public.sub_gudang_compact to authenticated;

-- Lock the source on INSERT ... ON CONFLICT, so a concurrent photo change
-- cannot get overwritten between resolving the handle and applying the upsert.
create or replace function public.master_media_restore() returns trigger
language plpgsql security invoker set search_path = pg_catalog as $$
declare
  field text;
  ref text;
  parts text[];
  original jsonb;
  source_rows bigint;
begin
  foreach field in array tg_argv loop
    ref := new.data ->> field;
    if left(ref, 7) = 'wcache:' then raise exception 'Reload incomplete master data before saving'; end if;
    if left(ref, 7) is distinct from 'wmedia:' then continue; end if;
    parts := regexp_match(ref, '^wmedia:([^:]+):([^:]+):([0-9a-f]{32}):(.+)$');
    if parts is null or parts[1] <> tg_table_name or parts[2] <> field then
      raise exception 'Invalid master media reference';
    end if;
    if parts[4] = new.id then
      if tg_op = 'UPDATE' then
        original := old.data -> field;
      else
        execute format('select data -> $1 from public.%I where id = $2 for update', tg_table_name)
          into original using field, new.id;
        get diagnostics source_rows = row_count;
        if source_rows = 0 then raise exception 'Missing source for master media; reload before saving'; end if;
      end if;
    else
      -- Warehouse consolidation can copy a plan from another visible row.
      -- A SECURITY DEFINER business RPC must never resolve another row on
      -- behalf of its caller. Only direct RLS-checked warehouse edits copy.
      if current_user <> 'authenticated' or tg_table_name = 'stocks' then
        raise exception 'Cross-row master media reference is not allowed';
      end if;
      execute format('select data -> $1 from public.%I where id = $2', tg_table_name)
        into original using field, parts[4];
      if original is null or md5(original #>> '{}') is distinct from parts[3] then
        raise exception 'Master media source changed or is unavailable';
      end if;
    end if;
    if original is null then
      new.data := new.data - field;
    else
      new.data := jsonb_set(new.data, array[field], original);
    end if;
  end loop;
  return new;
end $$;

do $$
declare
  entry record;
  constraint_sql text;
begin
  for entry in select * from (values ('stocks', array['img']), ('gudang', array['denahImageData','fotoGudang']), ('sub_gudang', array['denahImageData'])) v(tbl, fields)
  loop
    execute format('drop trigger if exists aa_master_media_restore on public.%I', entry.tbl);
    execute format('create trigger aa_master_media_restore before insert or update of data on public.%I for each row execute function public.master_media_restore(%s)', entry.tbl,
      (select string_agg(quote_literal(field), ',') from unnest(entry.fields) field));
    -- Keep this check when rolling back the views/trigger. Even an older open
    -- browser cannot persist a handle in place of an image without the trigger.
    if not exists (select 1 from pg_constraint where conrelid=format('public.%I',entry.tbl)::regclass and conname='master_media_stored_values') then
      select string_agg(format('coalesce(left(data->>%L,7),'''') not in (''wmedia:'',''wcache:'')', field), ' and ')
        into constraint_sql from unnest(entry.fields) field;
      execute format('alter table public.%I add constraint master_media_stored_values check (%s) not valid', entry.tbl, constraint_sql);
    end if;
  end loop;
end $$;
notify pgrst, 'reload schema';
commit;
