-- ROLLBACK PROPOSAL ONLY — constraint rollback only; never delete photo objects.
begin;
alter table public.stock_opname
  drop constraint if exists stock_opname_data_no_photo_data_url;
drop function if exists public.stock_opname_has_photo_data_url(jsonb);
commit;
