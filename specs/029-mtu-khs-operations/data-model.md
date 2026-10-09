# Data Model: Operasional MTU KHS

## Perubahan Record

- `mtu_khs_records.lokasi_id`: nullable FK ke `lokasi`; harus satu UPT dengan record.
- `search_text`: normalized stored text untuk ranking/pencarian.

## Record Event

- `id`, `record_id`, `event_type`, `actor_id`, `source_upt_id`, `target_upt_id`
- `before_data`, `after_data`, `metadata`, `created_at`
- Append-only; tidak ada update/delete client.

## Evidence

- `id`, `record_id`, `kind` (`ITEM`, `NAMEPLATE`), `object_path`, `mime_type`, `size_bytes`
- `uploaded_by`, `created_at`, `superseded_at`, `inherited_from`
- Unique partial satu evidence aktif per `(record_id, kind)`.

## Transfer Request

- Identitas: `id`, `source_record_id`, `source_version`, `idempotency_key`
- Scope: `source_upt_id`, `target_upt_id`
- Target: `target_ultg_id`, `target_gardu_induk_id`, `target_bay_id`, `target_gudang_id`, `target_lokasi_id`
- Proses: `qty`, `note`, `status`, `requested_by`, `requested_at`, `decided_by`, `decided_at`, `decision_note`
- Hasil: `target_record_id`, `before_snapshot`, `after_snapshot`

## State Transition

`PENDING -> APPROVED | REJECTED`. Hanya ASMAN source UPT atau SUPERADMIN yang memutus. APPROVED bersifat final dan idempotent.
