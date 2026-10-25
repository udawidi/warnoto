-- PROPOSAL ONLY — apply to Supabase production only after explicit approval.
-- Sampling metadata is additive. Existing evidence remains legacy when these
-- columns are NULL/false; no files are moved or rewritten.

alter table public.maturity_audit_evidence
  add column if not exists sample_id text,
  add column if not exists sample_label text,
  add column if not exists sample_group text,
  add column if not exists supplementary_folder_id text,
  add column if not exists supplementary_folder_name text,
  add column if not exists is_supplementary boolean not null default false;

alter table public.maturity_audit_evidence
  drop constraint if exists maturity_audit_evidence_sample_metadata_check;
alter table public.maturity_audit_evidence
  add constraint maturity_audit_evidence_sample_metadata_check check (
    (is_supplementary = true and sample_id is null and sample_group is null)
    or (is_supplementary = false and sample_id is null and sample_group is null)
    or (is_supplementary = false and sample_id is not null and sample_group is not null and sample_label is not null)
  );

create index if not exists idx_maturity_audit_evidence_sample
  on public.maturity_audit_evidence(audit_id, aspect_id, sample_group, sample_id)
  where unlinked_at is null;

alter table public.maturity_audit_drive_folders
  drop constraint if exists maturity_audit_drive_folders_folder_type_check;
alter table public.maturity_audit_drive_folders
  add constraint maturity_audit_drive_folders_folder_type_check
  check (folder_type in ('ROOT', 'PERIOD', 'UPT', 'CATEGORY', 'ASPECT', 'ITEM', 'FORM5S', 'SAMPLE', 'SUPPLEMENTARY'));

alter table public.maturity_aspect_reviews
  add column if not exists sample_id text not null default '';
alter table public.maturity_aspect_reviews drop constraint if exists maturity_aspect_reviews_pkey;
alter table public.maturity_aspect_reviews
  add constraint maturity_aspect_reviews_pkey primary key (audit_id, aspect_id, item_id, sample_id);
alter table public.maturity_aspect_reviews alter column sample_id drop default;
create index if not exists maturity_aspect_reviews_sample_idx
  on public.maturity_aspect_reviews(audit_id, aspect_id, sample_id);

