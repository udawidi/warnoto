-- ROLLBACK PROPOSAL ONLY — function removal only; no business rows are deleted.
begin;
revoke all on function public.approve_stock_opname_asman(text, jsonb, jsonb, jsonb) from public;
drop function if exists public.approve_stock_opname_asman(text, jsonb, jsonb, jsonb);
commit;
