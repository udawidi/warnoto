-- Fix the storage object column reference in the heavy-equipment evidence INSERT policy.
-- The explicit qualification prevents `name` from resolving to profiles.name.
drop policy if exists "Heavy equipment evidence insert" on storage.objects;

create policy "Heavy equipment evidence insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'heavy-equipment-evidence'
    and exists (
      select 1 from public.profiles actor
      where actor.id = auth.uid()
        and (
          (
            actor.role = 'TL'
            and actor.upt_id = (storage.foldername(storage.objects.name))[1]
          )
          or (
            actor.role = 'HAR_UIT'
            and actor.uit_id is not null
            and exists (
              select 1
              from public.upt scoped_upt
              where scoped_upt.id = (storage.foldername(storage.objects.name))[1]
                and scoped_upt.uit_id = actor.uit_id
            )
          )
        )
    )
  );
