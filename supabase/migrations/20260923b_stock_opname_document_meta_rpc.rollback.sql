-- ROLLBACK PROPOSAL ONLY — function removal only; no business rows are deleted.
begin;
revoke all on function public.update_stock_opname_document_meta(text, jsonb) from public;
drop function if exists public.update_stock_opname_document_meta(text, jsonb);
commit;
