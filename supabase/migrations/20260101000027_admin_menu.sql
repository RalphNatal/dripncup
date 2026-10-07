-- ============================================================================
-- Phase 9: the menu editor and the spreadsheet import.
--
-- Every write is a security-definer function that checks the caller is an
-- admin, validates what the pricing engine relies on, and runs as the admin
-- (so the audit trigger names them). Errors:
--
--   42501  not an admin
--   22023  invalid input; the message says what to fix
--   23505  a web address (slug) or name is taken
--   DC030  can't delete: it is used (past orders, favourites, event menus,
--          collections, catering, rewards) -- archive it instead
--   DC031  "Only show when" names an option that is not on another group of
--          the same product
--   DC032  a required single-choice group needs a default option
--   DC033  an archived item must be restored before it is switched on
--   DC034  that option controls an "Only show when" rule on a product
--   DC035  that group is still on products
--   DC036  "Only show when" rules on a product form a loop
--
-- Archive vs delete: a product, size, modifier group or option that anything
-- refers to is archived (inactive, hidden from customers, kept for history);
-- only something never used is deleted. Carts live in the customer's browser,
-- so they are not "uses": a cart holding a deleted or archived product shows
-- it as no longer available, the same either way (Phase 4 cart checks).
-- ============================================================================

create or replace function public.assert_admin()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can do that' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke execute on function public.assert_admin() from public, anon;
grant execute on function public.assert_admin() to authenticated;

create or replace function public.is_valid_slug(p_slug text)
returns boolean
language sql
immutable
as $$
  select p_slug is not null and char_length(p_slug) between 1 and 80 and p_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$';
$$;

-- ----------------------------------------------------------------------------
-- Usage: what refers to a product, size, option or group.
-- ----------------------------------------------------------------------------
create or replace function public.product_usage(p_product_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'orders', (select count(distinct order_id) from public.order_items where product_id = p_product_id),
    'favorites', (select count(*) from public.favorites where product_id = p_product_id),
    'event_menus', (select count(*) from public.event_menu_items where product_id = p_product_id),
    'collections', (select count(*) from public.collection_products where product_id = p_product_id),
    'catering', (select count(*) from public.catering_request_items where product_id = p_product_id)
              + (select count(*) from public.catering_quote_lines where product_id = p_product_id),
    'rewards', (select count(*) from public.rewards where p_product_id = any (applicable_product_ids))
  );
$$;

create or replace function public.usage_total(p_usage jsonb)
returns integer
language sql
immutable
as $$
  select coalesce(sum(value::integer), 0)::integer from jsonb_each_text(p_usage);
$$;

create or replace function public.product_size_used(p_size_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.order_items where product_size_id = p_size_id)
      or exists (select 1 from public.favorites where product_size_id = p_size_id)
      or exists (select 1 from public.catering_request_items where product_size_id = p_size_id)
      or exists (select 1 from public.catering_quote_lines where product_size_id = p_size_id);
$$;

create or replace function public.modifier_option_used(p_option_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.order_items where modifiers @> jsonb_build_array(jsonb_build_object('option_id', p_option_id)))
      or exists (select 1 from public.favorites where modifiers @> jsonb_build_array(jsonb_build_object('option_id', p_option_id)));
$$;

create or replace function public.modifier_group_usage(p_group_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'products', (select count(*) from public.product_modifier_groups where modifier_group_id = p_group_id),
    'orders', (select count(*) from public.order_items where modifiers @> jsonb_build_array(jsonb_build_object('group_id', p_group_id))),
    'favorites', (select count(*) from public.favorites where modifiers @> jsonb_build_array(jsonb_build_object('group_id', p_group_id))),
    'rewards', (select count(*) from public.rewards where p_group_id = any (applicable_modifier_group_ids))
  );
$$;

revoke execute on function public.product_usage(uuid) from public, anon, authenticated;
revoke execute on function public.product_size_used(uuid) from public, anon, authenticated;
revoke execute on function public.modifier_option_used(uuid) from public, anon, authenticated;
revoke execute on function public.modifier_group_usage(uuid) from public, anon, authenticated;

