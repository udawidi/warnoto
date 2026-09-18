-- QR publik per blok gudang.
-- DDL ini disiapkan untuk apply manual pada Supabase self-host.
-- Token dibawa di URL fragment (#t=...), sehingga tidak masuk request HTTP/referrer.

begin;

alter table public.lokasi
  add column if not exists public_token uuid;

update public.lokasi
set public_token = gen_random_uuid()
where public_token is null;

alter table public.lokasi
  alter column public_token set default gen_random_uuid(),
  alter column public_token set not null;

create unique index if not exists lokasi_public_token_uidx
  on public.lokasi(public_token);

create or replace function public.public_block_stock(
  p_lokasi_id text,
  p_token uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when l.id is null or l.public_token is distinct from p_token then null::jsonb
    else jsonb_build_object(
      'gudang', coalesce(g.data->>'nama', g.data->>'kode', g.id),
      'blok', coalesce(l.data->>'kode', l.data->>'nama', l.id),
      'materials', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'katalog', coalesce(k.data->>'katalog', k.data->>'kode', k.id),
            'nama', coalesce(k.data->>'name', k.data->>'nama', '-'),
            'satuan', coalesce(k.data->>'satuan', k.data->>'unit', ''),
            'qty', q.qty
          )
          order by coalesce(k.data->>'name', k.data->>'nama', k.id)
        )
        from (
          select s.katalog_id,
            sum(case
              when coalesce(s.data->>'qty', '') ~ '^-?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))$'
                then (s.data->>'qty')::numeric
              else 0
            end) as qty
          from public.stocks s
          where s.lokasi_id = l.id
          group by s.katalog_id
        ) q
        join public.katalog k on k.id = q.katalog_id
        where q.qty > 0
      ), '[]'::jsonb)
    )
  end
  from public.lokasi l
  left join public.gudang g on g.id = l.gudang_id
  where l.id = p_lokasi_id;
$$;

revoke all on function public.public_block_stock(text, uuid) from public;
grant execute on function public.public_block_stock(text, uuid) to anon, authenticated;

commit;
