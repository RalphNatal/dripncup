-- ============================================================================
-- Phase 9: the admin dashboard's database side.
--
--   * every admin_* function is security definer, closed to guests, and
--     refuses customers and staff (42501) -- found by name, so a new one is
--     covered automatically
--   * admin-only data (audit log, setup tasks, promos) stays unreadable to
--     customers and staff; nobody writes admin tables directly, admins
--     included
--   * the audit log records the actor and the before/after of what changed,
--     and only for admins
--   * roles: never your own; demoting staff clears their rosters
--   * archive vs delete: used menu items can only be archived; archived items
--     vanish from customers while past orders stay intact
--   * the import is all or nothing, matches by slug, and logs once
--   * a redeemed promo's code and discount are locked
--   * settings are type- and range-checked
--   * the attention queue: resolving an item removes it
--   * reports: the orders export adds up to the sales report, refunds split
--     exactly, Honolulu dates
--
-- Run with `npm run test:db`. Rolled back at the end.
-- ============================================================================
begin;

select plan(67);

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

-- Calls made directly below (not through as_user) act as admin A.
create function pg_temp.admin_a()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"authenticated","sub":"c9000000-0000-0000-0000-000000000001"}', true);
end;
$$;

-- Every public admin_* function, called with nulls as `uid`: the names of the
-- ones that did not refuse with 42501.
create function pg_temp.admin_functions_not_refusing(uid uuid)
returns text
language plpgsql
as $$
declare
  f record;
  args text;
  state text;
  leaks text[] := '{}';
begin
  for f in
    select p.proname, p.proargtypes
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'admin\_%'
     order by p.proname
  loop
    select string_agg('null::' || format_type(t, null), ', ' order by i)
      into args
      from unnest(f.proargtypes::oid[]) with ordinality as a(t, i);
    state := pg_temp.as_user(uid, format('select public.%I(%s)', f.proname, coalesce(args, '')));
    if state <> '42501' then
      leaks := leaks || (f.proname || '=' || state);
    end if;
  end loop;
  return array_to_string(leaks, ', ');
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures.
--   c9...01 admin A   c9...02 admin B   c9...03 staff   c9...04 customer
--   c91..01 test cafe
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('c9000000-0000-0000-0000-000000000001', 'p9-admin-a@drincup.test', '{"full_name": "Ada Admin"}'),
  ('c9000000-0000-0000-0000-000000000002', 'p9-admin-b@drincup.test', '{"full_name": "Bo Admin"}'),
  ('c9000000-0000-0000-0000-000000000003', 'p9-staff@drincup.test', '{"full_name": "Sam Staff"}'),
  ('c9000000-0000-0000-0000-000000000004', 'p9-customer@drincup.test', '{"full_name": "Cal Customer"}');
update public.profiles set role = 'admin' where id in ('c9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002');
update public.profiles set role = 'staff' where id = 'c9000000-0000-0000-0000-000000000003';

insert into public.locations (id, type, name, slug, sort_order) values
  ('c9100000-0000-0000-0000-000000000001', 'cafe', 'P9 Test Cafe', 'p9-test-cafe', -300);
insert into public.staff_locations (profile_id, location_id) values
  ('c9000000-0000-0000-0000-000000000003', 'c9100000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- Access.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'admin\_%' and not p.prosecdef),
  0, 'every admin_* function is security definer');

