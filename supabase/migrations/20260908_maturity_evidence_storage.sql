-- PROPOSAL ONLY — jangan dijalankan ke self-host production tanpa persetujuan user.
-- Idempoten: tambah backup self-host untuk evidence Maturity (Drive tetap wajib,
-- ini cadangan best-effort agar file tetap terbaca kalau token Drive habis).

alter table public.maturity_audit_evidence add column if not exists storage_path text;

insert into storage.buckets (id, name, public)
values ('maturity-evidence', 'maturity-evidence', false)
on conflict (id) do update set public = false;

-- Bucket privat, TANPA policy authenticated/anon: satu-satunya jalur akses
-- adalah Edge Function maturity-drive lewat service_role, yang otomatis
-- bypass RLS storage.objects (BYPASSRLS bawaan Supabase). Tidak perlu grant
-- eksplisit.
