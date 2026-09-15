-- Application rollback only. Keep the column, bucket, and existing objects.
-- Do not execute destructive cleanup from a rollback script.
drop policy if exists "Authenticated read warehouse capacity photos" on storage.objects;
drop policy if exists "Capacity editors upload warehouse photos" on storage.objects;
drop policy if exists "Capacity editors delete warehouse photos" on storage.objects;
