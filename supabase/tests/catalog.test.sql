-- ============================================================================
-- Catalogue rules added in Phase 3: conditional modifier groups and the
-- per-unit pricing flag. Rolled back at the end.
-- ============================================================================
begin;

select plan(8);

-- The condition check is deferred to commit; this suite rolls back, so make it
-- fire at the end of each statement instead.
set constraints product_modifier_groups_condition_valid immediate;

create function pg_temp.sqlstate_of(sql text)
returns text
language plpgsql
as $$
begin
  execute sql;
  return 'ok';
exception
  when others then
    return sqlstate;
end;
$$;

insert into public.products (id, name, slug) values
  ('60000000-0000-0000-0000-000000000001', 'Test Iced Latte', 'test-iced-latte'),
  ('60000000-0000-0000-0000-000000000002', 'Test Lemonade', 'test-lemonade');

insert into public.modifier_groups (id, name, slug, selection_type) values
  ('70000000-0000-0000-0000-000000000001', 'Test temperature', 'test-temperature', 'single'),
  ('70000000-0000-0000-0000-000000000002', 'Test ice', 'test-ice', 'single'),
  ('70000000-0000-0000-0000-000000000003', 'Test pumps', 'test-pumps', 'multi');

insert into public.modifier_options (id, modifier_group_id, name) values
  ('80000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'Hot'),
  ('80000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', 'Iced'),
  ('80000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000002', 'Light ice');

select is(
  (select charge_per_quantity from public.modifier_groups where id = '70000000-0000-0000-0000-000000000003'),
  true,
  'modifier groups charge per unit unless told otherwise'
);

select is(
  pg_temp.sqlstate_of($$
    insert into public.product_modifier_groups (product_id, modifier_group_id, sort_order, visible_when_option_id) values
      ('60000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', 10, '80000000-0000-0000-0000-000000000002'),
      ('60000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 0, null)
  $$),
  'ok',
  'Ice may depend on Iced when both groups are on the product, whatever order they are linked in'
);

select is(
  pg_temp.sqlstate_of($$
    insert into public.product_modifier_groups (product_id, modifier_group_id, visible_when_option_id)
    values ('60000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000002')
  $$),
  '23514',
  'a condition on an option from a group the product does not have is rejected'
);

select is(
  pg_temp.sqlstate_of($$
    insert into public.product_modifier_groups (product_id, modifier_group_id, visible_when_option_id)
    values ('60000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000002')
  $$),
  '23514',
  'a group cannot depend on one of its own options'
);

select is(
  pg_temp.sqlstate_of($$
    update public.product_modifier_groups
       set visible_when_option_id = '80000000-0000-0000-0000-000000000001'
     where product_id = '60000000-0000-0000-0000-000000000001'
       and modifier_group_id = '70000000-0000-0000-0000-000000000002'
  $$),
  'ok',
  'an update can move the condition to another option (Ice only when Hot, say)'
);

select is(
  pg_temp.sqlstate_of($$
    update public.product_modifier_groups
       set visible_when_option_id = '80000000-0000-0000-0000-000000000003'
     where product_id = '60000000-0000-0000-0000-000000000001'
       and modifier_group_id = '70000000-0000-0000-0000-000000000002'
  $$),
  '23514',
  'an update is checked too (Ice cannot depend on its own Light ice)'
);

-- Deleting the controlling option leaves the group unconditional, not hidden.
delete from public.modifier_options where id = '80000000-0000-0000-0000-000000000001';

select is(
  (select visible_when_option_id from public.product_modifier_groups
    where product_id = '60000000-0000-0000-0000-000000000001'
      and modifier_group_id = '70000000-0000-0000-0000-000000000002'),
  null,
  'removing the controlling option makes the group always shown'
);

set local role anon;
select is(
  (select count(*)::int from public.product_modifier_groups
    where product_id = '60000000-0000-0000-0000-000000000001'),
  2,
  'guests can read product links, conditions included, to render the menu'
);
reset role;

select * from finish();
rollback;