select is(
  (select coalesce(string_agg(p.proname, ', '), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'admin\_%' and has_function_privilege('anon', p.oid, 'execute')),
  '', 'guests cannot execute any admin_* function');

select is(pg_temp.admin_functions_not_refusing('c9000000-0000-0000-0000-000000000004'), '',
  'a customer is refused (42501) by every admin_* function');

select is(pg_temp.admin_functions_not_refusing('c9000000-0000-0000-0000-000000000003'), '',
  'a barista is refused (42501) by every admin_* function');

select is(
  (select coalesce(string_agg(p.proname, ', '), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('report_order_facts', 'product_usage', 'write_product', 'write_product_sizes', 'write_product_groups',
                        'audit_admin_change', 'audit_log_entry', 'order_payment_state', 'modifier_option_used')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  '', 'the internal helpers behind the admin functions are not callable from the API');

-- An admin action, so there is something in the log to (not) read.
select is(pg_temp.as_user('c9000000-0000-0000-0000-000000000001',
  $$select public.admin_update_setting('orders.queue_minutes_per_order', '3'::jsonb)$$), 'ok',
  'an admin changes a setting through its function');

select is(pg_temp.value_as('c9000000-0000-0000-0000-000000000004', 'select count(*)::text from public.admin_audit_log'), '0',
  'customers read nothing from the audit log');
select is(pg_temp.value_as('c9000000-0000-0000-0000-000000000003', 'select count(*)::text from public.admin_audit_log'), '0',
  'staff read nothing from the audit log');
select is(pg_temp.value_as('c9000000-0000-0000-0000-000000000004', 'select count(*)::text from public.setup_tasks'), '0',
  'customers cannot read the setup checklist');
select is(pg_temp.value_as('c9000000-0000-0000-0000-000000000003', 'select count(*)::text from public.promos'), '0',
  'staff cannot read promo codes');
select ok(pg_temp.value_as(null, 'select count(*)::text from public.site_content')::int >= 9,
  'guests read site content (About, contact, policies)');

select is(pg_temp.as_user('c9000000-0000-0000-0000-000000000004',
  $$insert into public.products (name, slug) values ('Sneaky', 'sneaky')$$), '42501',
  'a customer cannot write the menu');
select is(pg_temp.as_user('c9000000-0000-0000-0000-000000000001',
  $$update public.products set base_price_cents = 1 where slug = 'latte'$$), '42501',
  'not even an admin writes menu tables directly (functions only)');
select is(pg_temp.as_user('c9000000-0000-0000-0000-000000000001',
  $$update public.settings set value = '0'::jsonb where key = 'tax.get_rate'$$), '42501',
  'an admin cannot write settings directly');
select is(pg_temp.as_user('c9000000-0000-0000-0000-000000000004',
  $$update public.profiles set role = 'admin' where id = 'c9000000-0000-0000-0000-000000000004'$$), '42501',
  'a customer cannot change their own role');
select is(pg_temp.as_user('c9000000-0000-0000-0000-000000000004',
  $$update public.profiles set phone = '(808) 555-0199' where id = 'c9000000-0000-0000-0000-000000000004'$$), 'ok',
  'a customer still edits their own profile');

-- ---------------------------------------------------------------------------
-- The audit log.
-- ---------------------------------------------------------------------------
select results_eq(
  $$select actor_id, actor_name, row_id, changes -> 'value' ->> 'from', changes -> 'value' ->> 'to', action
      from public.admin_audit_log where table_name = 'settings' and row_id = 'orders.queue_minutes_per_order'
       and actor_id = 'c9000000-0000-0000-0000-000000000001'$$,
  $$values ('c9000000-0000-0000-0000-000000000001'::uuid, 'Ada Admin', 'orders.queue_minutes_per_order', '2', '3', 'update')$$,
  'the audit log names the admin and the before and after of the changed column');

select is(
  (select count(*)::int from public.admin_audit_log a, jsonb_object_keys(a.changes) k
    where a.table_name = 'settings' and a.row_id = 'orders.queue_minutes_per_order' and k in ('updated_at', 'updated_by')),
  0, 'bookkeeping columns are not recorded as changes');

update public.settings set value = '4'::jsonb where key = 'orders.queue_minutes_per_order';
select is(
  (select count(*)::int from public.admin_audit_log where table_name = 'settings' and row_id = 'orders.queue_minutes_per_order'
     and created_at = now()),
  1, 'a change the system makes (no admin) is not in the admin log');

select is(pg_temp.as_user('c9000000-0000-0000-0000-000000000001',
  $$select public.admin_update_setting('orders.queue_minutes_per_order', '45'::jsonb)$$), '22023',
  'settings are range-checked');
select is(pg_temp.as_user('c9000000-0000-0000-0000-000000000001',
  $$select public.admin_update_setting('tax.tips_taxed', '"yes"'::jsonb)$$), '22023',
  'settings are type-checked');
select is(pg_temp.as_user('c9000000-0000-0000-0000-000000000001',
  $$select public.admin_update_setting('catering.delivery_zip_codes', '["96814", "9681"]'::jsonb)$$), '22023',
  'ZIP code lists are checked item by item');

-- ---------------------------------------------------------------------------
-- Menu: validation, archive vs delete.
-- ---------------------------------------------------------------------------
create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;

select pg_temp.admin_a();
insert into ids
select 'group', public.admin_save_modifier_group(
  '{"name": "P9 Temp", "slug": "p9-temp", "selection_type": "single", "is_required": true, "min_selections": 1}'::jsonb,
  '[{"name": "Hot", "is_default": true}, {"name": "Iced"}]'::jsonb);
insert into ids
select 'ice', public.admin_save_modifier_group(
  '{"name": "P9 Ice", "slug": "p9-ice", "selection_type": "single"}'::jsonb,
  '[{"name": "Light"}, {"name": "Regular"}]'::jsonb);
insert into ids select 'iced', id from public.modifier_options where name = 'Iced' and modifier_group_id = (select id from ids where name = 'group');
insert into ids select 'light', id from public.modifier_options where name = 'Light' and modifier_group_id = (select id from ids where name = 'ice');

select is(
  pg_temp.as_user('c9000000-0000-0000-0000-000000000001', $$
    select public.admin_save_modifier_group('{"name": "P9 Bad", "slug": "p9-bad", "selection_type": "single", "is_required": true, "min_selections": 1}'::jsonb,
      '[{"name": "A"}, {"name": "B"}]'::jsonb)$$),
  'DC032', 'a required single-choice group must have a default');
select is(
  pg_temp.as_user('c9000000-0000-0000-0000-000000000001', $$
    select public.admin_save_modifier_group('{"name": "P9 Bad", "slug": "p9-bad", "selection_type": "multi", "min_selections": 0, "max_selections": 1, "is_required": true}'::jsonb,
      '[{"name": "A"}, {"name": "B"}]'::jsonb)$$),
  '22023', 'min and max are checked (required needs at least one choice)');

select pg_temp.admin_a();
insert into ids
select 'product', public.admin_save_product(
  '{"name": "P9 Iced Tea", "slug": "p9-iced-tea", "base_price_cents": 0, "is_active": true}'::jsonb,
  '[{"name": "Small", "price_cents": 400, "is_default": true}, {"name": "Large", "price_cents": 500}]'::jsonb,
  jsonb_build_array(
    jsonb_build_object('group_id', (select id from ids where name = 'group')),
    jsonb_build_object('group_id', (select id from ids where name = 'ice'), 'visible_when_option_id', (select id from ids where name = 'iced'))));

select is(
  (select visible_when_option_id from public.product_modifier_groups
    where product_id = (select id from ids where name = 'product') and modifier_group_id = (select id from ids where name = 'ice')),
  (select id from ids where name = 'iced'),
  'a product saves with sizes and a conditional group ("Only show when Iced")');

select is(
  pg_temp.as_user('c9000000-0000-0000-0000-000000000001', format($$
    select public.admin_save_product('{"id": "%s", "name": "P9 Iced Tea", "slug": "p9-iced-tea"}'::jsonb,
      '[{"name": "Small", "price_cents": 400, "is_default": true}]'::jsonb,
      '[{"group_id": "%s", "visible_when_option_id": "%s"}]'::jsonb)$$,
    (select id from ids where name = 'product'), (select id from ids where name = 'ice'), (select id from ids where name = 'light'))),
  'DC031', '"Only show when" must name an option from another group on the product');

select is(
  pg_temp.as_user('c9000000-0000-0000-0000-000000000001', format($$
    select public.admin_save_product('{"id": "%s", "name": "P9 Iced Tea", "slug": "p9-iced-tea"}'::jsonb,
      '[{"name": "Small", "price_cents": 400}, {"name": "Large", "price_cents": 500}]'::jsonb, '[]'::jsonb)$$,
    (select id from ids where name = 'product'))),
  '22023', 'sizes need exactly one default');

select is(
  pg_temp.as_user('c9000000-0000-0000-0000-000000000001', format($$
    select public.admin_save_modifier_group('{"id": "%s", "name": "P9 Temp", "slug": "p9-temp", "selection_type": "single", "is_required": true, "min_selections": 1}'::jsonb,
      '[{"name": "Hot", "is_default": true}]'::jsonb)$$,
    (select id from ids where name = 'group'))),
  'DC034', 'an option that controls an "Only show when" rule cannot be removed');

select is(
  pg_temp.as_user('c9000000-0000-0000-0000-000000000001', format('select public.admin_delete_modifier_group(%L)', (select id from ids where name = 'ice'))),
  'DC035', 'a group still on products cannot be deleted');

-- A never-used product can be deleted.
select pg_temp.admin_a();
insert into ids
select 'unused', public.admin_save_product('{"name": "P9 Unused", "slug": "p9-unused", "base_price_cents": 300}'::jsonb, '[]'::jsonb, '[]'::jsonb);
select is(
  pg_temp.as_user('c9000000-0000-0000-0000-000000000001', format('select public.admin_delete_product(%L)', (select id from ids where name = 'unused'))),
  'ok', 'a product nothing has used can be deleted');

-- A past order uses the tea (Large).
insert into public.orders (id, user_id, location_id, status, placed_at, picked_up_at, subtotal_cents, taxable_base_cents,
                           total_cents, idempotency_key, order_number)
values ('c9200000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000004', 'c9100000-0000-0000-0000-000000000001',
        'picked_up', now() - interval '1 day', now() - interval '1 day', 500, 500, 500, 'p9-order-1', 'P9-TEST-0001');
insert into public.order_items (order_id, product_id, product_size_id, product_name, size_name, modifiers, base_price_cents, unit_price_cents, quantity, line_total_cents)
select 'c9200000-0000-0000-0000-000000000001', (select id from ids where name = 'product'),
       (select id from public.product_sizes where product_id = (select id from ids where name = 'product') and name = 'Large'),
       'P9 Iced Tea', 'Large',
       jsonb_build_array(jsonb_build_object('group_id', (select id from ids where name = 'ice'), 'option_id', (select id from ids where name = 'light'),
                                            'group_name', 'P9 Ice', 'option_name', 'Light', 'quantity', 1, 'price_delta_cents', 0)),
       500, 500, 1, 500;

select is(
  pg_temp.as_user('c9000000-0000-0000-0000-000000000001', format('select public.admin_delete_product(%L)', (select id from ids where name = 'product'))),
  'DC030', 'a product used by a past order cannot be deleted');

-- Dropping the Large size and the Light option: used, so archived, not deleted.
select pg_temp.admin_a();
select lives_ok(format($$
  select public.admin_save_product('{"id": "%s", "name": "P9 Iced Tea", "slug": "p9-iced-tea", "is_active": true}'::jsonb,
    '[{"name": "Small", "price_cents": 450, "is_default": true}]'::jsonb,
    '[{"group_id": "%s"}, {"group_id": "%s", "visible_when_option_id": "%s"}]'::jsonb)$$,
  (select id from ids where name = 'product'), (select id from ids where name = 'group'), (select id from ids where name = 'ice'),
  (select id from ids where name = 'iced')), 'the editor saves a price change and a removed size');
select ok(
  (select archived_at is not null and not is_active from public.product_sizes
    where product_id = (select id from ids where name = 'product') and name = 'Large'),
  'a removed size that an order used is archived, not deleted');
select lives_ok(format($$
  select public.admin_save_modifier_group('{"id": "%s", "name": "P9 Ice", "slug": "p9-ice", "selection_type": "single"}'::jsonb,
    '[{"name": "Regular"}]'::jsonb)$$, (select id from ids where name = 'ice')), 'an option can be removed from a group');
select ok((select archived_at is not null from public.modifier_options where id = (select id from ids where name = 'light')),
  'a removed option that an order used is archived, not deleted');

select lives_ok(format('select public.admin_archive_product(%L)', (select id from ids where name = 'product')), 'the used product is archived');
select is(pg_temp.value_as(null, format('select count(*)::text from public.products where id = %L', (select id from ids where name = 'product'))),
  '0', 'an archived product is hidden from customers');
select results_eq(
  $$select product_name, size_name, unit_price_cents, product_id is not null, product_size_id is not null
      from public.order_items where order_id = 'c9200000-0000-0000-0000-000000000001'$$,
  $$values ('P9 Iced Tea', 'Large', 500, true, true)$$,
  'the past order keeps its snapshot and its links');
select is(
  pg_temp.as_user('c9000000-0000-0000-0000-000000000001', format('select public.admin_set_product_active(%L, true)', (select id from ids where name = 'product'))),
  'DC033', 'an archived product must be restored before it is switched on');

-- ---------------------------------------------------------------------------
-- Import: all or nothing, by slug, logged once.
-- ---------------------------------------------------------------------------
create function pg_temp.plan(group_slug text)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'categories', jsonb_build_array(jsonb_build_object('slug', 'p9-imported', 'name', 'P9 Imported')),
    'products', jsonb_build_array(
      jsonb_build_object('slug', 'p9-imp-latte', 'name', 'P9 Imported Latte', 'category_slug', 'p9-imported',
        'base_price_cents', 0, 'sizes', jsonb_build_array(jsonb_build_object('name', 'Regular', 'price_cents', 550, 'is_default', true)),
        'groups', jsonb_build_array(group_slug), 'allergens', jsonb_build_array('dairy'), 'dietary_tags', '[]'::jsonb,
        'is_catering_eligible', true, 'is_active', true),
      jsonb_build_object('slug', 'p9-imp-cookie', 'name', 'P9 Imported Cookie', 'category_slug', 'p9-imported',
        'base_price_cents', 350, 'sizes', '[]'::jsonb, 'groups', '[]'::jsonb, 'allergens', jsonb_build_array('gluten'),
        'dietary_tags', '[]'::jsonb, 'is_catering_eligible', false, 'is_active', true)
    )
  );
$$;

select is(
  pg_temp.as_user('c9000000-0000-0000-0000-000000000001', format($$select public.admin_import_menu(%L::jsonb, false, 'bad.csv')$$, pg_temp.plan('no-such-group'))),
  '22023', 'an import naming an unknown modifier group is refused');
select is((select count(*)::int from public.products where slug like 'p9-imp-%'), 0, 'and changes nothing (all or nothing)');

select pg_temp.admin_a();
select is(
  (select public.admin_import_menu(pg_temp.plan('p9-temp'), false, 'menu.csv') ->> 'products_created'),
  '2', 'an import creates its products');
select is(
  (select public.admin_import_menu(pg_temp.plan('p9-temp'), false, 'menu.csv') ->> 'products_created'),
  '0', 'importing again creates nothing new');
select is((select count(*)::int from public.products where slug like 'p9-imp-%'), 2, 'no duplicates after a re-import');
select is(
  (select count(*)::int from public.admin_audit_log where action = 'import' and row_label = 'menu.csv'),
  2, 'each import is one audit entry');
select is(
  (select count(*)::int from public.admin_audit_log where table_name = 'products' and action = 'create' and row_label like 'P9 Imported%'),
  0, 'with no per-row entries');

-- ---------------------------------------------------------------------------
-- Roles.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.as_user('c9000000-0000-0000-0000-000000000001', $$select public.admin_set_role('c9000000-0000-0000-0000-000000000001', 'staff')$$),
  'DC050', 'an admin cannot change their own role');
select is(
  pg_temp.as_user('c9000000-0000-0000-0000-000000000001', $$select public.admin_set_role('c9000000-0000-0000-0000-000000000003', 'customer')$$),
  'ok', 'an admin demotes a barista');
select is((select count(*)::int from public.staff_locations where profile_id = 'c9000000-0000-0000-0000-000000000003'), 0,
  'demoting staff clears their location assignments');
select is(
  pg_temp.as_user('c9000000-0000-0000-0000-000000000001',
    $$select public.admin_set_staff_locations('c9000000-0000-0000-0000-000000000003', array['c9100000-0000-0000-0000-000000000001'::uuid])$$),
  '22023', 'only staff accounts are assigned to locations');
select is(
  pg_temp.as_user('c9000000-0000-0000-0000-000000000001', $$select public.admin_set_role('c9000000-0000-0000-0000-000000000002', 'customer')$$),
  'ok', 'an admin demotes the other admin');
select is(
  pg_temp.as_user('c9000000-0000-0000-0000-000000000002', $$select public.admin_set_role('c9000000-0000-0000-0000-000000000001', 'customer')$$),
  '42501', 'who, demoted, can no longer demote anyone');
select is((select role::text from public.profiles where id = 'c9000000-0000-0000-0000-000000000001'), 'admin',
  'so the last admin standing keeps the role');

-- ---------------------------------------------------------------------------
-- Promotions: locked once redeemed.
-- ---------------------------------------------------------------------------
select pg_temp.admin_a();
insert into ids select 'promo', public.admin_save_promo('{"code": "p9save", "type": "percent", "percent": 10}'::jsonb);
select is((select code from public.promos where id = (select id from ids where name = 'promo')), 'P9SAVE', 'codes are stored in capitals (matched ignoring case)');
select lives_ok(format($$select public.admin_save_promo('{"id": "%s", "code": "P9SAVE15", "type": "percent", "percent": 15}'::jsonb)$$,
  (select id from ids where name = 'promo')), 'an unused code can still change');
insert into public.promo_redemptions (promo_id, user_id, order_id, amount_cents)
values ((select id from ids where name = 'promo'), 'c9000000-0000-0000-0000-000000000004', 'c9200000-0000-0000-0000-000000000001', 50);
select throws_ok(format($$select public.admin_save_promo('{"id": "%s", "code": "P9SAVE20", "type": "percent", "percent": 15}'::jsonb)$$,
  (select id from ids where name = 'promo')), 'DC040', null, 'a redeemed code cannot be renamed');
select throws_ok(format($$select public.admin_save_promo('{"id": "%s", "code": "P9SAVE15", "type": "percent", "percent": 25}'::jsonb)$$,
  (select id from ids where name = 'promo')), 'DC040', null, 'nor its discount changed');
select lives_ok(format($$select public.admin_save_promo('{"id": "%s", "code": "P9SAVE15", "type": "percent", "percent": 15, "usage_limit": 50, "is_active": false, "ends_at": "2099-01-01T00:00:00Z"}'::jsonb)$$,
  (select id from ids where name = 'promo')), 'but its dates, limits and on/off switch can');
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- The attention queue.
-- ---------------------------------------------------------------------------
insert into public.email_outbox (id, kind, order_id, dedupe_key, status, attempts, last_error)
values ('c9300000-0000-0000-0000-000000000001', 'order_receipt', 'c9200000-0000-0000-0000-000000000001',
        'p9-failed-email', 'failed', 6, 'Mailbox unavailable');
select is(
  pg_temp.value_as('c9000000-0000-0000-0000-000000000001',
    $$select count(*)::text from public.admin_attention_items() where kind = 'failed_email' and id = 'c9300000-0000-0000-0000-000000000001'$$),
  '1', 'a failed email is in the attention queue');
select is(
  pg_temp.as_user('c9000000-0000-0000-0000-000000000001', $$select public.admin_dismiss_email('c9300000-0000-0000-0000-000000000001', '')$$),
  '22023', 'dismissing needs a note');
select is(
  pg_temp.as_user('c9000000-0000-0000-0000-000000000001', $$select public.admin_retry_email('c9300000-0000-0000-0000-000000000001')$$),
  'ok', 'retrying puts it back in the outbox');
select is(
  pg_temp.value_as('c9000000-0000-0000-0000-000000000001',
    $$select count(*)::text from public.admin_attention_items() where id = 'c9300000-0000-0000-0000-000000000001'$$),
  '0', 'and it leaves the queue');

-- ---------------------------------------------------------------------------
-- Reports.
--   O2 placed 23:30 HST on 2026-03-09 (09:30 UTC on the 10th): $10.00, $1.00
--      promo, tax 42, tip 180, fully refunded
--   O3 2026-03-10 noon HST: $20.00, $5.00 reward, tax 71, tip 0, $5.00 refunded
--   O4 2026-03-10 1 PM HST: $8.00, nothing off, tax 38, tip 100
-- ---------------------------------------------------------------------------
insert into public.orders (id, user_id, location_id, status, placed_at, subtotal_cents, discount_cents, reward_discount_cents,
                           taxable_base_cents, tax_rate, tax_cents, tip_cents, total_cents, promo_code, idempotency_key, order_number)
values
  ('c9200000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000004', 'c9100000-0000-0000-0000-000000000001',
   'refunded', '2026-03-10 09:30:00+00', 1000, 100, 0, 900, 0.04712, 42, 180, 1122, 'p9save15', 'p9-order-2', 'P9-TEST-0002'),
  ('c9200000-0000-0000-0000-000000000003', 'c9000000-0000-0000-0000-000000000004', 'c9100000-0000-0000-0000-000000000001',
   'picked_up', '2026-03-10 22:00:00+00', 2000, 500, 500, 1500, 0.04712, 71, 0, 1571, null, 'p9-order-3', 'P9-TEST-0003'),
  ('c9200000-0000-0000-0000-000000000004', 'c9000000-0000-0000-0000-000000000004', 'c9100000-0000-0000-0000-000000000001',
   'picked_up', '2026-03-10 23:00:00+00', 800, 0, 0, 800, 0.04712, 38, 100, 938, null, 'p9-order-4', 'P9-TEST-0004');
insert into public.payments (order_id, provider_payment_intent_id, status, amount_cents, refunded_cents) values
  ('c9200000-0000-0000-0000-000000000002', 'pi_p9_2', 'refunded', 1122, 1122),
  ('c9200000-0000-0000-0000-000000000003', 'pi_p9_3', 'partially_refunded', 1571, 500),
  ('c9200000-0000-0000-0000-000000000004', 'pi_p9_4', 'succeeded', 938, 0);

select pg_temp.admin_a();

select results_eq(
  $$select business_date, orders from public.admin_report_sales('2026-03-09', '2026-03-10', 'c9100000-0000-0000-0000-000000000001')$$,
  $$values ('2026-03-09'::date, 1::bigint), ('2026-03-10'::date, 2::bigint)$$,
  'orders are counted on their Honolulu date (11:30 PM HST stays on the 9th)');

select results_eq(
  $$select net_sales_cents, net_tax_cents, net_tip_cents, refunded_sales_cents + refunded_tax_cents + refunded_tip_cents
      from public.admin_report_orders('2026-03-09', '2026-03-09', 'c9100000-0000-0000-0000-000000000001')$$,
  $$values (0, 0, 0, 1122)$$,
  'a full refund takes back exactly the sales, tax and tip the order added');

select results_eq(
  $$select sum(gross_sales_cents)::bigint, sum(promo_discount_cents)::bigint, sum(reward_discount_cents)::bigint,
           sum(refunded_cents)::bigint, sum(net_sales_cents)::bigint, sum(net_tax_cents)::bigint, sum(net_tip_cents)::bigint,
           count(*)::bigint
      from public.admin_report_orders('2026-03-01', '2026-03-31', 'c9100000-0000-0000-0000-000000000001')$$,
  $$select sum(gross_sales_cents)::bigint, sum(promo_discount_cents)::bigint, sum(reward_discount_cents)::bigint,
           sum(refunded_cents)::bigint, sum(net_sales_cents)::bigint, sum(tax_cents)::bigint, sum(tip_cents)::bigint,
           sum(orders)::bigint
      from public.admin_report_sales('2026-03-01', '2026-03-31', 'c9100000-0000-0000-0000-000000000001')$$,
  'the orders export adds up to the sales report for the same range');

select is(
  (select sum(net_sales_cents + net_tax_cents + net_tip_cents)::int from public.admin_report_orders('2026-03-01', '2026-03-31', 'c9100000-0000-0000-0000-000000000001')),
  (select (sum(total_cents) - sum(refunded_cents))::int from public.admin_report_orders('2026-03-01', '2026-03-31', 'c9100000-0000-0000-0000-000000000001')),
  'net sales + tax + tips = collected - refunded');

select results_eq(
  $$select kind, name, uses from public.admin_report_discounts('2026-03-01', '2026-03-31', 'c9100000-0000-0000-0000-000000000001')$$,
  $$values ('promo'::text, 'P9SAVE15'::text, 1::bigint)$$,
  'promo usage is reported by code');

select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
