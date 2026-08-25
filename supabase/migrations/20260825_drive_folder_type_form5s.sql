-- Form 5S menyimpan foto sampling ke folder Drive tersendiri (folder_type = 'FORM5S').
-- Tipe ini SENGAJA di luar daftar scan sync audit (ITEM = evidence, ROOT/PERIOD/UPT/
-- CATEGORY/ASPECT = sumber unassigned) supaya foto Form 5S tidak ikut ter-reconcile
-- menjadi evidence audit. Perluas CHECK constraint agar nilai baru ini diterima.
ALTER TABLE public.maturity_audit_drive_folders
  DROP CONSTRAINT IF EXISTS maturity_audit_drive_folders_folder_type_check;

ALTER TABLE public.maturity_audit_drive_folders
  ADD CONSTRAINT maturity_audit_drive_folders_folder_type_check
  CHECK (folder_type = ANY (ARRAY['ROOT','PERIOD','UPT','CATEGORY','ASPECT','ITEM','FORM5S']));
