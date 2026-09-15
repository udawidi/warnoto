-- Rollback proposal only. Restores the pre-photo RPC behavior; it does not
-- delete rows, storage objects, or receipt history.
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
     or not public.mtu_khs_can_access_upt(r.upt_id) or (a.role <> 'SUPERADMIN' and a.upt_id <> r.upt_id) then raise exception 'MTU_RECEIPT_INVALID'; end if;
  items := x.data->'stockItems';
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then raise exception 'TUG_ITEMS_REQUIRED'; end if;
  for item in select value from jsonb_array_elements(items) loop
    catalog_id := nullif(btrim(coalesce(item->>'katalogId', '')), '');
    location_id := nullif(btrim(coalesce(item->>'lokasiTujuanId', item->>'lokasiId', '')), '');
    if btrim(coalesce(item->>'qty', '')) !~ '^[0-9]+([.][0-9]{1,4})?$' then raise exception 'MTU_RECEIPT_ITEM_INVALID'; end if;
    item_qty := (item->>'qty')::numeric;
    if catalog_id is null or item_qty <= 0 or r.katalog_id is distinct from catalog_id
       or not exists (select 1 from public.katalog where id = catalog_id)
       or not exists (select 1 from public.lokasi l join public.gudang g on g.id = l.gudang_id where l.id = location_id and g.upt_id = r.upt_id) then raise exception 'MTU_RECEIPT_ITEM_INVALID'; end if;
    total_qty := total_qty + item_qty;
  end loop;
  max_qty := greatest(0, r.qty - coalesce((select sum(qty) from public.mtu_khs_receipts where mtu_record_id = r.id), 0));
  if total_qty > max_qty then raise exception 'MTU_RECEIPT_QTY_EXCEEDED'; end if;
  for item in select value from jsonb_array_elements(items) loop
    catalog_id := nullif(btrim(item->>'katalogId'), '');
    location_id := nullif(btrim(coalesce(item->>'lokasiTujuanId', item->>'lokasiId', '')), '');
    select data into catalog_data from public.katalog where id = catalog_id;
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
        'createdAt', extract(epoch from clock_timestamp()) * 1000), (extract(epoch from clock_timestamp()) * 1000)::bigint)
      returning * into stock_row;
      before_qty := 0;
    else
      stock_id := stock_row.id;
      before_qty := coalesce((stock_row.data->>'qty')::numeric, 0);
      update public.stocks set upt_id = coalesce(upt_id, r.upt_id), data = jsonb_set(coalesce(data, '{}'::jsonb), '{qty}', to_jsonb(before_qty + item_qty), true)
        || jsonb_build_object('uptId', r.upt_id, 'mtuRecordId', r.id, 'mtuTug3Id', x.id, 'source', 'MTU_KHS_TUG3') where id = stock_row.id;
    end if;
    after_qty := before_qty + item_qty;
    applied_items := applied_items || jsonb_build_array(jsonb_build_object('stockId', stock_id, 'katalogId', catalog_id, 'lokasiId', location_id, 'qty', item_qty, 'beforeQty', before_qty, 'afterQty', after_qty));
  end loop;
  insert into public.mtu_khs_receipts(mtu_record_id, tug3_transaction_id, qty, items, applied_by, idempotency_key)
  values (r.id, x.id, total_qty, applied_items, a.id, p_idempotency_key) returning * into existing;
  update public.tug3_transactions set stage = 'APPROVED', status = 'APPROVED', data = data || jsonb_build_object('mtuReceiptId', existing.id, 'mtuReceiptAppliedAt', now()), updated_at = (extract(epoch from clock_timestamp()) * 1000)::bigint where id = x.id;
  return jsonb_build_object('receiptId', existing.id, 'deduped', false, 'qty', total_qty, 'items', applied_items);
end;
$$;
revoke all on function public.mtu_khs_apply_tug3_receipt(text,text) from public, anon, authenticated;
grant execute on function public.mtu_khs_apply_tug3_receipt(text,text) to authenticated;
