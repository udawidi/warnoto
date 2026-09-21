-- Proposal only. Apply to production self-host only after explicit approval.
-- Remove the unused Stock Opname freeze policy. Keep existing freshness and Realtime objects intact.
begin;

drop trigger if exists trg_stock_opname_guard_freeze on public.stock_opname;
drop function if exists public.guard_stock_opname_freeze_change();
drop function if exists public.set_stock_opname_freeze(text, boolean, text[]);

commit;
