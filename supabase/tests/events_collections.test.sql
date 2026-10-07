-- ============================================================================
-- Phase 8: pop-up events, seasonal collections, limited-time products and
-- image storage.
--
--   * unpublished events are invisible to guests and customers; publishing
--     needs a menu, and a published event cannot lose its whole menu
--   * one event row covers at most 24 hours; end after start
--   * only admins save, publish and duplicate events and save collections,
--     and who did it is stamped on the row
--   * duplicating keeps the Honolulu wall-clock times on the new date
--   * collection accents are hex only; ticked products sell only during the
--     collection
--   * storage: admins upload, customers cannot; guests may list only images
--     that published content uses; only JPEG / PNG / WebP up to 5 MB
--
-- Run with `npm run test:db`. Rolled back at the end.
-- ============================================================================
begin;

select plan(39);

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
    reset role;
    perform set_config('request.jwt.claims', '', true);
    return sqlstate;
end;
$$;

create function pg_temp.value_as(uid uuid, sql text)
returns text
language plpgsql
as $$
declare
  result text;
begin
  if uid is null then
    perform set_config('request.jwt.claims', '{"role": "anon"}', true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', uid)::text, true);
    execute 'set local role authenticated';
  end if;
  execute sql into result;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return result;
end;
$$;

-- Runs `sql` and then checks the deferred constraints at once, in a
-- subtransaction: 'ok' or the SQLSTATE (what COMMIT would have raised).
create function pg_temp.at_commit(sql text)
returns text
language plpgsql
as $$
begin
  execute sql;
  set constraints all immediate;
  set constraints all deferred;
  return 'ok';
exception
  when others then
    return sqlstate;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: e8...01 admin, e8...02 customer, e8...03 staff, e8...04 staff
-- (not rostered); two products; one event.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('e8000000-0000-0000-0000-000000000001', 'p8e-admin@drincup.test', '{"full_name": "Ada Admin"}'),
  ('e8000000-0000-0000-0000-000000000002', 'p8e-cust@drincup.test',  '{"full_name": "Cal Customer"}'),
  ('e8000000-0000-0000-0000-000000000003', 'p8e-staff@drincup.test', '{"full_name": "Sid Staff"}');
update public.profiles set role = 'admin' where id = 'e8000000-0000-0000-0000-000000000001';
update public.profiles set role = 'staff' where id = 'e8000000-0000-0000-0000-000000000003';

insert into public.products (id, name, slug) values
  ('e8300000-0000-0000-0000-000000000001', 'P8E Cold Brew', 'p8e-cold-brew'),
  ('e8300000-0000-0000-0000-000000000002', 'P8E Pumpkin Haupia Latte', 'p8e-pumpkin-haupia');

-- An admin saves an event (with its menu and staff) through the function.
create temp table ev (id uuid);
grant select, insert on ev to authenticated, anon;

select is(
  pg_temp.as_user('e8000000-0000-0000-0000-000000000002', $$select public.admin_save_event(
    '{"name": "Mine", "slug": "mine", "starts_at": "2030-01-05 10:00:00-10", "ends_at": "2030-01-05 12:00:00-10"}'::jsonb, '{}'::uuid[], '{}'::uuid[])$$),
  '42501', 'a customer cannot save an event');

do $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', 'e8000000-0000-0000-0000-000000000001')::text, true);
  set local role authenticated;
  insert into ev select public.admin_save_event(
    jsonb_build_object('name', 'P8E Night Market', 'slug', 'p8e-night-market-2030-01-05', 'address_line1', '1 Market St',
      'starts_at', '2030-01-05 17:00:00-10', 'ends_at', '2030-01-06 01:00:00-10', 'prep_time_minutes', 12),
    array['e8300000-0000-0000-0000-000000000001']::uuid[],
    array['e8000000-0000-0000-0000-000000000003']::uuid[]);
  reset role;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

select is(
  (select type::text || '/' || is_published::text || '/' || (created_by = 'e8000000-0000-0000-0000-000000000001')::text
     from public.locations where id = (select id from ev)),
  'event/false/true', 'an admin''s new event is unpublished and records who created it');
select is((select count(*)::int from public.event_menu_items where location_id = (select id from ev)), 1, 'its menu is saved');
select is(
  (select (created_by = 'e8000000-0000-0000-0000-000000000001')::text from public.staff_locations where location_id = (select id from ev)),
  'true', 'its staff roster is saved, with who assigned them');
select is(
  pg_temp.as_user('e8000000-0000-0000-0000-000000000001', $$select public.admin_save_event(
    '{"name": "X", "slug": "p8e-x", "starts_at": "2030-01-05 10:00:00-10", "ends_at": "2030-01-05 12:00:00-10"}'::jsonb,
    '{}'::uuid[], array['e8000000-0000-0000-0000-000000000002']::uuid[])$$),
  '22023', 'only staff accounts can be rostered at an event');

-- Visibility.
select is(pg_temp.value_as(null, $$select count(*) from public.locations where id = (select id from ev)$$), '0', 'guests cannot see an unpublished event');
select is(pg_temp.value_as('e8000000-0000-0000-0000-000000000002', $$select count(*) from public.locations where id = (select id from ev)$$), '0', 'customers cannot either');
select is(pg_temp.value_as(null, $$select count(*) from public.event_menu_items where location_id = (select id from ev)$$), '0', '... nor its menu');
select is(pg_temp.value_as('e8000000-0000-0000-0000-000000000003', $$select count(*) from public.locations where id = (select id from ev)$$), '1', 'staff can see it');

-- Window rules.
select throws_ok(
  $$update public.locations set ends_at = starts_at where id = (select id from ev)$$,
  '23514', null, 'an event must end after it starts');
select throws_ok(
  $$update public.locations set ends_at = starts_at + interval '25 hours' where id = (select id from ev)$$,
  '23514', null, 'one event row covers at most 24 hours (a multi-day market is one row per day)');

-- Publishing.
create temp table empty_ev (id uuid);
grant select, insert on empty_ev to authenticated, anon;
do $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', 'e8000000-0000-0000-0000-000000000001')::text, true);
  set local role authenticated;
  insert into empty_ev select public.admin_save_event(
    '{"name": "P8E Empty", "slug": "p8e-empty", "starts_at": "2030-02-01 10:00:00-10", "ends_at": "2030-02-01 14:00:00-10"}'::jsonb,
    '{}'::uuid[], '{}'::uuid[]);
  reset role;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

select is(
  pg_temp.as_user('e8000000-0000-0000-0000-000000000001', $$select public.admin_set_event_published((select id from empty_ev), true)$$),
  'DC020', 'an event with no menu cannot be published');
select is(
  pg_temp.at_commit($$update public.locations set is_published = true where id = (select id from empty_ev)$$),
  'DC020', '... not even by writing the column directly (checked at commit)');
select is(
  pg_temp.as_user('e8000000-0000-0000-0000-000000000003', $$select public.admin_set_event_published((select id from ev), true)$$),
  '42501', 'staff cannot publish events');
select is(
  pg_temp.as_user('e8000000-0000-0000-0000-000000000001', $$select public.admin_set_event_published((select id from ev), true)$$),
  'ok', 'an admin publishes an event with a menu');
select is(pg_temp.value_as(null, $$select count(*) from public.locations where id = (select id from ev)$$), '1', 'guests see a published event');
select is(pg_temp.value_as(null, $$select count(*) from public.event_menu_items where location_id = (select id from ev)$$), '1', '... and its menu');
select is(
  pg_temp.at_commit($$delete from public.event_menu_items where location_id = (select id from ev)$$),
  'DC020', 'a published event cannot be left with no menu');
select is(
  (select (updated_by = 'e8000000-0000-0000-0000-000000000001')::text from public.locations where id = (select id from ev)),
  'true', 'publishing records who changed the event');

-- Duplicating.
create temp table dup (id uuid);
grant select, insert on dup to authenticated;
select is(
  pg_temp.as_user('e8000000-0000-0000-0000-000000000001', $$insert into dup select public.admin_duplicate_event((select id from ev), '2030-01-12')$$),
  'ok', 'an admin duplicates the event to another date');
select is(
  (select to_char(starts_at at time zone 'Pacific/Honolulu', 'YYYY-MM-DD HH24:MI') || ' -> ' || to_char(ends_at at time zone 'Pacific/Honolulu', 'YYYY-MM-DD HH24:MI')
     from public.locations where id = (select id from dup)),
  '2030-01-12 17:00 -> 2030-01-13 01:00', 'the copy keeps the Honolulu wall-clock times and length, across midnight');
select is(
  (select slug || '/' || is_published::text || '/' || prep_time_minutes from public.locations where id = (select id from dup)),
  'p8e-night-market-2030-01-12/false/12', 'the copy gets a slug for its date and starts unpublished');
select is(
  (select (select count(*) from public.event_menu_items where location_id = (select id from dup))::text || '/'
       || (select count(*) from public.staff_locations where location_id = (select id from dup))::text),
  '1/1', 'the copy has the same menu and staff');
select is(
  pg_temp.as_user('e8000000-0000-0000-0000-000000000002', $$select public.admin_duplicate_event((select id from ev), '2030-01-19')$$),
  '42501', 'customers cannot duplicate events');

-- ---------------------------------------------------------------------------
-- Collections and limited-time products.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.as_user('e8000000-0000-0000-0000-000000000002', $$select public.admin_save_collection(
    '{"name": "Mine", "slug": "mine", "starts_at": "2030-10-01 00:00:00-10", "ends_at": "2030-11-01 00:00:00-10"}'::jsonb, '[]'::jsonb)$$),
  '42501', 'a customer cannot save a collection');
