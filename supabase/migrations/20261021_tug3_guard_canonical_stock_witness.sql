-- Allow canonical TUG-8/TUG-9 stock OUT updates to pass the legacy TUG-3 guard.
-- The witness is tied to the current PostgreSQL transaction, so a direct stock
-- write cannot borrow an old movement row.
begin;

alter table public.stock_movements
  add column if not exists xact_id bigint not null default txid_current();

create or replace function public.tug3_guard_legacy_stock_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_old_qty numeric;
  v_new_qty numeric;
begin
  if coalesce(current_setting('app.tug3_final_rpc', true), '') = 'on'
     or coalesce(current_setting('app.mtu_khs_receipt_rpc', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' and (
       new.data ? '_tug3Applied'
       or new.data->'sourceLot'->>'kind' = 'TUG3_CONTRACT'
     ) then
    raise exception 'TUG3_STOCK_RPC_REQUIRED' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.data->'_tug3Applied' is distinct from old.data->'_tug3Applied' then
    raise exception 'TUG3_STOCK_RPC_REQUIRED' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.data->'sourceLot'->>'kind' = 'TUG3_CONTRACT'
     and (new.data->>'qty' is distinct from old.data->>'qty'
       or new.data->'sourceLot' is distinct from old.data->'sourceLot') then
    v_old_qty := coalesce(nullif(old.data->>'qty', '')::numeric, 0);
    v_new_qty := coalesce(nullif(new.data->>'qty', '')::numeric, 0);
    if new.data->'sourceLot' is distinct from old.data->'sourceLot'
       or v_new_qty >= v_old_qty
       or not exists (
      select 1
      from public.stock_movements m
      join public.tug_transactions t on t.id = m.transaction_id
      join public.tug_items i on i.id = m.tug_item_id and i.transaction_id = m.transaction_id
      where m.xact_id = txid_current()
        and m.direction = 'OUT'
        and t.doc_type in ('TUG8', 'TUG9')
        and t.status = 'PENDING'
        and t.stage = 'PENDING_ASMAN'
        and m.stock_id = old.id
        and i.stock_id = old.id
        and m.before_qty = v_old_qty
        and m.after_qty = v_new_qty
        and m.qty = v_old_qty - v_new_qty
        and m.qty = i.qty
    ) then
      raise exception 'TUG3_STOCK_RPC_REQUIRED' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tug3_guard_legacy_stock_write on public.stocks;
create trigger trg_tug3_guard_legacy_stock_write
before insert or update on public.stocks
for each row execute function public.tug3_guard_legacy_stock_write();
revoke all on function public.tug3_guard_legacy_stock_write() from public, anon, authenticated;

commit;
