-- Checklist inspeksi pra-kerja (FASE A) — snapshot item+checked disimpan per trip.
-- PROPOSAL: file ini TIDAK dieksekusi otomatis, menunggu apply manual user.

alter table equipment_trip add column if not exists inspection jsonb;