select is(
  pg_temp.as_user('e8000000-0000-0000-0000-000000000001', $$select public.admin_save_collection(
    '{"name": "Bad", "slug": "p8e-bad", "accent_color": "red; background: url(x)", "starts_at": "2030-10-01 00:00:00-10", "ends_at": "2030-11-01 00:00:00-10"}'::jsonb, '[]'::jsonb)$$),
  '23514', 'an accent colour must be #RRGGBB (nothing else reaches an inline style)');

create temp table col (id uuid);
grant select, insert on col to authenticated;
select is(
  pg_temp.as_user('e8000000-0000-0000-0000-000000000001', $$insert into col select public.admin_save_collection(
    '{"name": "P8E Fall Harvest", "slug": "p8e-fall-harvest", "accent_color": "#B81C74", "starts_at": "2030-10-01 00:00:00-10", "ends_at": "2030-11-01 00:00:00-10"}'::jsonb,
    '[{"product_id": "e8300000-0000-0000-0000-000000000002", "limited": true}, {"product_id": "e8300000-0000-0000-0000-000000000001", "limited": false}]'::jsonb)$$),
  'ok', 'an admin saves a collection with its products');
select is(
  (select string_agg(p.slug, ',' order by cp.sort_order) from public.collection_products cp join public.products p on p.id = cp.product_id
    where cp.collection_id = (select id from col)),
  'p8e-pumpkin-haupia,p8e-cold-brew', 'products keep the chosen order');
