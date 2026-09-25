-- Official UIT roles may read heavy-equipment data for referenced UPTs in
-- their UIT. This is proposal-only; apply to self-host only after approval.
-- No write policy is added for UIT roles.

drop policy if exists "Heavy equipment scoped read" on public.heavy_equipment;
create policy "Heavy equipment scoped read" on public.heavy_equipment
  for select to authenticated using (
    exists (
      select 1 from public.profiles actor
      where actor.id = auth.uid()
        and (
          actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT')
          or actor.upt_id = heavy_equipment.upt_id
          or (heavy_equipment.is_cross_upt_borrowable and actor.upt_id is not null)
          or (
            actor.role in ('ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT','HAR_UIT')
            and actor.uit_id is not null
            and exists (
              select 1 from public.upt scoped_upt
              where scoped_upt.id = heavy_equipment.upt_id
                and scoped_upt.uit_id = actor.uit_id
            )
          )
        )
    )
  );

drop policy if exists "Heavy equipment loan scoped read" on public.heavy_equipment_loans;
create policy "Heavy equipment loan scoped read" on public.heavy_equipment_loans
  for select to authenticated using (
    exists (
      select 1 from public.profiles actor
      where actor.id = auth.uid()
        and (
          actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT')
          or actor.upt_id = owner_upt_id
          or actor.upt_id = requester_upt_id
          or (
            actor.role in ('ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT','HAR_UIT')
            and actor.uit_id is not null
            and (
              (actor.role = 'HAR_UIT' and requester_uit_id = actor.uit_id)
              or (actor.role in ('ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT') and exists (
                select 1 from public.upt scoped_upt
                where scoped_upt.id = owner_upt_id and scoped_upt.uit_id = actor.uit_id
              ))
              or exists (
                select 1 from public.upt scoped_upt
                where scoped_upt.id = owner_upt_id
                  and scoped_upt.uit_id = actor.uit_id
              )
              or exists (
                select 1 from public.upt scoped_upt
                where scoped_upt.id = requester_upt_id
                  and scoped_upt.uit_id = actor.uit_id
              )
            )
          )
        )
    )
  );

drop policy if exists "Heavy equipment evidence read" on storage.objects;
create policy "Heavy equipment evidence read" on storage.objects
  for select to authenticated using (
    bucket_id = 'heavy-equipment-evidence'
    and exists (
      select 1 from public.profiles actor
      where actor.id = auth.uid()
        and (
          actor.role in ('SUPERADMIN','ADMIN_LOG_PUSAT')
          or actor.upt_id = (storage.foldername(name))[1]
          or exists (
            select 1 from public.heavy_equipment_loans l
            where (
              l.data->>'pickupEvidencePath' = name
              or l.data->>'returnEvidencePath' = name
              or exists (
                select 1 from jsonb_array_elements(coalesce(l.data->'returnEvents', '[]'::jsonb)) event
                where event->>'evidencePath' = name
              )
            )
            and (
              actor.upt_id = l.requester_upt_id
              or (
                actor.role in ('ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT','HAR_UIT')
                and actor.uit_id is not null
                and (
                  (actor.role = 'HAR_UIT' and actor.uit_id = l.requester_uit_id)
                  or (actor.role in ('ADMIN_UIT','ASMAN_LOG_UIT','MGR_LOGISTIK_UIT') and exists (
                    select 1 from public.upt scoped_upt
                    where scoped_upt.id = l.owner_upt_id and scoped_upt.uit_id = actor.uit_id
                  ))
                  or exists (
                    select 1 from public.upt scoped_upt
                    where scoped_upt.id = l.owner_upt_id
                      and scoped_upt.uit_id = actor.uit_id
                  )
                  or exists (
                    select 1 from public.upt scoped_upt
                    where scoped_upt.id = l.requester_upt_id
                      and scoped_upt.uit_id = actor.uit_id
                  )
                )
              )
            )
          )
        )
    )
  );

notify pgrst, 'reload schema';
