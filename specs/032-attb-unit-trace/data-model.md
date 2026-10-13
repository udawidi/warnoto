# Data Model: ATTB Unit Trace

## attb_public_links

- `attb_id text primary key` → `attb_list.id`
- `public_token uuid unique not null`
- `upt_id text not null`
- `created_at bigint not null`
- `rotated_at bigint null`

Hanya record baru dari final TUG-10. Update hanya melalui fungsi server untuk rotasi token.

## attb_item_history

- `id bigint generated identity primary key`
- `attb_id text not null` → `attb_list.id`
- `upt_id text not null`
- `event_type text not null`
- `stage text null`
- `occurred_at bigint not null`
- `actor_id uuid null`
- `snapshot jsonb not null`

Append-only. RLS read mengikuti `can_access_upt(upt_id)`; client tidak mendapat write grant.

## Identity and State

- `sourceTug10Key = TUG10|transactionId|itemIndex` unik secara bisnis.
- Tracking code memakai `attb_list.id` deterministic existing.
- Event awal `RECEIVED_TUG10`; event berikutnya diturunkan dari perubahan status/tahap/lokasi/hold.
- Public payload memetakan event ke label aman dan tidak mengembalikan actor/catatan internal.

