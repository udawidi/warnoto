-- Read-only verifier. Jalankan dengan service_role pada scratch/staging atau
-- production hanya setelah approval. Tidak mengubah data.

-- Active evidence metadata, Drive metadata, storage path, and storage object.
select count(*) as active_metadata,
       count(*) filter (where drive_file_id is not null) as with_drive_metadata,
       count(*) filter (where storage_path is not null) as with_storage_path,
       count(*) filter (where storage_path is not null and so.name is not null) as storage_objects_found,
       count(*) filter (where storage_path is not null and so.name is null) as missing_storage_objects
from public.maturity_audit_evidence e
left join storage.objects so
  on so.bucket_id = 'maturity-evidence' and so.name = e.storage_path
where e.unlinked_at is null;

-- Missing self-host objects with Drive reference retained.
select e.id, e.audit_id, e.upt, e.aspect_id, e.item_id, e.drive_file_id, e.storage_path
from public.maturity_audit_evidence e
left join storage.objects so
  on so.bucket_id = 'maturity-evidence' and so.name = e.storage_path
where e.unlinked_at is null and e.storage_path is not null and so.name is null
order by e.upt, e.aspect_id, e.item_id;

-- Per-UPT counts, including Drive-only and dual-storage metadata.
select e.upt_id, e.upt,
       count(*) as active_metadata,
       count(*) filter (where e.drive_file_id is not null) as drive_metadata,
       count(*) filter (where e.storage_path is not null) as storage_metadata,
       count(*) filter (where e.storage_path is not null and so.name is not null) as storage_objects_found
from public.maturity_audit_evidence e
left join storage.objects so
  on so.bucket_id = 'maturity-evidence' and so.name = e.storage_path
where e.unlinked_at is null
group by e.upt_id, e.upt
order by e.upt;

-- Legacy orphan ownership remains Pusat-only and must be explicitly annotated.
select count(*) filter (where upt_id is null and data->'_migration'->>'scope' = 'PUSAT_LEGACY_UNSCOPED') as unscoped_legacy_pusat,
       count(*) filter (where upt_id is null and coalesce(data->'_migration'->>'scope', '') <> 'PUSAT_LEGACY_UNSCOPED') as unexpected_unscoped
from public.maturity_assessments;

-- Form 5S photo dual-storage status from persisted JSONB metadata.
select count(*) as form5s_rows,
       count(*) filter (where photo_count > 0) as form5s_with_photos,
       sum(photo_count) as form5s_photo_metadata,
       sum(storage_count) as form5s_storage_metadata,
       sum(storage_object_count) as form5s_storage_objects_found,
       sum(photo_count - storage_object_count) as form5s_missing_storage_objects
from (
  select a.id,
         count(p.value) as photo_count,
         count(p.value) filter (where p.value->>'storagePath' is not null) as storage_count,
         count(p.value) filter (where p.value->>'storagePath' is not null and so.name is not null) as storage_object_count
  from public.maturity_5s_assessments a
  left join lateral jsonb_array_elements(coalesce(a.sample_photos, '[]'::jsonb)) p(value) on true
  left join storage.objects so
    on so.bucket_id = 'maturity-evidence' and so.name = p.value->>'storagePath'
  group by a.id
) photo_status;

-- Review ownership mismatches must be empty.
select r.audit_id, r.upt_id as review_upt_id, a.upt_id as audit_upt_id
from public.maturity_aspect_reviews r
join public.maturity_audits a on a.id = r.audit_id
where r.upt_id is distinct from a.upt_id;

-- Legacy authenticated-wide policies must return zero rows after hardening.
select schemaname, tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('maturity_audits', 'maturity_audit_history', 'maturity_5s_assessments', 'maturity_aspect_reviews', 'maturity_assessments')
  and policyname in (
    'Authenticated read maturity_audits', 'Authenticated write maturity_audits',
    'Authenticated read maturity_audit_history', 'Authenticated write maturity_audit_history',
    'Authenticated read maturity_5s_assessments', 'Authenticated insert maturity_5s_assessments',
    'Authenticated read maturity_assessments', 'Authenticated write maturity_assessments'
  );
