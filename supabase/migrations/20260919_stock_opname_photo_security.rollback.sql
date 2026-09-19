-- ROLLBACK PROPOSAL ONLY — do not execute without incident review.
begin;
drop policy if exists "Stock Opname upload stock-photos" on storage.objects;
drop policy if exists "Stock Opname update stock-photos" on storage.objects;
create policy "Public upload stock-photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'stock-photos' and auth.role() = 'authenticated');
create policy "Public update stock-photos" on storage.objects
  for update to authenticated
  using (bucket_id = 'stock-photos' and auth.role() = 'authenticated')
  with check (bucket_id = 'stock-photos' and auth.role() = 'authenticated');
revoke all on function public.can_write_stock_photo_path(text) from public;
drop function if exists public.can_write_stock_photo_path(text);
commit;
