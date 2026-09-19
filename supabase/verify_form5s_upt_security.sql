-- Read-only/rollback verifier. Run as postgres on a staging or production
-- database only after the migration has been reviewed. No data remains.
begin;

do $$
declare
  policy_expr text;
  trigger_count integer;
  missing_count integer;
  valid_id text;
  valid_upt_id text;
  valid_photos jsonb;
  test_id text := 'VERIFY-FORM5S-' || substr(md5(clock_timestamp()::text), 1, 12);
  rejected boolean;
  draft_policy_count integer;
begin
  select count(*) into trigger_count
  from pg_trigger
  where tgrelid = 'public.maturity_5s_assessments'::regclass
    and tgname = 'trg_validate_maturity_5s_photo_storage'
    and not tgisinternal;
  if trigger_count <> 1 then raise exception 'FAIL trigger Form 5S tidak terpasang.'; end if;

  select coalesce((select qual from pg_policies where schemaname = 'public' and tablename = 'maturity_5s_assessments' and policyname = 'Maturity 5s read scoped final'), '') into policy_expr;
  if position('can_access_maturity_upt' in policy_expr) = 0 then raise exception 'FAIL policy read Form 5S tidak memakai can_access_maturity_upt.'; end if;

  select count(*) into missing_count
  from public.maturity_5s_assessments a
  cross join lateral jsonb_array_elements(coalesce(a.sample_photos, '[]'::jsonb)) p
  where coalesce(p->>'storagePath', p->>'storage_path', '') = ''
     or not exists (select 1 from storage.objects o where o.bucket_id = 'maturity-evidence' and o.name = coalesce(p->>'storagePath', p->>'storage_path'));
  raise notice 'form5s_storage_objects_missing=%', missing_count;
  if missing_count > 0 then raise exception 'FAIL % Form 5S photo objects missing from self-host.', missing_count; end if;

  select a.id, a.upt_id, a.sample_photos into valid_id, valid_upt_id, valid_photos
  from public.maturity_5s_assessments a
  where jsonb_array_length(coalesce(a.sample_photos, '[]'::jsonb)) between 1 and 3
    and not exists (
      select 1 from jsonb_array_elements(a.sample_photos) p
      where coalesce(p->>'storageStatus', p->>'storage_status', '') <> 'BACKUP_RECORDED'
         or coalesce(p->>'storagePath', p->>'storage_path', '') not like 'form-5s/' || a.upt_id || '/%'
         or not exists (select 1 from storage.objects o where o.bucket_id = 'maturity-evidence' and o.name = coalesce(p->>'storagePath', p->>'storage_path'))
    )
  limit 1;

  if valid_upt_id is null then
    select id into valid_upt_id from public.upt where id is not null limit 1;
  end if;

  if valid_id is not null then
    insert into public.maturity_5s_assessments (id, upt, upt_id, gudang_id, gudang_nama, bulan, tahun, auditor, checklist, sample_photos, total_items, total_checked, score_percent, catatan, created_at)
    select test_id, a.upt, a.upt_id, a.gudang_id, a.gudang_nama, a.bulan, a.tahun, a.auditor, a.checklist, a.sample_photos, a.total_items, a.total_checked, a.score_percent, a.catatan, a.created_at
    from public.maturity_5s_assessments a where a.id = valid_id;
    raise notice 'PASS valid existing object accepted in transaction';

  else
    raise notice 'SKIP valid object acceptance: belum ada fixture object self-host yang cocok.';
  end if;

  if valid_upt_id is not null then
    rejected := false;
    begin
      insert into public.maturity_5s_assessments (id, upt, upt_id, bulan, tahun, auditor, checklist, sample_photos, total_items, total_checked, score_percent, catatan, created_at)
      values (test_id || '-MISSING', 'VERIFY', valid_upt_id, 1, 2026, 'VERIFY', '[]', jsonb_build_array(jsonb_build_object('storagePath', 'form-5s/' || valid_upt_id || '/missing/verify.jpg', 'storageStatus', 'BACKUP_RECORDED')), 1, 0, 0, 'VERIFY', 0);
    exception when sqlstate '23514' then
      rejected := true;
      raise notice 'PASS missing object ditolak: %', sqlerrm;
    end;
    if not rejected then raise exception 'FAIL missing object diterima trigger.'; end if;

    rejected := false;
    begin
      insert into public.maturity_5s_assessments (id, upt, upt_id, bulan, tahun, auditor, checklist, sample_photos, total_items, total_checked, score_percent, catatan, created_at)
      values (test_id || '-MISMATCH', 'VERIFY', valid_upt_id, 1, 2026, 'VERIFY', '[]', jsonb_build_array(jsonb_build_object('storagePath', 'form-5s/OTHER-UPT/verify.jpg', 'storageStatus', 'BACKUP_RECORDED')), 1, 0, 0, 'VERIFY', 0);
    exception when sqlstate '23514' then
      rejected := true;
      raise notice 'PASS mismatched prefix ditolak: %', sqlerrm;
    end;
    if not rejected then raise exception 'FAIL mismatched prefix diterima trigger.'; end if;
  else
    raise notice 'SKIP invalid trigger rejection: belum ada UPT fixture.';
  end if;

  if to_regclass('public.maturity_5s_drafts') is null then
    raise exception 'FAIL tabel maturity_5s_drafts belum tersedia.';
  end if;
  select count(*) into draft_policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'maturity_5s_drafts'
    and policyname in (
      'Maturity 5s drafts owner read',
      'Maturity 5s drafts owner insert',
      'Maturity 5s drafts owner update',
      'Maturity 5s drafts owner delete'
    );
  if draft_policy_count <> 4 then
    raise exception 'FAIL policy draft owner/Upt tidak lengkap: %/4.', draft_policy_count;
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'maturity_5s_drafts'
      and indexdef ilike '%unique%owner_id%upt_id%'
  ) then
    raise exception 'FAIL draft tidak memiliki uniqueness owner_id + upt_id.';
  end if;
  raise notice 'PASS maturity_5s_drafts owner + UPT scoped, tanpa mutasi data.';
end;
$$;

rollback;
