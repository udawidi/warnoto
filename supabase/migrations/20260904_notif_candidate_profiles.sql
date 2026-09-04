-- Fix: role UIT (Kantor Induk) tak pernah dapat WA notif.
-- enqueueTugNotif (client) meresolve penerima dgn SELECT profiles yang jalan sebagai approver,
-- tunduk RLS can_read_profile → approver tier-UPT tak bisa baca profil UIT (upt_id UIT null) →
-- UIT tak masuk penerima. Fungsi SECURITY DEFINER ini mengembalikan kandidat penerima (profil
-- opt-in untuk event) tanpa terhalang RLS visibilitas approver. Filter tier/scope tetap di client.
create or replace function public.notif_candidate_profiles(p_event text)
returns table (role text, upt_id text, uit_id text, official_phone text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select role, upt_id, uit_id, official_phone
  from public.profiles
  where notif_events @> array[p_event]::text[]
$$;

revoke all on function public.notif_candidate_profiles(text) from public;
grant execute on function public.notif_candidate_profiles(text) to authenticated;
