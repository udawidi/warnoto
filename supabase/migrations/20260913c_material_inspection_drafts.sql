-- Proposal only. Do not apply to self-host production without user confirmation.
-- Draft inspeksi bersifat private per pembuat. Foto draft tetap di bucket yang sama.

create table if not exists public.material_inspection_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  upt_id text not null,
  gudang_id text null,
  data jsonb not null default '{}'::jsonb,
  photo_paths text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_material_inspection_drafts_owner_updated
  on public.material_inspection_drafts(owner_id, updated_at desc);
create index if not exists idx_material_inspection_drafts_upt
  on public.material_inspection_drafts(upt_id);

create or replace function public.touch_material_inspection_draft_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists material_inspection_drafts_touch_updated_at on public.material_inspection_drafts;
create trigger material_inspection_drafts_touch_updated_at
  before update on public.material_inspection_drafts
  for each row execute function public.touch_material_inspection_draft_updated_at();

create or replace function public.can_manage_material_inspection_draft(
  p_owner_id uuid,
  p_upt_id text,
  p_gudang_id text
)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.profiles actor
    where actor.id = auth.uid()
      and actor.id = p_owner_id
      and actor.role in ('ADMIN', 'TL')
      and actor.upt_id is not null
      and actor.upt_id = p_upt_id
      and (p_gudang_id is null or exists (
        select 1 from public.gudang g
        where g.id = p_gudang_id and g.upt_id = actor.upt_id
      ))
      and (
        p_gudang_id is null
        or actor.gudang_ids is null
        or (
          jsonb_typeof(actor.gudang_ids) = 'array'
          and (jsonb_array_length(actor.gudang_ids) = 0 or actor.gudang_ids ? p_gudang_id)
        )
      )
  );
$$;
revoke all on function public.can_manage_material_inspection_draft(uuid, text, text) from public;
grant execute on function public.can_manage_material_inspection_draft(uuid, text, text) to authenticated;

alter table public.material_inspection_drafts enable row level security;
grant select, insert, update, delete on public.material_inspection_drafts to authenticated;
grant all on public.material_inspection_drafts to service_role;

drop policy if exists "Owner read material_inspection_drafts" on public.material_inspection_drafts;
drop policy if exists "Owner insert material_inspection_drafts" on public.material_inspection_drafts;
drop policy if exists "Owner update material_inspection_drafts" on public.material_inspection_drafts;
drop policy if exists "Owner delete material_inspection_drafts" on public.material_inspection_drafts;
create policy "Owner read material_inspection_drafts" on public.material_inspection_drafts
  for select to authenticated
  using (public.can_manage_material_inspection_draft(owner_id, upt_id, gudang_id));
create policy "Owner insert material_inspection_drafts" on public.material_inspection_drafts
  for insert to authenticated
  with check (public.can_manage_material_inspection_draft(owner_id, upt_id, gudang_id));
create policy "Owner update material_inspection_drafts" on public.material_inspection_drafts
  for update to authenticated
  using (public.can_manage_material_inspection_draft(owner_id, upt_id, gudang_id))
  with check (public.can_manage_material_inspection_draft(owner_id, upt_id, gudang_id));
create policy "Owner delete material_inspection_drafts" on public.material_inspection_drafts
  for delete to authenticated
  using (public.can_manage_material_inspection_draft(owner_id, upt_id, gudang_id));

-- Existing ADMIN/TL prefix policies intentionally remain the upload/delete gate.
-- This policy adds the read gate: owner + path explicitly listed by the draft.
drop policy if exists "Owner read material-inspection-draft-photos" on storage.objects;
create policy "Owner read material-inspection-draft-photos" on storage.objects
  for select to authenticated using (
    bucket_id = 'material-inspection-photos'
    and name like (auth.uid()::text || '/drafts/%')
    and exists (
      select 1
      from public.material_inspection_drafts d
      where d.owner_id = auth.uid()
        and name = any(d.photo_paths)
    )
  );

-- Re-apply the latest inspected-material RPC with v2 final-form guards.
create or replace function public.create_material_inspection_batch(p_items jsonb, p_header jsonb)
returns jsonb as $$
declare
  v_inspector uuid := auth.uid();
  v_upt text := nullif(p_header->>'upt_id', '');
  v_actor_upt text;
  v_actor_gudang_ids jsonb;
  v_tanggal date := coalesce((p_header->>'tanggal')::date, now()::date);
  v_gudang text := nullif(p_header->>'gudang_id', '');
  v_logistik_requested text := nullif(p_header->>'pelaksanaLogistikId', '');
  v_logistik_id uuid;
  v_logistik_name text;
  v_header_data jsonb;
  v_count int;
  v_seq bigint;
  v_nomor text;
  v_batch_id uuid;
  v_items jsonb;
