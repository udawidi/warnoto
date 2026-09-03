-- Kontrol penerima notif WA per-user (opt-in), gantikan role-based hardcoded.
-- Idempoten: aman dijalankan ulang.
alter table profiles add column if not exists notif_events text[] default '{}';

update profiles set notif_events = '{COMPLETION}'
  where role in ('TL','ADMIN_UIT','ASMAN_LOG_UIT') and (notif_events is null or notif_events = '{}');

update profiles set notif_events = '{PENDING}'
  where role = 'ASMAN' and (notif_events is null or notif_events = '{}');
