-- Form 5S record baru memakai lima kategori x tiga foto. Trigger BEFORE INSERT
-- hanya memvalidasi insert baru; existing legacy rows tidak disentuh.
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
    if coalesce(photo->>'storageStatus', photo->>'storage_status', '') <> 'BACKUP_RECORDED' then
      raise exception 'FORM5S_STORAGE_STATUS_INVALID: foto harus berstatus BACKUP_RECORDED.' using errcode = '23514';
    end if;
    if photo_count = 15 and coalesce((photo->>'size')::bigint, 0) > 2097152 then
      raise exception 'FORM5S_PHOTO_SIZE_INVALID: foto Form 5S maksimal 2 MiB.' using errcode = '23514';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'maturity-evidence' and name = storage_path) then
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