begin
  if v_inspector is null then
    raise exception 'Tidak terautentikasi.';
  end if;
  if not exists (select 1 from public.profiles where id = v_inspector and role in ('ADMIN', 'TL')) then
    raise exception 'Hanya ADMIN/TL yang boleh membuat BA inspeksi.';
  end if;
  select upt_id, gudang_ids into v_actor_upt, v_actor_gudang_ids
  from public.profiles where id = v_inspector;
  if v_actor_upt is null or v_upt is null or v_upt <> v_actor_upt then
    raise exception 'UPT BA harus sama dengan UPT profil pemeriksa.';
  end if;
  if v_gudang is null or not exists (
    select 1 from public.gudang g where g.id = v_gudang and g.upt_id = v_actor_upt
  ) then
    raise exception 'Gudang BA tidak ditemukan pada UPT pemeriksa.';
  end if;
  if v_actor_gudang_ids is not null and (
    jsonb_typeof(v_actor_gudang_ids) <> 'array'
    or (jsonb_array_length(v_actor_gudang_ids) > 0 and not (v_actor_gudang_ids ? v_gudang))
  ) then
    raise exception 'Gudang BA tidak diizinkan untuk pemeriksa ini.';
  end if;

  if v_logistik_requested is null then
    select id, name into v_logistik_id, v_logistik_name
    from public.profiles where id = v_inspector and role in ('ADMIN', 'TL') and upt_id = v_actor_upt;
  else
    select id, name into v_logistik_id, v_logistik_name
    from public.profiles
    where id::text = v_logistik_requested
      and role in ('ADMIN', 'TL')
      and upt_id = v_actor_upt;
    if not found then
      raise exception 'Pelaksana logistik harus ADMIN/TL pada UPT pemeriksa.';
    end if;
  end if;
  if v_logistik_id is null then
    raise exception 'Profil pelaksana logistik tidak ditemukan.';
  end if;
  v_header_data := coalesce(p_header, '{}'::jsonb) || jsonb_build_object(
    'pelaksanaLogistikId', v_logistik_id,
    'pelaksanaLogistik', v_logistik_name
  );

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Daftar material tidak valid.';
  end if;
  v_count := jsonb_array_length(p_items);
  if v_count < 1 or v_count > 10 then
    raise exception 'Satu BA harus berisi 1 sampai 10 material (diterima %).', v_count;
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e where nullif(e.value->>'stock_id', '') is null) then
    raise exception 'Setiap material wajib punya stock_id.';
  end if;
  if (select count(distinct e.value->>'stock_id') from jsonb_array_elements(p_items) e) <> v_count then
    raise exception 'Material duplikat dalam satu BA tidak diperbolehkan.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where not exists (select 1 from public.stocks s where s.id = e.value->>'stock_id')
  ) then
    raise exception 'Ada stock_id yang tidak ditemukan di data stok.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) e
    join public.stocks s on s.id = e.value->>'stock_id'
    left join public.lokasi l on l.id = s.lokasi_id
    left join public.gudang g on g.id = l.gudang_id
    where (
      s.lokasi_id is null
      and s.upt_id is distinct from v_actor_upt
    )
    or (
      s.lokasi_id is not null
      and (g.id is null or g.id <> v_gudang or g.upt_id <> v_actor_upt)
    )
  ) then
    raise exception 'Setiap material harus berada pada UPT BA; material berlokasi wajib berada pada gudang BA.';
  end if;

  -- v1 clients may still send boolean checklist values. v2 is strict and tri-state.
  if p_header->>'inspectionFormVersion' = '2' then
    if exists (
      select 1 from jsonb_array_elements(p_items) e
      where (e.value->'checklist'->>'kebersihan') is distinct from 'SESUAI'
        and (e.value->'checklist'->>'kebersihan') is distinct from 'TIDAK_SESUAI'
        or (e.value->'checklist'->>'bebasKarat') is distinct from 'SESUAI'
        and (e.value->'checklist'->>'bebasKarat') is distinct from 'TIDAK_SESUAI'
        or (e.value->'checklist'->>'bebasBocor') is distinct from 'SESUAI'
        and (e.value->'checklist'->>'bebasBocor') is distinct from 'TIDAK_SESUAI'
        or (e.value->'checklist'->>'kemasanBaik') is distinct from 'SESUAI'
        and (e.value->'checklist'->>'kemasanBaik') is distinct from 'TIDAK_SESUAI'
    ) then
      raise exception 'Setiap checklist visual wajib dinilai SESUAI atau TIDAK_SESUAI.';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_items) e
      where jsonb_typeof(e.value->'photoPaths') <> 'array'
        or jsonb_array_length(e.value->'photoPaths') <> 2
    ) then
      raise exception 'Setiap material wajib memiliki tepat dua foto inspeksi.';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(p_items) e
      cross join lateral jsonb_array_elements_text(e.value->'photoPaths') photo(path)
      where not (photo.path like (v_inspector::text || '/%'))
        or not exists (
          select 1 from storage.objects object_row
          where object_row.bucket_id = 'material-inspection-photos'
            and object_row.name = photo.path
        )
    ) then
      raise exception 'Foto inspeksi tidak valid atau bukan milik pemeriksa.';
    end if;
  end if;

  insert into public.material_inspection_seq (upt_id, tahun, last_seq)
  values (v_upt, extract(year from v_tanggal)::int, 1)
  on conflict (upt_id, tahun) do update set last_seq = material_inspection_seq.last_seq + 1
  returning last_seq into v_seq;
  v_nomor := lpad(v_seq::text, 6, '0') || '/BA-INSPEKSI/' || v_upt || '/'
    || to_char(v_tanggal, 'MM') || '/' || to_char(v_tanggal, 'YYYY');
  insert into public.material_inspection_batches (nomor_ba, upt_id, gudang_id, tanggal, inspector_id, data)
  values (v_nomor, v_upt, v_gudang, v_tanggal, v_inspector, v_header_data)
  returning id into v_batch_id;
  with inserted as (
    insert into public.material_inspections (batch_id, stock_id, katalog_id, lokasi_id, inspector_id, data)
    select v_batch_id, s.id, s.katalog_id, s.lokasi_id, v_inspector, e.value - 'stock_id'
    from jsonb_array_elements(p_items) e
    join public.stocks s on s.id = e.value->>'stock_id'
    returning id, batch_id, stock_id, katalog_id, lokasi_id, inspector_id, data, created_at
  )
  select coalesce(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb) into v_items from inserted;
  return jsonb_build_object('batch_id', v_batch_id, 'nomor_ba', v_nomor, 'items', v_items);
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function public.create_material_inspection_batch(jsonb, jsonb) from public;
grant execute on function public.create_material_inspection_batch(jsonb, jsonb) to authenticated;
