-- ============================================================================
-- Phase 5: favourites are private to their owner, named in 1-40 characters,
-- unique per customer (ignoring case), and capped at 50.
--
-- Run with `npm run test:db`. Rolled back at the end.
-- ============================================================================
begin;

select plan(15);

create function pg_temp.as_user(uid uuid, sql text)
returns text
language plpgsql
as $$
begin
  if uid is null then
    perform set_config('request.jwt.claims', '{"role": "anon"}', true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', uid)::text, true);
    execute 'set local role authenticated';
  end if;
  execute sql;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return 'ok';
exception
  when others then
    return sqlstate;
end;
$$;

-- How many rows `sql` (a select) returns for `uid`.
create function pg_temp.count_as(uid uuid, sql text)
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', uid)::text, true);
  execute 'set local role authenticated';
  execute format('select count(*) from (%s) q', sql) into n;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return n;
end;
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('fa000000-0000-0000-0000-00000000000a', 'fav-a@drincup.test', '{"full_name": "Kai A"}'),
  ('fa000000-0000-0000-0000-00000000000b', 'fav-b@drincup.test', '{"full_name": "Noe B"}');

insert into public.products (id, name, slug, base_price_cents)
values ('f1000000-0000-0000-0000-000000000001', 'Fav Latte', 'fav-latte', 575);

create function pg_temp.insert_sql(owner text, fav_name text)
returns text
language sql
as $$
  select format(
    $f$insert into public.favorites (user_id, name, product_id) values (%L, %L, 'f1000000-0000-0000-0000-000000000001')$f$,
    owner, fav_name
  );
$$;

-- ---------------------------------------------------------------------------
-- Ownership.
-- ---------------------------------------------------------------------------
select is(pg_temp.as_user('fa000000-0000-0000-0000-00000000000a', pg_temp.insert_sql('fa000000-0000-0000-0000-00000000000a', 'My usual')),
  'ok', 'a customer can save a favourite');
select is(pg_temp.as_user('fa000000-0000-0000-0000-00000000000b', pg_temp.insert_sql('fa000000-0000-0000-0000-00000000000a', 'Planted')),
  '42501', 'a customer cannot save a favourite into someone else''s list');
select is(pg_temp.as_user(null, pg_temp.insert_sql('fa000000-0000-0000-0000-00000000000a', 'Guest')),
  '42501', 'a guest cannot save favourites');

select is(pg_temp.count_as('fa000000-0000-0000-0000-00000000000a', 'select 1 from public.favorites'), 1, 'the owner sees their favourite');
select is(pg_temp.count_as('fa000000-0000-0000-0000-00000000000b', 'select 1 from public.favorites'), 0, 'another customer sees none of it');

select pg_temp.as_user('fa000000-0000-0000-0000-00000000000b', $$update public.favorites set name = 'Hijacked'$$);
select pg_temp.as_user('fa000000-0000-0000-0000-00000000000b', $$delete from public.favorites$$);
select is((select name from public.favorites where user_id = 'fa000000-0000-0000-0000-00000000000a'), 'My usual',
  'another customer cannot rename or delete it');

select is(
  pg_temp.as_user('fa000000-0000-0000-0000-00000000000a',
    $$update public.favorites set user_id = 'fa000000-0000-0000-0000-00000000000b' where name = 'My usual'$$),
  '42501', 'a favourite cannot be handed to another customer');

select is(pg_temp.as_user('fa000000-0000-0000-0000-00000000000a', $$update public.favorites set name = 'Morning cup'$$),
  'ok', 'the owner can rename it');
select is(pg_temp.as_user('fa000000-0000-0000-0000-00000000000a', $$delete from public.favorites where name = 'Morning cup'$$),
  'ok', 'the owner can delete it');
select is((select count(*)::int from public.favorites where user_id = 'fa000000-0000-0000-0000-00000000000a'), 0, 'and it is gone');

-- ---------------------------------------------------------------------------
-- Names and the cap.
-- ---------------------------------------------------------------------------
select is(pg_temp.as_user('fa000000-0000-0000-0000-00000000000a', pg_temp.insert_sql('fa000000-0000-0000-0000-00000000000a', repeat('x', 41))),
  '23514', 'a name over 40 characters is refused');
select is(pg_temp.as_user('fa000000-0000-0000-0000-00000000000a', pg_temp.insert_sql('fa000000-0000-0000-0000-00000000000a', '   ')),
  '23514', 'a blank name is refused');

select pg_temp.as_user('fa000000-0000-0000-0000-00000000000a', pg_temp.insert_sql('fa000000-0000-0000-0000-00000000000a', 'My usual'));
select is(pg_temp.as_user('fa000000-0000-0000-0000-00000000000a', pg_temp.insert_sql('fa000000-0000-0000-0000-00000000000a', 'MY USUAL')),
  '23505', 'names are unique per customer, ignoring case');
select is(pg_temp.as_user('fa000000-0000-0000-0000-00000000000b', pg_temp.insert_sql('fa000000-0000-0000-0000-00000000000b', 'My usual')),
  'ok', 'another customer may use the same name');

insert into public.favorites (user_id, name, product_id)
select 'fa000000-0000-0000-0000-00000000000a', 'Favourite ' || n, 'f1000000-0000-0000-0000-000000000001'
  from generate_series(2, 50) n;
select is(pg_temp.as_user('fa000000-0000-0000-0000-00000000000a', pg_temp.insert_sql('fa000000-0000-0000-0000-00000000000a', 'Number 51')),
  'DC003', 'a 51st favourite is refused');

select * from finish();
rollback;
