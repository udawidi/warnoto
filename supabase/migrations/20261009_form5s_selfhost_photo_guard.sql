-- Form 5S baru wajib memakai object self-host yang benar-benar ada.
-- Migration 20261008 sudah applied dan sengaja tidak diubah.
create or replace function public.validate_maturity_5s_photo_storage()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  photo jsonb;
  storage_path text;
  category text;
  categories text[] := array['sort', 'set', 'shine', 'standardize', 'sustain'];
  photo_count integer;
  storage_status text;
  object_mime text;
  object_size text;
begin
  if jsonb_typeof(new.sample_photos) <> 'array' then
    raise exception 'FORM5S_PHOTO_COUNT_INVALID: sample_photos harus berupa array.' using errcode = '23514';
  end if;
  photo_count := jsonb_array_length(new.sample_photos);

  if photo_count <> 15 then
    raise exception 'FORM5S_PHOTO_COUNT_INVALID: Form 5S baru wajib memiliki 15 foto (3 per kategori).' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(new.sample_photos) item
    where coalesce(item->>'categoryId', '') = ''
      or not (item->>'categoryId' = any(categories))
  ) then
    raise exception 'FORM5S_CATEGORY_INVALID: setiap foto baru wajib memiliki kategori canonical.' using errcode = '23514';
  end if;
  foreach category in array categories loop
    if (select count(*) from jsonb_array_elements(new.sample_photos) item where item->>'categoryId' = category) <> 3 then
      raise exception 'FORM5S_CATEGORY_COUNT_INVALID: setiap kategori Form 5S wajib memiliki tepat 3 foto.' using errcode = '23514';
    end if;
  end loop;

  for photo in select value from jsonb_array_elements(new.sample_photos) loop
    storage_path := coalesce(photo->>'storagePath', photo->>'storage_path', '');
    if storage_path = '' or storage_path not like 'form-5s/' || new.upt_id || '/%' then
      raise exception 'FORM5S_STORAGE_PATH_INVALID: path foto harus memakai prefix form-5s/<upt_id>/. ' using errcode = '23514';
    end if;
    storage_status := coalesce(photo->>'storageStatus', photo->>'storage_status', '');
    if storage_status not in ('SELF_HOST_RECORDED', 'BACKUP_RECORDED') then
      raise exception 'FORM5S_STORAGE_STATUS_INVALID: foto harus berstatus SELF_HOST_RECORDED atau BACKUP_RECORDED legacy.' using errcode = '23514';
    end if;
    if storage_status = 'SELF_HOST_RECORDED' and (
      (photo->>'isDrive') is distinct from 'false'
      or (photo->>'syncedToDrive') is distinct from 'false'
      or photo ? 'driveFileId'
      or photo ? 'drive_file_id'
      or photo ? 'url'
    ) then
      raise exception 'FORM5S_STORAGE_METADATA_INVALID: foto self-host tidak boleh membawa metadata Drive.' using errcode = '23514';
    end if;
    select o.metadata->>'mimetype', o.metadata->>'size'
      into object_mime, object_size
      from storage.objects o
     where o.bucket_id = 'maturity-evidence' and o.name = storage_path;
    if not found then
      raise exception 'FORM5S_STORAGE_OBJECT_MISSING: object foto tidak ditemukan di bucket maturity-evidence.' using errcode = '23514';
    end if;
    if lower(coalesce(object_mime, '')) not like 'image/%' then
      raise exception 'FORM5S_STORAGE_MIME_INVALID: object foto harus memiliki MIME image/*.' using errcode = '23514';
    end if;
    if object_size is null or object_size !~ '^[0-9]+$' or (case when object_size ~ '^[0-9]+$' then object_size::bigint else 2097153 end) > 2097152 then
      raise exception 'FORM5S_PHOTO_SIZE_INVALID: ukuran object foto maksimal 2 MiB.' using errcode = '23514';
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
