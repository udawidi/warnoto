-- Form 5S baru wajib memiliki object foto self-host yang tercatat.
-- Legacy rows tidak disentuh; backfill-5s mengisi metadata secara bertahap.
create or replace function public.validate_maturity_5s_photo_storage()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  photo jsonb;
  storage_path text;
begin
  if jsonb_typeof(new.sample_photos) <> 'array' or jsonb_array_length(new.sample_photos) not between 1 and 3 then
    raise exception 'FORM5S_PHOTO_COUNT_INVALID: Form 5S baru wajib memiliki 1 sampai 3 foto.' using errcode = '23514';
  end if;
  for photo in select value from jsonb_array_elements(new.sample_photos)
  loop
    storage_path := coalesce(photo->>'storagePath', photo->>'storage_path', '');
    if storage_path = '' or storage_path not like 'form-5s/' || new.upt_id || '/%' then
      raise exception 'FORM5S_STORAGE_PATH_INVALID: path foto harus memakai prefix form-5s/<upt_id>/. ' using errcode = '23514';
    end if;
    if coalesce(photo->>'storageStatus', photo->>'storage_status', '') <> 'BACKUP_RECORDED' then
      raise exception 'FORM5S_STORAGE_STATUS_INVALID: foto harus berstatus BACKUP_RECORDED.' using errcode = '23514';
    end if;
    if not exists (
      select 1 from storage.objects
      where bucket_id = 'maturity-evidence' and name = storage_path
    ) then
      raise exception 'FORM5S_STORAGE_OBJECT_MISSING: object foto tidak ditemukan di bucket maturity-evidence.' using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_validate_maturity_5s_photo_storage on public.maturity_5s_assessments;
create trigger trg_validate_maturity_5s_photo_storage
before insert on public.maturity_5s_assessments
for each row execute function public.validate_maturity_5s_photo_storage();

revoke all on function public.validate_maturity_5s_photo_storage() from public;
grant execute on function public.validate_maturity_5s_photo_storage() to authenticated, service_role;
notify pgrst, 'reload schema';
