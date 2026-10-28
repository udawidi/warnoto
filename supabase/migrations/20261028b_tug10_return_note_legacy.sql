-- Proposal: allow the TUG-10 source-note RPC to promote legacy markers.
-- Legacy rows keep _tug10Applied but lack tug10ReturnEffects; promotion only
-- adds provenance metadata and the optional note, preserving qty and lot data.
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
  txn_row public.tug10_transactions;
  stock_data jsonb;
  effects jsonb;
  effect jsonb;
  items jsonb;
  txn_id text;
  idx_text text;
  item_index integer;
  marker text;
  marker_qty numeric;
  clean_note text := btrim(coalesce(p_note, ''));
  now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then raise exception 'TUG10_NOTE_AUTH_REQUIRED' using errcode = '42501'; end if;
  if nullif(btrim(p_stock_id), '') is null or nullif(btrim(p_effect_key), '') is null then
    raise exception 'TUG10_NOTE_INPUT_INVALID' using errcode = '23514';
  end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'TUG10_NOTE_TOO_LONG' using errcode = '22001'; end if;
  select * into actor from public.profiles where id = auth.uid();
  if actor.id is null or actor.role not in ('TL', 'SUPERADMIN') then raise exception 'TUG10_NOTE_ROLE_DENIED' using errcode = '42501'; end if;
  select * into stock_row from public.stocks where id = p_stock_id for update;
  if stock_row.id is null then raise exception 'TUG10_NOTE_STOCK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_access_upt(coalesce(stock_row.upt_id, stock_row.data->>'uptId')) then raise exception 'TUG10_NOTE_SCOPE_DENIED' using errcode = '42501'; end if;

  stock_data := coalesce(stock_row.data, '{}'::jsonb);
  effects := coalesce(stock_data->'tug10ReturnEffects', '{}'::jsonb);
  effect := effects->p_effect_key;
  if jsonb_typeof(effect) = 'object' then
    stock_data := jsonb_set(stock_data, array['tug10ReturnEffects', p_effect_key], effect || jsonb_build_object('note', clean_note, 'noteUpdatedBy', actor.id, 'noteUpdatedAt', now_ms), true);
  else
    marker := nullif(btrim(stock_data->'_tug10Applied'->>p_effect_key), '');
    if marker is null or marker !~ '^[0-9]+([.][0-9]+)?$' then raise exception 'TUG10_NOTE_EFFECT_NOT_FOUND' using errcode = 'P0002'; end if;
    marker_qty := marker::numeric;
    if marker_qty < 0 then raise exception 'TUG10_NOTE_LEGACY_MARKER_INVALID' using errcode = '23514'; end if;
    txn_id := substring(p_effect_key from '^(.*):[0-9]+$');
    idx_text := substring(p_effect_key from ':([0-9]+)$');
    if txn_id is null or idx_text is null then raise exception 'TUG10_NOTE_LEGACY_KEY_INVALID' using errcode = '23514'; end if;
    item_index := idx_text::integer;
    select * into txn_row from public.tug10_transactions where id = txn_id for share;
    if txn_row.id is null or txn_row.status is distinct from 'APPROVED' or txn_row.stage is distinct from 'APPROVED' then raise exception 'TUG10_NOTE_LEGACY_TXN_INVALID' using errcode = 'P0002'; end if;
    if txn_row.upt_id is distinct from coalesce(stock_row.upt_id, stock_data->>'uptId') then raise exception 'TUG10_NOTE_SCOPE_DENIED' using errcode = '42501'; end if;
    items := coalesce(txn_row.data->'stockItems', '[]'::jsonb);
    if jsonb_typeof(items) <> 'array' or item_index < 0 or item_index >= jsonb_array_length(items) then raise exception 'TUG10_NOTE_LEGACY_ITEM_INVALID' using errcode = 'P0002'; end if;
    effect := jsonb_build_object(
      'qty', marker_qty,
      'at', now_ms,
      'sourceDocumentNo', coalesce(txn_row.data->'docNumbers'->>'tug10', txn_row.doc_number, txn_row.id),
      'namaPekerjaan', coalesce(txn_row.data->>'namaPekerjaan', txn_row.data->>'keteranganUmum', ''),
      'transactionId', txn_row.id,
      'itemIndex', item_index,
      'note', clean_note,
      'noteUpdatedBy', actor.id,
      'noteUpdatedAt', now_ms
    );
    stock_data := jsonb_set(stock_data, '{tug10ReturnEffects}', effects || jsonb_build_object(p_effect_key, effect), true);
  end if;
  update public.stocks set data = stock_data where id = stock_row.id;
  if to_regclass('public.audit_log') is not null then
    execute 'insert into public.audit_log(user_id,user_name,role,action,entity,entity_id,detail) values ($1,$2,$3,$4,$5,$6,$7)'
      using actor.id, actor.name, actor.role, 'UPDATE', 'STOCK_TUG10_SOURCE_NOTE', stock_row.id,
        jsonb_build_object('effectKey', p_effect_key, 'hasNote', clean_note <> '', 'legacyPromoted', jsonb_typeof(effects->p_effect_key) <> 'object');
  end if;
  return stock_data || jsonb_build_object('id', stock_row.id, 'katalogId', stock_row.katalog_id, 'lokasiId', stock_row.lokasi_id, 'uptId', stock_row.upt_id);
end;
$$;

revoke all on function public.update_tug10_return_note(text, text, text) from public, anon;
grant execute on function public.update_tug10_return_note(text, text, text) to authenticated;
