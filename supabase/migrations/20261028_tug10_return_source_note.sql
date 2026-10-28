-- Proposal: edit the optional note attached to one approved TUG-10 return effect.
-- Does not change stock quantity, source lot, or TUG-3/TUG-4 provenance.
create or replace function public.update_tug10_return_note(
  p_stock_id text,
  p_effect_key text,
  p_note text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  actor public.profiles;
  stock_row public.stocks;
  stock_data jsonb;
  effect jsonb;
  clean_note text := left(btrim(coalesce(p_note, '')), 500);
  now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then raise exception 'TUG10_NOTE_AUTH_REQUIRED' using errcode = '42501'; end if;
  if nullif(btrim(p_stock_id), '') is null or nullif(btrim(p_effect_key), '') is null then
    raise exception 'TUG10_NOTE_INPUT_INVALID' using errcode = '23514';
  end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'TUG10_NOTE_TOO_LONG' using errcode = '22001'; end if;
  select * into actor from public.profiles where id = auth.uid();
  if actor.id is null or actor.role not in ('TL', 'SUPERADMIN') then
    raise exception 'TUG10_NOTE_ROLE_DENIED' using errcode = '42501';
  end if;
  select * into stock_row from public.stocks where id = p_stock_id for update;
  if stock_row.id is null then raise exception 'TUG10_NOTE_STOCK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_access_upt(coalesce(stock_row.upt_id, stock_row.data->>'uptId')) then
    raise exception 'TUG10_NOTE_SCOPE_DENIED' using errcode = '42501';
  end if;
  stock_data := coalesce(stock_row.data, '{}'::jsonb);
  effect := stock_data->'tug10ReturnEffects'->p_effect_key;
  if jsonb_typeof(effect) <> 'object' then raise exception 'TUG10_NOTE_EFFECT_NOT_FOUND' using errcode = 'P0002'; end if;
  stock_data := jsonb_set(stock_data, array['tug10ReturnEffects', p_effect_key],
    effect || jsonb_build_object('note', clean_note, 'noteUpdatedBy', actor.id, 'noteUpdatedAt', now_ms), true);
  update public.stocks set data = stock_data where id = stock_row.id;
  if to_regclass('public.audit_log') is not null then
    execute 'insert into public.audit_log(user_id,user_name,role,action,entity,entity_id,detail) values ($1,$2,$3,$4,$5,$6,$7)'
      using actor.id, actor.name, actor.role, 'UPDATE', 'STOCK_TUG10_SOURCE_NOTE', stock_row.id,
        jsonb_build_object('effectKey', p_effect_key, 'hasNote', clean_note <> '');
  end if;
  return stock_data || jsonb_build_object('id', stock_row.id, 'katalogId', stock_row.katalog_id, 'lokasiId', stock_row.lokasi_id, 'uptId', stock_row.upt_id);
end;
$$;

revoke all on function public.update_tug10_return_note(text, text, text) from public, anon;
grant execute on function public.update_tug10_return_note(text, text, text) to authenticated;
