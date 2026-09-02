-- Fitur B (fondasi) — notifikasi pengeluaran material (TUG-8/9 FINAL_APPROVED) ke
-- akuntansi via WA + Telegram. Outbox + dispatcher, di belakang SATU titik kirim.
-- Provider WA masih blocker user (lihat notify-dispatch/index.ts) — file ini HANYA
-- bikin tabel + trigger insert, TANPA network call, jadi aman apply lebih dulu.
-- Telegram existing (telegram-webhook/) TIDAK disentuh sama sekali di sini.
create table if not exists notif_outbox (
  id text primary key,
  tug_txn_id text not null,
  doc_type text not null,
  channel text not null check (channel in ('WA','TELEGRAM')),
  recipient text not null,
  payload jsonb not null default '{}',
  status text not null default 'PENDING' check (status in ('PENDING','SENT','FAILED')),
  attempts int not null default 0,
  last_error text,
  created_at bigint not null default (extract(epoch from now())*1000)::bigint,
  sent_at bigint
);

create table if not exists notif_recipients (
  id text primary key,
  channel text not null check (channel in ('WA','TELEGRAM')),
  target text not null,      -- nomor WA (628xx) atau chat_id Telegram
  label text,
  upt_id text,                -- null = global/semua UPT
  active boolean not null default true,
  created_at bigint not null default (extract(epoch from now())*1000)::bigint
);

alter table notif_outbox enable row level security;
alter table notif_recipients enable row level security;

drop policy if exists "read notif_outbox" on notif_outbox;
drop policy if exists "write notif_outbox" on notif_outbox;
create policy "read notif_outbox" on notif_outbox for select using (auth.uid() is not null);
create policy "write notif_outbox" on notif_outbox for all using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "read notif_recipients" on notif_recipients;
drop policy if exists "write notif_recipients" on notif_recipients;
create policy "read notif_recipients" on notif_recipients for select using (auth.uid() is not null);
create policy "write notif_recipients" on notif_recipients for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- Grant wajib: tanpa ini Edge Function (service_role) baca tabel baru = kosong senyap
-- (pola sama tug3_transactions.sql:30-31).
grant select, insert, update, delete on notif_outbox to authenticated;
grant select, insert, update, delete on notif_outbox to service_role;
grant select, insert, update, delete on notif_recipients to authenticated;
grant select, insert, update, delete on notif_recipients to service_role;

create index if not exists idx_notif_outbox_status on notif_outbox (status);
create index if not exists idx_notif_recipients_active on notif_recipients (active);

-- Trigger: TUG-8/9 baru saja FINAL_APPROVED (status tepat ini, diverifikasi dari
-- tug_decide() di 20260729_tug_canonical_approval.sql:505) -> antre notif PENDING
-- per penerima aktif. HANYA insert baris — TIDAK ADA network call di trigger,
-- pengiriman beneran dikerjakan notify-dispatch (dipanggil cron/manual belakangan).
create or replace function public.notif_outbox_on_tug_final()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Idempoten: cuma jalan saat status BERUBAH ke FINAL_APPROVED, bukan tiap update baris.
  if new.status is distinct from old.status and new.status = 'FINAL_APPROVED' and new.doc_type in ('TUG8','TUG9') then
    insert into notif_outbox (id, tug_txn_id, doc_type, channel, recipient, payload, status)
    select
      gen_random_uuid()::text,
      new.id::text,
      new.doc_type,
      r.channel,
      r.target,
      jsonb_build_object('docNumber', new.doc_number, 'docType', new.doc_type, 'uptId', new.upt_id, 'txnId', new.id),
      'PENDING'
    from notif_recipients r
    where r.active and (r.upt_id is null or r.upt_id = new.upt_id);
  end if;
  return new;
end $$;

drop trigger if exists trg_notif_outbox_on_tug_final on tug_transactions;
create trigger trg_notif_outbox_on_tug_final
  after update on tug_transactions
  for each row execute function public.notif_outbox_on_tug_final();
