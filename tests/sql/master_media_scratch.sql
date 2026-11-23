-- Run with psql -f in a fresh disposable PostgreSQL cluster (15+).
\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create table public.stocks (id text primary key, upt_id text, data jsonb not null);
create table public.gudang (id text primary key, data jsonb not null);
create table public.sub_gudang (id text primary key, data jsonb not null);
grant select, insert, update on public.stocks, public.gudang, public.sub_gudang to authenticated;
alter table public.stocks enable row level security;
create policy master_media_visible on public.stocks to authenticated using (upt_id=current_setting('test.upt'));
\ir ../../supabase/proposals/20261123_master_media.sql
\ir ../../supabase/proposals/20261123_master_media.sql
begin;
insert into public.stocks(id,upt_id,data) values
  ('TEST-MEDIA-A','A','{"img":"data:image/png;base64,OLD","qty":1}'),
  ('TEST-MEDIA-B','B','{"img":"data:image/png;base64,HIDDEN","qty":1}');
insert into public.gudang(id,data) values ('TEST-MEDIA-G','{"denahImageData":"data:image/png;base64,MAP","fotoGudang":"https://example.invalid/photo"}');
insert into public.sub_gudang(id,data) values ('TEST-MEDIA-SG','{"denahImageData":"data:image/png;base64,MAP"}');
set local test.upt = 'A';
set local role authenticated;
do $$
declare
  snapshot jsonb;
begin
  if (select count(*) from public.stocks_compact where id like 'TEST-MEDIA-%') <> 1 then raise exception 'RLS scope failed'; end if;
  select data into strict snapshot from public.stocks_compact where id='TEST-MEDIA-A';
  if snapshot->>'img' not like 'wmedia:stocks:img:%:TEST-MEDIA-A' then raise exception 'inline stock photo in list'; end if;
  update public.stocks set data=jsonb_set(data,'{img}','"data:image/png;base64,NEW"') where id='TEST-MEDIA-A';
  insert into public.stocks(id,upt_id,data) values ('TEST-MEDIA-A','A',jsonb_set(snapshot,'{qty}','2'))
    on conflict(id) do update set data=excluded.data;
  if not exists (select from public.stocks where id='TEST-MEDIA-A' and data='{"img":"data:image/png;base64,NEW","qty":2}') then raise exception 'newer photo lost'; end if;
  begin
    insert into public.stocks(id,upt_id,data) values ('TEST-MEDIA-NEW','A',jsonb_build_object('img','wmedia:stocks:img:'||md5('x')||':TEST-MEDIA-NEW'));
    raise exception using errcode='XX000',message='dangling handle accepted';
  exception when raise_exception then null; end;
  update public.stocks set data=data-'img' where id='TEST-MEDIA-A';
  update public.stocks set data=snapshot where id='TEST-MEDIA-A';
  if (select data ? 'img' from public.stocks where id='TEST-MEDIA-A') then raise exception 'deleted photo resurrected'; end if;
  select data into strict snapshot from public.gudang_compact where id='TEST-MEDIA-G';
  if snapshot->>'fotoGudang'<>'https://example.invalid/photo' then raise exception 'remote URL changed'; end if;
  insert into public.gudang(id,data) values ('TEST-MEDIA-COPY',snapshot);
  if (select data->>'denahImageData' from public.gudang where id='TEST-MEDIA-COPY')<>'data:image/png;base64,MAP' then raise exception 'warehouse merge lost map'; end if;
  if (select data->>'denahImageData' from public.sub_gudang_compact where id='TEST-MEDIA-SG') not like 'wmedia:%' then raise exception 'inline map in list'; end if;
end $$;
reset role;
alter table public.gudang disable trigger aa_master_media_restore;
do $$ begin
  begin
    update public.gudang set data=(select data from public.gudang_compact where id='TEST-MEDIA-G') where id='TEST-MEDIA-G';
    raise exception using errcode='XX000',message='missing trigger allowed media loss';
  exception when check_violation then null; end;
end $$;
rollback;