-- For the editor: "used in 12 orders and 2 favourites, so it can only be archived".
create or replace function public.admin_menu_usage(p_kind text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_admin();
  return case p_kind
    when 'product' then public.product_usage(p_id)
    when 'modifier_group' then public.modifier_group_usage(p_id)
    else '{}'::jsonb
  end;
end;
$$;

revoke execute on function public.admin_menu_usage(text, uuid) from public, anon;
grant execute on function public.admin_menu_usage(text, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Categories.
-- p: id (null to create), name, slug, description, is_active
-- ----------------------------------------------------------------------------
create or replace function public.admin_save_category(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  category_id uuid := nullif(p ->> 'id', '')::uuid;
  v_name text := btrim(coalesce(p ->> 'name', ''));
  v_slug text := btrim(coalesce(p ->> 'slug', ''));
  v_description text := nullif(btrim(coalesce(p ->> 'description', '')), '');
begin
  perform public.assert_admin();
  if char_length(v_name) not between 1 and 60 then
    raise exception 'Give the category a name of up to 60 characters' using errcode = 'invalid_parameter_value';
  end if;
  if not public.is_valid_slug(v_slug) then
    raise exception 'The web address may use lowercase letters, numbers and single hyphens' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(coalesce(v_description, '')) > 300 then
    raise exception 'Keep the description to 300 characters' using errcode = 'invalid_parameter_value';
  end if;

  if category_id is null then
    insert into public.categories (name, slug, description, is_active, sort_order)
    values (v_name, v_slug, v_description, coalesce((p ->> 'is_active')::boolean, true),
            coalesce((select max(sort_order) + 10 from public.categories), 0))
    returning id into category_id;
  else
    update public.categories
       set name = v_name, slug = v_slug, description = v_description,
           is_active = coalesce((p ->> 'is_active')::boolean, is_active)
     where id = category_id;
    if not found then
      raise exception 'Category not found' using errcode = 'no_data_found';
    end if;
  end if;
  return category_id;
end;
$$;

-- Display order: the ids in their new order.
create or replace function public.admin_reorder_categories(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_admin();
  update public.categories c
     set sort_order = (o.n - 1)::integer * 10
    from unnest(p_ids) with ordinality as o(id, n)
   where c.id = o.id and c.sort_order is distinct from (o.n - 1)::integer * 10;
end;
$$;

-- Only an empty category can go; one with products is switched off instead.
create or replace function public.admin_delete_category(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  perform public.assert_admin();
  select count(*) into n from public.products where category_id = p_id;
  if n > 0 then
    raise exception 'This category still has % product(s). Move them or switch the category off instead.', n
      using errcode = 'DC030';
  end if;
  delete from public.categories where id = p_id;
  if not found then
    raise exception 'Category not found' using errcode = 'no_data_found';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Products. Internal writers shared by the editor and the import.
-- ----------------------------------------------------------------------------

-- Inserts (p_id null) or updates one product's own fields. Returns its id.
-- p: name, slug, description, category_id, base_price_cents, allergens[],
--    dietary_tags[], calories, is_catering_eligible, is_active, image_url,
--    available_from, available_until, sort_order (optional)
create or replace function public.write_product(p_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := p_id;
  v_name text := btrim(coalesce(p ->> 'name', ''));
  v_slug text := btrim(coalesce(p ->> 'slug', ''));
  v_description text := nullif(btrim(coalesce(p ->> 'description', '')), '');
  v_category uuid := nullif(p ->> 'category_id', '')::uuid;
  v_price integer := coalesce(nullif(p ->> 'base_price_cents', '')::integer, 0);
  v_calories integer := nullif(p ->> 'calories', '')::integer;
  v_from timestamptz := nullif(p ->> 'available_from', '')::timestamptz;
  v_until timestamptz := nullif(p ->> 'available_until', '')::timestamptz;
  v_active boolean := coalesce((p ->> 'is_active')::boolean, true);
  v_allergens public.allergen[];
  v_dietary public.dietary_tag[];
  archived timestamptz;
begin
  if char_length(v_name) not between 1 and 80 then
    raise exception 'Give the product a name of up to 80 characters' using errcode = 'invalid_parameter_value';
  end if;
  if not public.is_valid_slug(v_slug) then
    raise exception 'The web address may use lowercase letters, numbers and single hyphens' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(coalesce(v_description, '')) > 1000 then
    raise exception 'Keep the description to 1,000 characters' using errcode = 'invalid_parameter_value';
  end if;
  if v_price not between 0 and 100000 then
    raise exception 'The price must be between $0.00 and $1,000.00' using errcode = 'invalid_parameter_value';
  end if;
  if v_calories is not null and v_calories not between 0 and 5000 then
    raise exception 'Calories must be between 0 and 5,000' using errcode = 'invalid_parameter_value';
  end if;
  if v_category is not null and not exists (select 1 from public.categories where id = v_category) then
    raise exception 'That category no longer exists' using errcode = 'invalid_parameter_value';
  end if;
  if v_from is not null and v_until is not null and v_until <= v_from then
    raise exception 'A limited-time product must end after it starts' using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(array_agg(distinct x::public.allergen), '{}') into v_allergens
    from jsonb_array_elements_text(coalesce(p -> 'allergens', '[]'::jsonb)) as t(x);
  select coalesce(array_agg(distinct x::public.dietary_tag), '{}') into v_dietary
    from jsonb_array_elements_text(coalesce(p -> 'dietary_tags', '[]'::jsonb)) as t(x);

  if v_id is null then
    insert into public.products (
      name, slug, description, category_id, base_price_cents, allergens, dietary_tags, calories,
      is_catering_eligible, is_active, image_url, available_from, available_until, sort_order
    )
    values (
      v_name, v_slug, v_description, v_category, v_price, v_allergens, v_dietary, v_calories,
      coalesce((p ->> 'is_catering_eligible')::boolean, false), v_active,
      nullif(p ->> 'image_url', ''), v_from, v_until,
      coalesce(nullif(p ->> 'sort_order', '')::integer,
               (select coalesce(max(sort_order) + 10, 0) from public.products where category_id is not distinct from v_category))
    )
    returning id into v_id;
  else
    select archived_at into archived from public.products where id = v_id for update;
    if not found then
      raise exception 'Product not found' using errcode = 'no_data_found';
    end if;
    if archived is not null and v_active then
      raise exception 'This product is archived. Restore it before switching it on.' using errcode = 'DC033';
    end if;
    update public.products
       set name = v_name, slug = v_slug, description = v_description, category_id = v_category,
           base_price_cents = v_price, allergens = v_allergens, dietary_tags = v_dietary, calories = v_calories,
           is_catering_eligible = coalesce((p ->> 'is_catering_eligible')::boolean, is_catering_eligible),
           is_active = v_active,
           image_url = case when p ? 'image_url' then nullif(p ->> 'image_url', '') else image_url end,
           available_from = case when p ? 'available_from' then v_from else available_from end,
           available_until = case when p ? 'available_until' then v_until else available_until end,
           sort_order = coalesce(nullif(p ->> 'sort_order', '')::integer, sort_order)
     where id = v_id;
  end if;
  return v_id;
end;
$$;

-- Replaces a product's sizes with p_sizes, in order:
--   [{id (optional), name, price_cents, volume_oz, is_default}]
-- Exactly one default when there are any. A size left out is deleted if
-- nothing ever used it, otherwise archived; a new size with an archived
-- size's name brings that one back.
create or replace function public.write_product_sizes(p_product_id uuid, p_sizes jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sizes jsonb := coalesce(p_sizes, '[]'::jsonb);
  item record;
  existing uuid;
  kept uuid[];
  gone record;
begin
  if jsonb_typeof(sizes) <> 'array' or jsonb_array_length(sizes) > 10 then
    raise exception 'A product can have up to 10 sizes' using errcode = 'invalid_parameter_value';
  end if;
  if exists (
    select 1 from jsonb_array_elements(sizes) s
     where char_length(btrim(coalesce(s ->> 'name', ''))) not between 1 and 40
        or coalesce((s ->> 'price_cents')::integer, -1) not between 0 and 100000
        or (nullif(s ->> 'volume_oz', '') is not null and (s ->> 'volume_oz')::integer not between 1 and 128)
  ) then
    raise exception 'Each size needs a name (up to 40 characters) and a price between $0.00 and $1,000.00' using errcode = 'invalid_parameter_value';
  end if;
  if (select count(distinct lower(btrim(s ->> 'name'))) from jsonb_array_elements(sizes) s) <> jsonb_array_length(sizes) then
    raise exception 'Each size needs a different name' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(sizes) > 0
     and (select count(*) from jsonb_array_elements(sizes) s where coalesce((s ->> 'is_default')::boolean, false)) <> 1 then
    raise exception 'Pick exactly one default size' using errcode = 'invalid_parameter_value';
  end if;

  kept := array(
    select (s ->> 'id')::uuid from jsonb_array_elements(sizes) s where nullif(s ->> 'id', '') is not null
  );

  -- No two defaults, even for a moment (one default per product is unique).
  update public.product_sizes set is_default = false where product_id = p_product_id and is_default;

  for gone in
    select id from public.product_sizes
     where product_id = p_product_id and archived_at is null and not (id = any (kept))
  loop
    if public.product_size_used(gone.id) then
      update public.product_sizes set is_active = false, archived_at = now() where id = gone.id;
    else
      delete from public.product_sizes where id = gone.id;
    end if;
  end loop;

  for item in
    select nullif(s ->> 'id', '')::uuid as id, btrim(s ->> 'name') as name, (s ->> 'price_cents')::integer as price,
           nullif(s ->> 'volume_oz', '')::integer as oz, coalesce((s ->> 'is_default')::boolean, false) as is_default,
           (n - 1)::integer * 10 as sort_order
      from jsonb_array_elements(sizes) with ordinality as t(s, n)
  loop
    existing := null;
    if item.id is not null then
      select id into existing from public.product_sizes where id = item.id and product_id = p_product_id;
    end if;
    if existing is null then
      select id into existing from public.product_sizes where product_id = p_product_id and name = item.name;
    end if;
    -- A renamed size taking an archived size's name: the archived one steps aside.
    update public.product_sizes
       set name = left(name, 28) || ' (archived)'
     where product_id = p_product_id and name = item.name and archived_at is not null
       and id is distinct from existing;

    if existing is null then
      insert into public.product_sizes (product_id, name, price_cents, volume_oz, is_default, sort_order, is_active)
      values (p_product_id, item.name, item.price, item.oz, item.is_default, item.sort_order, true);
    else
      update public.product_sizes
         set name = item.name, price_cents = item.price, volume_oz = item.oz, is_default = item.is_default,
             sort_order = item.sort_order, is_active = true, archived_at = null
       where id = existing;
    end if;
  end loop;
end;
$$;

-- Replaces a product's modifier groups with p_groups, in order:
--   [{group_id, visible_when_option_id}]
-- Per-product overrides on links that stay are kept.
create or replace function public.write_product_groups(p_product_id uuid, p_groups jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  groups jsonb := coalesce(p_groups, '[]'::jsonb);
  wanted uuid[];
  bad record;
begin
  if jsonb_typeof(groups) <> 'array' or jsonb_array_length(groups) > 20 then
    raise exception 'A product can have up to 20 modifier groups' using errcode = 'invalid_parameter_value';
  end if;
  wanted := array(select (g ->> 'group_id')::uuid from jsonb_array_elements(groups) g);
  if cardinality(wanted) <> (select count(distinct x) from unnest(wanted) x) then
    raise exception 'Each modifier group can be added once' using errcode = 'invalid_parameter_value';
  end if;
  if exists (
    select 1 from unnest(wanted) x
     where not exists (select 1 from public.modifier_groups g where g.id = x and g.archived_at is null)
  ) then
    raise exception 'One of those modifier groups no longer exists' using errcode = 'invalid_parameter_value';
  end if;

  -- "Only show when [option]": the option must be on another of this product's groups.
  select g ->> 'group_id' as group_id, g ->> 'visible_when_option_id' as option_id into bad
    from jsonb_array_elements(groups) g
   where nullif(g ->> 'visible_when_option_id', '') is not null
     and not exists (
       select 1 from public.modifier_options o
        where o.id = (g ->> 'visible_when_option_id')::uuid
          and o.modifier_group_id = any (wanted)
          and o.modifier_group_id <> (g ->> 'group_id')::uuid
          and o.archived_at is null
     )
   limit 1;
  if found then
    raise exception '"Only show when" must name an option from another group on this product' using errcode = 'DC031';
  end if;

  delete from public.product_modifier_groups
   where product_id = p_product_id and not (modifier_group_id = any (wanted));

  insert into public.product_modifier_groups (product_id, modifier_group_id, sort_order, visible_when_option_id)
  select p_product_id, (g ->> 'group_id')::uuid, (n - 1)::integer * 10, nullif(g ->> 'visible_when_option_id', '')::uuid
    from jsonb_array_elements(groups) with ordinality as t(g, n)
  on conflict (product_id, modifier_group_id) do update
     set sort_order = excluded.sort_order, visible_when_option_id = excluded.visible_when_option_id
   where product_modifier_groups.sort_order is distinct from excluded.sort_order
      or product_modifier_groups.visible_when_option_id is distinct from excluded.visible_when_option_id;

  -- No loops: A shown only when B's option is picked and B only when A's
  -- (directly or through others) would hide every group in the loop.
  if exists (
    with recursive edges as (
      select l.modifier_group_id as grp, o.modifier_group_id as needs
        from public.product_modifier_groups l
        join public.modifier_options o on o.id = l.visible_when_option_id
       where l.product_id = p_product_id
    ),
    walk as (
      select grp as start, needs as at, 1 as depth from edges
      union all
      select w.start, e.needs, w.depth + 1 from walk w join edges e on e.grp = w.at where w.depth < 25 and w.at <> w.start
    )
    select 1 from walk where at = start
  ) then
    raise exception '"Only show when" rules on this product depend on each other in a loop, so those groups would never show'
      using errcode = 'DC036';
  end if;

  -- Required and single-choice (on this product) needs a default, or the
  -- customer is handed a sheet they cannot add without choosing.
  select g.name into bad
    from public.product_modifier_groups l
    join public.modifier_groups g on g.id = l.modifier_group_id
   where l.product_id = p_product_id
     and g.selection_type = 'single'
     and coalesce(l.override_is_required, g.is_required)
     and not exists (
       select 1 from public.modifier_options o
        where o.modifier_group_id = g.id and o.is_default and o.is_active
     )
   limit 1;
  if found then
    raise exception '% is required and single-choice, so it needs a default option', bad.name using errcode = 'DC032';
  end if;
end;
$$;

revoke execute on function public.write_product(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.write_product_sizes(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.write_product_groups(uuid, jsonb) from public, anon, authenticated;

-- The editor's save: the product, its sizes and its modifier groups in one
-- transaction. Price changes reach new carts and orders only; every past
-- order keeps its snapshot.
create or replace function public.admin_save_product(p_product jsonb, p_sizes jsonb, p_groups jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  product_id uuid;
begin
  perform public.assert_admin();
  product_id := public.write_product(nullif(p_product ->> 'id', '')::uuid, p_product);
  perform public.write_product_sizes(product_id, p_sizes);
  perform public.write_product_groups(product_id, p_groups);
  return product_id;
end;
$$;

create or replace function public.admin_set_product_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  archived timestamptz;
begin
  perform public.assert_admin();
  select archived_at into archived from public.products where id = p_id for update;
  if not found then
    raise exception 'Product not found' using errcode = 'no_data_found';
  end if;
  if archived is not null and p_active then
    raise exception 'This product is archived. Restore it before switching it on.' using errcode = 'DC033';
  end if;
  update public.products set is_active = p_active where id = p_id and is_active is distinct from p_active;
end;
$$;

-- Archive: off the menu everywhere, kept for history.
create or replace function public.admin_archive_product(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_admin();
  update public.products set is_active = false, archived_at = coalesce(archived_at, now()) where id = p_id;
  if not found then
    raise exception 'Product not found' using errcode = 'no_data_found';
  end if;
end;
$$;

-- Restore: back in the editor's list, still switched off.
create or replace function public.admin_restore_product(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_admin();
  update public.products set archived_at = null where id = p_id;
  if not found then
    raise exception 'Product not found' using errcode = 'no_data_found';
  end if;
end;
$$;

-- Delete: only a product nothing has ever used.
create or replace function public.admin_delete_product(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  usage jsonb;
begin
  perform public.assert_admin();
  perform 1 from public.products where id = p_id for update;
  if not found then
    raise exception 'Product not found' using errcode = 'no_data_found';
  end if;
  usage := public.product_usage(p_id);
  if public.usage_total(usage) > 0 then
    raise exception 'This product has been used (% ), so it can only be archived', usage::text using errcode = 'DC030';
  end if;
  delete from public.products where id = p_id;
end;
$$;

create or replace function public.admin_reorder_products(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_admin();
  update public.products p
     set sort_order = (o.n - 1)::integer * 10
    from unnest(p_ids) with ordinality as o(id, n)
   where p.id = o.id and p.sort_order is distinct from (o.n - 1)::integer * 10;
end;
$$;

-- ----------------------------------------------------------------------------
-- Modifier groups and their options (shared by every product they are on).
--
-- p_group: id (null to create), name, slug, description, selection_type,
--   is_required, min_selections, max_selections, max_quantity_per_option,
--   quantity_unit, charge_per_quantity, is_active
-- p_options: [{id (optional), name, description, price_delta_cents,
--   is_default, max_quantity, allergens[]}] in display order
-- ----------------------------------------------------------------------------
create or replace function public.admin_save_modifier_group(p_group jsonb, p_options jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  group_id uuid := nullif(p_group ->> 'id', '')::uuid;
  v_name text := btrim(coalesce(p_group ->> 'name', ''));
  v_slug text := btrim(coalesce(p_group ->> 'slug', ''));
  v_type public.modifier_selection_type := coalesce(nullif(p_group ->> 'selection_type', ''), 'single')::public.modifier_selection_type;
  v_required boolean := coalesce((p_group ->> 'is_required')::boolean, false);
  v_min integer := coalesce(nullif(p_group ->> 'min_selections', '')::integer, 0);
  v_max integer := nullif(p_group ->> 'max_selections', '')::integer;
  v_qty integer := coalesce(nullif(p_group ->> 'max_quantity_per_option', '')::integer, 1);
  v_unit text := nullif(btrim(coalesce(p_group ->> 'quantity_unit', '')), '');
  options jsonb := coalesce(p_options, '[]'::jsonb);
  defaults integer;
  kept uuid[];
  gone record;
  item record;
  existing uuid;
  archived timestamptz;
  v_active boolean := coalesce((p_group ->> 'is_active')::boolean, true);
begin
  perform public.assert_admin();

  if char_length(v_name) not between 1 and 60 then
    raise exception 'Give the group a name of up to 60 characters' using errcode = 'invalid_parameter_value';
  end if;
  if not public.is_valid_slug(v_slug) then
    raise exception 'The short name may use lowercase letters, numbers and single hyphens' using errcode = 'invalid_parameter_value';
  end if;
  if v_type = 'single' then
    v_max := 1;
    v_qty := 1;
  end if;
  if v_min not between 0 and 20 or (v_max is not null and v_max not between 1 and 20) then
    raise exception 'Choices must be between 0 and 20' using errcode = 'invalid_parameter_value';
  end if;
  if v_required and v_min < 1 then
    raise exception 'A required group needs at least 1 choice' using errcode = 'invalid_parameter_value';
  end if;
  if not v_required and v_min > 0 then
    raise exception 'An optional group can''t have a minimum; make it required instead' using errcode = 'invalid_parameter_value';
  end if;
  if v_max is not null and v_max < v_min then
    raise exception 'The most choices can''t be fewer than the least' using errcode = 'invalid_parameter_value';
  end if;
  if v_qty not between 1 and 20 then
    raise exception 'Units per option must be between 1 and 20' using errcode = 'invalid_parameter_value';
  end if;
  if v_unit is not null and (char_length(v_unit) > 20 or v_unit !~ '^[a-z][a-z ]*$') then
    raise exception 'The unit is a short lowercase word, like "pump" or "shot"' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(options) <> 'array' or jsonb_array_length(options) not between 1 and 50 then
    raise exception 'A group needs between 1 and 50 options' using errcode = 'invalid_parameter_value';
  end if;
  if exists (
    select 1 from jsonb_array_elements(options) o
     where char_length(btrim(coalesce(o ->> 'name', ''))) not between 1 and 60
        or coalesce((o ->> 'price_delta_cents')::integer, 0) not between -100000 and 100000
        or coalesce(nullif(o ->> 'max_quantity', '')::integer, 1) not between 1 and v_qty
        or char_length(coalesce(o ->> 'description', '')) > 200
  ) then
    raise exception 'Each option needs a name (up to 60 characters), a price change between -$1,000 and $1,000, and at most % unit(s)', v_qty
      using errcode = 'invalid_parameter_value';
  end if;
  if (select count(distinct lower(btrim(o ->> 'name'))) from jsonb_array_elements(options) o) <> jsonb_array_length(options) then
    raise exception 'Each option needs a different name' using errcode = 'invalid_parameter_value';
  end if;

  select count(*) into defaults from jsonb_array_elements(options) o where coalesce((o ->> 'is_default')::boolean, false);
  if v_type = 'single' and defaults > 1 then
    raise exception 'A single-choice group can have only one default' using errcode = 'invalid_parameter_value';
  end if;
  if v_type = 'single' and v_required and defaults <> 1 then
    raise exception 'A required single-choice group needs a default option' using errcode = 'DC032';
  end if;
  if v_type = 'multi' and v_max is not null and defaults > v_max then
    raise exception 'More defaults than the group allows (% at most)', v_max using errcode = 'invalid_parameter_value';
  end if;

  if group_id is null then
    insert into public.modifier_groups (
      name, slug, description, selection_type, is_required, min_selections, max_selections,
      max_quantity_per_option, quantity_unit, charge_per_quantity, is_active, sort_order
    )
    values (
      v_name, v_slug, nullif(btrim(coalesce(p_group ->> 'description', '')), ''), v_type, v_required, v_min, v_max,
      v_qty, v_unit, coalesce((p_group ->> 'charge_per_quantity')::boolean, true), v_active,
      coalesce((select max(sort_order) + 10 from public.modifier_groups), 0)
    )
    returning id into group_id;
  else
    select archived_at into archived from public.modifier_groups where id = group_id for update;
    if not found then
      raise exception 'Modifier group not found' using errcode = 'no_data_found';
    end if;
    if archived is not null and v_active then
      raise exception 'This group is archived. Restore it before switching it on.' using errcode = 'DC033';
    end if;
    update public.modifier_groups
       set name = v_name, slug = v_slug, description = nullif(btrim(coalesce(p_group ->> 'description', '')), ''),
           selection_type = v_type, is_required = v_required, min_selections = v_min, max_selections = v_max,
           max_quantity_per_option = v_qty, quantity_unit = v_unit,
           charge_per_quantity = coalesce((p_group ->> 'charge_per_quantity')::boolean, charge_per_quantity),
           is_active = v_active
     where id = group_id;
  end if;

  -- Options.
  kept := array(select (o ->> 'id')::uuid from jsonb_array_elements(options) o where nullif(o ->> 'id', '') is not null);

  for gone in
    select o.id, o.name from public.modifier_options o
     where o.modifier_group_id = group_id and o.archived_at is null and not (o.id = any (kept))
  loop
    if exists (select 1 from public.product_modifier_groups where visible_when_option_id = gone.id) then
      raise exception '"%" controls an "Only show when" rule on a product. Change that rule first.', gone.name
        using errcode = 'DC034';
    end if;
    if public.modifier_option_used(gone.id) then
      update public.modifier_options set is_active = false, is_default = false, archived_at = now() where id = gone.id;
    else
      delete from public.modifier_options where id = gone.id;
    end if;
  end loop;

  update public.modifier_options set is_default = false where modifier_group_id = group_id and is_default;

  for item in
    select nullif(o ->> 'id', '')::uuid as id, btrim(o ->> 'name') as name,
           nullif(btrim(coalesce(o ->> 'description', '')), '') as description,
           coalesce((o ->> 'price_delta_cents')::integer, 0) as price,
           coalesce((o ->> 'is_default')::boolean, false) as is_default,
           coalesce(nullif(o ->> 'max_quantity', '')::integer, 1) as max_quantity,
           array(select x::public.allergen from jsonb_array_elements_text(coalesce(o -> 'allergens', '[]'::jsonb)) x) as allergens,
           (n - 1)::integer * 10 as sort_order
      from jsonb_array_elements(options) with ordinality as t(o, n)
  loop
    existing := null;
    if item.id is not null then
      select id into existing from public.modifier_options where id = item.id and modifier_group_id = group_id;
    end if;
    if existing is null then
      select id into existing from public.modifier_options where modifier_group_id = group_id and name = item.name;
    end if;
    update public.modifier_options
       set name = left(name, 48) || ' (archived)'
     where modifier_group_id = group_id and name = item.name and archived_at is not null
       and id is distinct from existing;

    if existing is null then
      insert into public.modifier_options (
        modifier_group_id, name, description, price_delta_cents, is_default, max_quantity, allergens, sort_order, is_active
      )
      values (group_id, item.name, item.description, item.price, item.is_default, item.max_quantity, item.allergens, item.sort_order, true);
    else
      update public.modifier_options
         set name = item.name, description = item.description, price_delta_cents = item.price,
             is_default = item.is_default, max_quantity = item.max_quantity, allergens = item.allergens,
             sort_order = item.sort_order, is_active = true, archived_at = null
       where id = existing;
    end if;
  end loop;

  -- A product that makes this group required (override) still needs a default.
  if v_type = 'single' and defaults = 0 and exists (
    select 1 from public.product_modifier_groups l where l.modifier_group_id = group_id and l.override_is_required
  ) then
    raise exception 'A product makes this group required, so it needs a default option' using errcode = 'DC032';
  end if;

  return group_id;
end;
$$;

create or replace function public.admin_archive_modifier_group(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  perform public.assert_admin();
  select count(*) into n from public.product_modifier_groups where modifier_group_id = p_id;
  if n > 0 then
    raise exception 'This group is on % product(s). Remove it from them first.', n using errcode = 'DC035';
  end if;
  update public.modifier_groups set is_active = false, archived_at = coalesce(archived_at, now()) where id = p_id;
  if not found then
    raise exception 'Modifier group not found' using errcode = 'no_data_found';
  end if;
end;
$$;

create or replace function public.admin_restore_modifier_group(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_admin();
  update public.modifier_groups set archived_at = null where id = p_id;
  if not found then
    raise exception 'Modifier group not found' using errcode = 'no_data_found';
  end if;
end;
$$;

create or replace function public.admin_delete_modifier_group(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  usage jsonb;
begin
  perform public.assert_admin();
  perform 1 from public.modifier_groups where id = p_id for update;
  if not found then
    raise exception 'Modifier group not found' using errcode = 'no_data_found';
  end if;
  usage := public.modifier_group_usage(p_id);
  if (usage ->> 'products')::integer > 0 then
    raise exception 'This group is on % product(s). Remove it from them first.', usage ->> 'products' using errcode = 'DC035';
  end if;
  if public.usage_total(usage) > 0 or exists (
    select 1 from public.modifier_options o where o.modifier_group_id = p_id and public.modifier_option_used(o.id)
  ) then
    raise exception 'This group has been used in orders, favourites or rewards, so it can only be archived' using errcode = 'DC030';
  end if;
  delete from public.modifier_groups where id = p_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- The spreadsheet import, applied. The file is parsed and checked on the
-- server first (src/lib/menu-import); this gets the checked plan and applies
-- it in one transaction (all or nothing), validating again on the way.
--
-- p_plan:
--   categories: [{slug, name, description}]
--   products:   [{slug, name, description, category_slug, base_price_cents,
--                 sizes: [{name, price_cents, is_default}],
--                 groups: [group slug | {slug, visible_when_option_id}],
--                 allergens[], dietary_tags[], is_catering_eligible, is_active}]
-- Matching is by slug, so importing again updates instead of duplicating.
-- Nothing is deleted; products missing from the file are archived only when
-- p_archive_missing is true. Links that stay keep their "Only show when"
-- rule, unless its option's group is no longer on the product.
--
-- The rows' own audit entries are suppressed and one entry records the
-- import with its summary.
-- ----------------------------------------------------------------------------
create or replace function public.admin_import_menu(p_plan jsonb, p_archive_missing boolean, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cat record;
  prod record;
  v_category uuid;
  v_product uuid;
  existing public.products;
  group_ids uuid[];
  groups jsonb;
  categories_created integer := 0;
  categories_updated integer := 0;
  products_created integer := 0;
  products_updated integer := 0;
  products_archived integer := 0;
  next_category_sort integer;
  slugs text[];
  summary jsonb;
begin
  perform public.assert_admin();
  if jsonb_typeof(p_plan -> 'products') <> 'array' or jsonb_array_length(p_plan -> 'products') > 1000 then
    raise exception 'An import can hold up to 1,000 products' using errcode = 'invalid_parameter_value';
  end if;

  perform set_config('app.audit_suppress', 'on', true);

  select coalesce(max(sort_order) + 10, 0) into next_category_sort from public.categories;
  for cat in
    select btrim(c ->> 'slug') as slug, btrim(c ->> 'name') as name, nullif(btrim(coalesce(c ->> 'description', '')), '') as description
      from jsonb_array_elements(coalesce(p_plan -> 'categories', '[]'::jsonb)) c
  loop
    if not public.is_valid_slug(cat.slug) or char_length(coalesce(cat.name, '')) not between 1 and 60 then
      raise exception 'Category "%": check its name', cat.name using errcode = 'invalid_parameter_value';
    end if;
    select id into v_category from public.categories where slug = cat.slug;
    if not found then
      insert into public.categories (name, slug, description, sort_order)
      values (cat.name, cat.slug, cat.description, next_category_sort);
      next_category_sort := next_category_sort + 10;
      categories_created := categories_created + 1;
    else
      update public.categories
         set name = cat.name, description = coalesce(cat.description, description)
       where id = v_category and (name is distinct from cat.name or (cat.description is not null and description is distinct from cat.description));
      if found then
        categories_updated := categories_updated + 1;
      end if;
    end if;
  end loop;

  for prod in
    select p, (n - 1)::integer * 10 as sort_order
      from jsonb_array_elements(p_plan -> 'products') with ordinality as t(p, n)
  loop
    select id into v_category from public.categories where slug = btrim(prod.p ->> 'category_slug');
    if not found then
      raise exception 'Product "%": unknown category', prod.p ->> 'name' using errcode = 'invalid_parameter_value';
    end if;

    group_ids := array(
      select g.id
        from jsonb_array_elements(coalesce(prod.p -> 'groups', '[]'::jsonb)) with ordinality as x(item, n)
        join public.modifier_groups g on g.slug = coalesce(x.item ->> 'slug', x.item #>> '{}') and g.archived_at is null
       order by x.n
    );
    if cardinality(group_ids) <> jsonb_array_length(coalesce(prod.p -> 'groups', '[]'::jsonb)) then
      raise exception 'Product "%": unknown modifier group', prod.p ->> 'name' using errcode = 'invalid_parameter_value';
    end if;

    existing := null;
    select * into existing from public.products where slug = btrim(prod.p ->> 'slug') for update;
    if existing.id is not null and existing.archived_at is not null then
      -- Back in the file: back on the menu (as the file says).
      update public.products set archived_at = null where id = existing.id;
    end if;

    v_product := public.write_product(
      existing.id,
      (prod.p - 'category_slug' - 'sizes' - 'groups')
        || jsonb_build_object('category_id', v_category, 'sort_order', prod.sort_order)
    );
    if existing.id is null then
      products_created := products_created + 1;
    else
      products_updated := products_updated + 1;
    end if;

    perform public.write_product_sizes(v_product, coalesce(prod.p -> 'sizes', '[]'::jsonb));

    -- A condition from the file ("ice-level if Iced") wins; otherwise each
    -- surviving link keeps its condition if that option is still on the product.
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'group_id', g.id,
               'visible_when_option_id', case
                 when jsonb_typeof(x.item) = 'object' then nullif(x.item ->> 'visible_when_option_id', '')::uuid
                 else (
                   select l.visible_when_option_id
                     from public.product_modifier_groups l
                     join public.modifier_options o on o.id = l.visible_when_option_id
                    where l.product_id = v_product and l.modifier_group_id = g.id
                      and o.modifier_group_id = any (group_ids) and o.modifier_group_id <> g.id
                 )
               end
             ) order by x.n), '[]'::jsonb)
      into groups
      from jsonb_array_elements(coalesce(prod.p -> 'groups', '[]'::jsonb)) with ordinality as x(item, n)
      join public.modifier_groups g on g.slug = coalesce(x.item ->> 'slug', x.item #>> '{}') and g.archived_at is null;
    perform public.write_product_groups(v_product, groups);
  end loop;

  if p_archive_missing then
    slugs := array(select btrim(p ->> 'slug') from jsonb_array_elements(p_plan -> 'products') p);
    update public.products
       set is_active = false, archived_at = now()
     where archived_at is null and not (slug = any (slugs));
    get diagnostics products_archived = row_count;
  end if;

  perform set_config('app.audit_suppress', 'off', true);

  summary := jsonb_build_object(
    'categories_created', categories_created,
    'categories_updated', categories_updated,
    'products_created', products_created,
    'products_updated', products_updated,
    'products_archived', products_archived,
    'archive_missing', coalesce(p_archive_missing, false)
  );
  perform public.audit_log_entry(
    'products', null, left(coalesce(nullif(btrim(p_source), ''), 'Menu import'), 120), 'import',
    format('Menu import: %s product(s) created, %s matched and updated, %s archived; %s categor(ies) created, %s updated.',
           products_created, products_updated, products_archived, categories_created, categories_updated),
    summary
  );
  return summary;
end;
$$;

-- ----------------------------------------------------------------------------
-- Grants.
-- ----------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.admin_save_category(jsonb)',
    'public.admin_reorder_categories(uuid[])',
    'public.admin_delete_category(uuid)',
    'public.admin_save_product(jsonb, jsonb, jsonb)',
    'public.admin_set_product_active(uuid, boolean)',
    'public.admin_archive_product(uuid)',
    'public.admin_restore_product(uuid)',
    'public.admin_delete_product(uuid)',
    'public.admin_reorder_products(uuid[])',
    'public.admin_save_modifier_group(jsonb, jsonb)',
    'public.admin_archive_modifier_group(uuid)',
    'public.admin_restore_modifier_group(uuid)',
    'public.admin_delete_modifier_group(uuid)',
    'public.admin_import_menu(jsonb, boolean, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;

comment on function public.admin_save_product is
  'Admin: create or update a product with its sizes and modifier groups, in one transaction.';
comment on function public.admin_import_menu is
  'Admin: apply a checked menu import (match by slug, never delete, optionally archive missing), all or nothing, one audit entry.';