select is(
  (select to_char(available_from at time zone 'Pacific/Honolulu', 'YYYY-MM-DD') || ' -> ' || to_char(available_until at time zone 'Pacific/Honolulu', 'YYYY-MM-DD')
     || '/' || (updated_by = 'e8000000-0000-0000-0000-000000000001')::text
     from public.products where id = 'e8300000-0000-0000-0000-000000000002'),
  '2030-10-01 -> 2030-11-01/true', 'a ticked product sells only during the collection, and the admin is recorded');
select is(
  (select available_from is null from public.products where id = 'e8300000-0000-0000-0000-000000000001'),
  true, 'an unticked product keeps no window');
select is(
  pg_temp.as_user('e8000000-0000-0000-0000-000000000001', $$select public.admin_save_collection(
    jsonb_build_object('id', (select id from col), 'name', 'P8E Fall Harvest', 'slug', 'p8e-fall-harvest', 'starts_at', '2030-10-01 00:00:00-10', 'ends_at', '2030-11-01 00:00:00-10'),
    '[{"product_id": "e8300000-0000-0000-0000-000000000002", "limited": false}]'::jsonb)$$),
  'ok', 'unticking it ...');
select is(
  (select available_from is null and available_until is null from public.products where id = 'e8300000-0000-0000-0000-000000000002'),
  true, '... clears the window it was given');
select throws_ok(
  $$update public.products set available_from = '2030-01-02', available_until = '2030-01-01' where id = 'e8300000-0000-0000-0000-000000000001'$$,
  '23514', null, 'a product''s window must end after it starts');

-- ---------------------------------------------------------------------------
-- Storage.
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(id || ':' || file_size_limit || ':' || array_to_string(allowed_mime_types, '|'), ',' order by id)
     from storage.buckets where id in ('collection-banners', 'location-images', 'product-images')),
  'collection-banners:5242880:image/jpeg|image/png|image/webp,location-images:5242880:image/jpeg|image/png|image/webp,product-images:5242880:image/jpeg|image/png|image/webp',
  'image buckets take JPEG, PNG and WebP up to 5 MB');
select is(
  pg_temp.as_user('e8000000-0000-0000-0000-000000000002', $$insert into storage.objects (bucket_id, name) values ('location-images', 'p8e/customer.webp')$$),
  '42501', 'a customer cannot upload images');
select is(
  pg_temp.as_user('e8000000-0000-0000-0000-000000000001', $$insert into storage.objects (bucket_id, name) values ('location-images', 'p8e/draft.webp')$$),
  'ok', 'an admin can');
update public.locations set image_url = 'p8e/draft.webp' where id = (select id from empty_ev);
select is(
  pg_temp.value_as(null, $$select count(*) from storage.objects where name = 'p8e/draft.webp'$$),
  '0', 'guests cannot list an image used only by an unpublished event');
insert into storage.objects (bucket_id, name) values ('location-images', 'p8e/live.webp');
update public.locations set image_url = 'p8e/live.webp' where id = (select id from ev);
select is(
  pg_temp.value_as(null, $$select count(*) from storage.objects where name = 'p8e/live.webp'$$),
  '1', 'guests can see the image of a published event');
select is(
  pg_temp.value_as('e8000000-0000-0000-0000-000000000001', $$select count(*) from storage.objects where name like 'p8e/%'$$),
  '2', 'admins see every image');

select * from finish();
rollback;
