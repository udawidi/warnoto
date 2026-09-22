-- Stock Opname photos are optional. Keep the normalizer, storage boundary,
-- anti-dataURL constraint, and approval RPC; retire only the required-photo trigger.
begin;

drop trigger if exists stock_opname_required_photo_guard on public.stock_opname;

commit;
