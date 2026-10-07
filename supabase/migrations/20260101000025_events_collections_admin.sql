-- ============================================================================
-- Phase 8: pop-up events, seasonal collections, limited-time products and
-- the admin tools that manage them.
--
--   created_by / updated_by  on everything admins create or change here,
--                            stamped by trigger from the signed-in admin
--   products                 optional availability window
--                            (available_from / available_until)
--   locations                events are published or not; unpublished
--                            events are invisible to customers. A map link,
--                            and at most 24 hours per event row (a
--                            multi-day market is one row per day)
--   event publishing         an event needs at least one menu item to be
--                            published (checked at commit)
--   collections              accent colours are hex only; slugs are URL-safe
--   storage                  JPEG / PNG / WebP up to 5 MB; admins write;
--                            listing limited to images published content uses
--   admin functions          save / publish / duplicate an event, save a
--                            collection, each in one transaction
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Who created and last changed a row. The signed-in user (auth.uid()); a
-- service-role caller may set the column itself.
-- ----------------------------------------------------------------------------
create or replace function public.stamp_created_updated_by()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_by := coalesce(new.updated_by, new.created_by);
  else
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  return new;
end;
$$;

create or replace function public.stamp_updated_by()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

create or replace function public.stamp_created_by()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end;
$$;

alter table public.locations
  add column created_by uuid references public.profiles (id) on delete set null,
  add column updated_by uuid references public.profiles (id) on delete set null;
alter table public.collections
  add column created_by uuid references public.profiles (id) on delete set null,
  add column updated_by uuid references public.profiles (id) on delete set null;
alter table public.products
  add column updated_by uuid references public.profiles (id) on delete set null;
alter table public.event_menu_items
  add column created_by uuid references public.profiles (id) on delete set null;
alter table public.collection_products
  add column created_by uuid references public.profiles (id) on delete set null;
alter table public.staff_locations
  add column created_by uuid references public.profiles (id) on delete set null;

create trigger locations_stamp_actor before insert or update on public.locations
  for each row execute function public.stamp_created_updated_by();
create trigger collections_stamp_actor before insert or update on public.collections
  for each row execute function public.stamp_created_updated_by();
create trigger products_stamp_actor before update on public.products
  for each row execute function public.stamp_updated_by();
create trigger event_menu_items_stamp_actor before insert on public.event_menu_items
  for each row execute function public.stamp_created_by();
create trigger collection_products_stamp_actor before insert on public.collection_products
  for each row execute function public.stamp_created_by();
create trigger staff_locations_stamp_actor before insert on public.staff_locations
  for each row execute function public.stamp_created_by();

-- ----------------------------------------------------------------------------
-- Limited-time products. Outside the window a product is off the menu
-- everywhere availability is checked (menu, cart, checkout, reorder,
-- favourites, the staff sold-out list): isProductAvailableAt() in
-- src/lib/menu/availability-window.ts. Null = no limit on that side.
-- ----------------------------------------------------------------------------
alter table public.products
  add column available_from timestamptz,
  add column available_until timestamptz,
  add constraint products_availability_window_ordered check (
    available_from is null or available_until is null or available_until > available_from
  );

comment on column public.products.available_from is 'Limited-time products: on the menu from this instant (null = no start).';
comment on column public.products.available_until is 'Limited-time products: off the menu from this instant (null = no end).';

-- ----------------------------------------------------------------------------
-- Events: published or not, a map link, one row per day.
-- ----------------------------------------------------------------------------
alter table public.locations
  add column is_published boolean not null default false,
  -- A Google or Apple Maps link the admin pastes; https only.
  add column map_url text check (map_url is null or (map_url ~* '^https://' and char_length(map_url) <= 500)),
  -- Multi-day markets are one row per day ("Duplicate to another date"),
  -- never one window running through the nights.
  add constraint locations_event_one_day check (type <> 'event' or ends_at - starts_at <= interval '24 hours');

-- Everything that exists already was visible; keep it that way.
update public.locations set is_published = true;

comment on column public.locations.is_published is
  'Events only: false hides the event from customers (menu, location switcher, /events). The cafe ignores it.';

-- Customers see the cafe and published events; staff and admins see all.
drop policy if exists locations_public_read on public.locations;
create policy locations_public_read on public.locations
  for select to anon, authenticated
  using ((is_active and (type = 'cafe' or is_published)) or public.is_staff());

drop policy if exists event_menu_items_public_read on public.event_menu_items;
create policy event_menu_items_public_read on public.event_menu_items
  for select to anon, authenticated
  using (
    public.is_staff()
    or exists (
      select 1 from public.locations l
       where l.id = event_menu_items.location_id and l.is_active and (l.type = 'cafe' or l.is_published)
    )
  );

-- A published event always has a menu. Checked at commit, so saving an event
-- and its menu in one transaction (or replacing the menu) works.
create or replace function public.check_event_publishable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  target uuid;
begin
  -- Separate statements: PL/pgSQL plans each one against the row type of
  -- the table that fired, so OLD.location_id may only be read for
  -- event_menu_items.
  if tg_table_name = 'locations' then
    target := new.id;
  else
    target := old.location_id;
  end if;

  if exists (
    select 1 from public.locations l
     where l.id = target and l.type = 'event' and l.is_published
       and not exists (select 1 from public.event_menu_items m where m.location_id = l.id)
  ) then
    raise exception 'An event needs at least one menu item before it can be published'
      using errcode = 'DC020';
  end if;
  return null;
end;
$$;

create constraint trigger locations_event_publishable
  after insert or update of is_published on public.locations
  deferrable initially deferred
  for each row execute function public.check_event_publishable();

create constraint trigger event_menu_items_keep_published_menu
  after delete on public.event_menu_items
  deferrable initially deferred
  for each row execute function public.check_event_publishable();

-- ----------------------------------------------------------------------------
-- Collections: plain hex accents (they end up in inline styles; the app also
-- re-checks with safeCssColor) and URL-safe slugs.
-- ----------------------------------------------------------------------------
alter table public.collections
  add constraint collections_accent_hex check (accent_color is null or accent_color ~* '^#[0-9a-f]{6}$'),
  add constraint collections_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80);

-- ----------------------------------------------------------------------------
-- Admin: save an event (create or update), its menu and its staff, in one
-- transaction. Publishing is separate (admin_set_event_published).
--
-- p_event: id (null to create), name, slug, description, address_line1,
--   address_line2, city, state, postal_code, latitude, longitude, map_url,
--   starts_at, ends_at, prep_time_minutes, image_url, pickup_instructions
-- p_menu:  product ids, in menu order
-- p_staff: staff profile ids to roster at this event
-- ----------------------------------------------------------------------------
create or replace function public.admin_save_event(p_event jsonb, p_menu uuid[], p_staff uuid[])
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  event_id uuid := nullif(p_event ->> 'id', '')::uuid;
  starts timestamptz := (p_event ->> 'starts_at')::timestamptz;
  ends timestamptz := (p_event ->> 'ends_at')::timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can manage events' using errcode = 'insufficient_privilege';
  end if;
  if starts is null or ends is null or ends <= starts then
    raise exception 'An event must end after it starts' using errcode = 'invalid_parameter_value';
  end if;
  if ends - starts > interval '24 hours' then
    raise exception 'One event row covers one day; duplicate it for another date' using errcode = 'invalid_parameter_value';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_staff, '{}')) s(id)
     where not exists (select 1 from public.profiles p where p.id = s.id and p.role = 'staff' and p.deleted_at is null)
  ) then
    raise exception 'Only staff accounts can be rostered at an event' using errcode = 'invalid_parameter_value';
  end if;

  if event_id is null then
    insert into public.locations (
      type, name, slug, description, address_line1, address_line2, city, state, postal_code,
      latitude, longitude, map_url, starts_at, ends_at, prep_time_minutes, image_url, pickup_instructions,
      is_published, sort_order
    )
    values (
      'event',
      trim(p_event ->> 'name'),
      p_event ->> 'slug',
      nullif(trim(p_event ->> 'description'), ''),
      nullif(trim(p_event ->> 'address_line1'), ''),
      nullif(trim(p_event ->> 'address_line2'), ''),
      coalesce(nullif(trim(p_event ->> 'city'), ''), 'Honolulu'),
      coalesce(nullif(trim(p_event ->> 'state'), ''), 'HI'),
      nullif(trim(p_event ->> 'postal_code'), ''),
      nullif(p_event ->> 'latitude', '')::numeric,
      nullif(p_event ->> 'longitude', '')::numeric,
      nullif(trim(p_event ->> 'map_url'), ''),
      starts, ends,
      coalesce(nullif(p_event ->> 'prep_time_minutes', '')::integer, 10),
      nullif(p_event ->> 'image_url', ''),
      nullif(trim(p_event ->> 'pickup_instructions'), ''),
      false,
      10
    )
    returning id into event_id;
  else
    update public.locations
       set name = trim(p_event ->> 'name'),
           slug = p_event ->> 'slug',
           description = nullif(trim(p_event ->> 'description'), ''),
           address_line1 = nullif(trim(p_event ->> 'address_line1'), ''),
           address_line2 = nullif(trim(p_event ->> 'address_line2'), ''),
           city = coalesce(nullif(trim(p_event ->> 'city'), ''), 'Honolulu'),
           state = coalesce(nullif(trim(p_event ->> 'state'), ''), 'HI'),
           postal_code = nullif(trim(p_event ->> 'postal_code'), ''),
           latitude = nullif(p_event ->> 'latitude', '')::numeric,
           longitude = nullif(p_event ->> 'longitude', '')::numeric,
           map_url = nullif(trim(p_event ->> 'map_url'), ''),
           starts_at = starts,
           ends_at = ends,
           prep_time_minutes = coalesce(nullif(p_event ->> 'prep_time_minutes', '')::integer, prep_time_minutes),
           image_url = nullif(p_event ->> 'image_url', ''),
           pickup_instructions = nullif(trim(p_event ->> 'pickup_instructions'), '')
     where id = event_id and type = 'event';
    if not found then
      raise exception 'Event not found' using errcode = 'no_data_found';
    end if;
  end if;

  -- The menu, replaced in order. (A published event left with no menu fails
  -- at commit.)
  delete from public.event_menu_items
   where location_id = event_id and not (product_id = any (coalesce(p_menu, '{}')));
  insert into public.event_menu_items (location_id, product_id, sort_order)
  select event_id, m.id, (m.n - 1)::integer * 10
    from unnest(coalesce(p_menu, '{}')) with ordinality as m(id, n)
  on conflict (location_id, product_id) do update set sort_order = excluded.sort_order;

  -- The roster.
  delete from public.staff_locations
   where location_id = event_id and not (profile_id = any (coalesce(p_staff, '{}')));
  insert into public.staff_locations (profile_id, location_id)
  select s.id, event_id from unnest(coalesce(p_staff, '{}')) s(id)
  on conflict (profile_id, location_id) do nothing;

  return event_id;
end;
$$;

revoke execute on function public.admin_save_event(jsonb, uuid[], uuid[]) from public, anon;
grant execute on function public.admin_save_event(jsonb, uuid[], uuid[]) to authenticated;

create or replace function public.admin_set_event_published(p_event_id uuid, p_published boolean)
returns public.locations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated public.locations;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can publish events' using errcode = 'insufficient_privilege';
  end if;
  if p_published and not exists (select 1 from public.event_menu_items where location_id = p_event_id) then
    raise exception 'Add at least one menu item before publishing' using errcode = 'DC020';
  end if;
  update public.locations
     set is_published = p_published
   where id = p_event_id and type = 'event'
  returning * into updated;
  if not found then
    raise exception 'Event not found' using errcode = 'no_data_found';
  end if;
  return updated;
end;
$$;

revoke execute on function public.admin_set_event_published(uuid, boolean) from public, anon;
grant execute on function public.admin_set_event_published(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- Admin: duplicate an event to another Honolulu date, keeping its wall-clock
-- times (a 10:00-15:00 market stays 10:00-15:00), length, menu, staff and
-- everything else. The copy starts unpublished, with a slug for its date.
-- ----------------------------------------------------------------------------
create or replace function public.admin_duplicate_event(p_event_id uuid, p_date date)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source public.locations;
  new_start timestamptz;
  base_slug text;
  candidate text;
  n integer := 1;
  new_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can manage events' using errcode = 'insufficient_privilege';
  end if;
  select * into source from public.locations where id = p_event_id and type = 'event';
  if not found then
    raise exception 'Event not found' using errcode = 'no_data_found';
  end if;
  if p_date is null then
    raise exception 'Pick a date' using errcode = 'invalid_parameter_value';
  end if;

  new_start := (p_date + (source.starts_at at time zone 'Pacific/Honolulu')::time) at time zone 'Pacific/Honolulu';

  -- "kakaako-market-2026-10-18" -> "kakaako-market", then the new date.
  base_slug := left(regexp_replace(source.slug, '-\d{4}-\d{2}-\d{2}(-\d+)?$', ''), 60) || '-' || to_char(p_date, 'YYYY-MM-DD');
  candidate := base_slug;
  while exists (select 1 from public.locations where slug = candidate) loop
    n := n + 1;
    candidate := base_slug || '-' || n;
  end loop;

  insert into public.locations (
    type, name, slug, description, address_line1, address_line2, city, state, postal_code,
    latitude, longitude, phone, map_url, pickup_instructions, prep_time_minutes, timezone, image_url,
    sort_order, is_active, accepting_orders, starts_at, ends_at, is_published
  )
  values (
    'event', source.name, candidate, source.description, source.address_line1, source.address_line2, source.city,
    source.state, source.postal_code, source.latitude, source.longitude, source.phone, source.map_url,
    source.pickup_instructions, source.prep_time_minutes, source.timezone, source.image_url,
    source.sort_order, true, true, new_start, new_start + (source.ends_at - source.starts_at), false
  )
  returning id into new_id;

  insert into public.event_menu_items (location_id, product_id, sort_order)
  select new_id, product_id, sort_order from public.event_menu_items where location_id = source.id;

  insert into public.staff_locations (profile_id, location_id)
  select profile_id, new_id from public.staff_locations where location_id = source.id;

  return new_id;
end;
$$;

revoke execute on function public.admin_duplicate_event(uuid, date) from public, anon;
grant execute on function public.admin_duplicate_event(uuid, date) to authenticated;

-- ----------------------------------------------------------------------------
-- Admin: save a collection (create or update) and its products, in order.
--
-- p_collection: id (null to create), name, slug, description,
--   banner_image_url, accent_color, starts_at, ends_at, is_active
-- p_products: [{product_id, limited}] in display order. `limited` = sell the
--   product only while this collection runs: its availability window is set
--   to the collection's. Unticking it clears a window that still matches
--   this collection's (one set some other way is left alone).
-- ----------------------------------------------------------------------------
create or replace function public.admin_save_collection(p_collection jsonb, p_products jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_collection_id uuid := nullif(p_collection ->> 'id', '')::uuid;
  starts timestamptz := (p_collection ->> 'starts_at')::timestamptz;
  ends timestamptz := (p_collection ->> 'ends_at')::timestamptz;
  old_starts timestamptz;
  old_ends timestamptz;
  item record;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can manage collections' using errcode = 'insufficient_privilege';
  end if;
  if starts is null or ends is null or ends <= starts then
    raise exception 'A collection must end after it starts' using errcode = 'invalid_parameter_value';
  end if;

  if v_collection_id is null then
    insert into public.collections (name, slug, description, banner_image_url, accent_color, starts_at, ends_at, is_active)
    values (
      trim(p_collection ->> 'name'),
      p_collection ->> 'slug',
      nullif(trim(p_collection ->> 'description'), ''),
      nullif(p_collection ->> 'banner_image_url', ''),
      nullif(p_collection ->> 'accent_color', ''),
      starts, ends,
      coalesce((p_collection ->> 'is_active')::boolean, true)
    )
    returning id into v_collection_id;
  else
    select starts_at, ends_at into old_starts, old_ends from public.collections where id = v_collection_id for update;
    if not found then
      raise exception 'Collection not found' using errcode = 'no_data_found';
    end if;
    update public.collections
       set name = trim(p_collection ->> 'name'),
           slug = p_collection ->> 'slug',
           description = nullif(trim(p_collection ->> 'description'), ''),
           banner_image_url = nullif(p_collection ->> 'banner_image_url', ''),
           accent_color = nullif(p_collection ->> 'accent_color', ''),
           starts_at = starts,
           ends_at = ends,
           is_active = coalesce((p_collection ->> 'is_active')::boolean, is_active)
     where id = v_collection_id;
  end if;

  delete from public.collection_products
   where collection_products.collection_id = v_collection_id
     and product_id not in (select (x ->> 'product_id')::uuid from jsonb_array_elements(coalesce(p_products, '[]'::jsonb)) x);

  for item in
    select (x ->> 'product_id')::uuid as product_id, coalesce((x ->> 'limited')::boolean, false) as limited, n
      from jsonb_array_elements(coalesce(p_products, '[]'::jsonb)) with ordinality as t(x, n)
  loop
    insert into public.collection_products (collection_id, product_id, sort_order)
    values (v_collection_id, item.product_id, (item.n - 1)::integer * 10)
    on conflict on constraint collection_products_pkey do update set sort_order = excluded.sort_order;

    if item.limited then
      update public.products set available_from = starts, available_until = ends where id = item.product_id;
    else
      update public.products
         set available_from = null, available_until = null
       where id = item.product_id
         and available_from is not distinct from coalesce(old_starts, starts)
         and available_until is not distinct from coalesce(old_ends, ends);
    end if;
  end loop;

  return v_collection_id;
end;
$$;

revoke execute on function public.admin_save_collection(jsonb, jsonb) from public, anon;
grant execute on function public.admin_save_collection(jsonb, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- Storage.
--
-- Uploads: JPEG, PNG or WebP up to 5 MB (also checked, and re-encoded
-- without metadata, by the upload action), written only by admins.
--
-- Reading: the buckets stay public, so a published image loads from its URL
-- without a session (next/image needs that). Public buckets serve any
-- object to whoever has its exact URL, which RLS cannot change; uploads get
-- random names, so a draft's image is not guessable. What RLS does decide
-- is listing and searching a bucket through the API: guests and customers
-- may see only images that published content uses, admins everything.
-- ----------------------------------------------------------------------------
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'],
       file_size_limit = 5242880
 where id in ('product-images', 'collection-banners', 'location-images');

drop policy if exists "Brand images are publicly readable" on storage.objects;

create policy "Published images are readable"
  on storage.objects for select to anon, authenticated
  using (
    (bucket_id in ('product-images', 'collection-banners', 'location-images') and public.is_admin())
    or (
      bucket_id = 'product-images'
      and exists (select 1 from public.products p where p.image_url = storage.objects.name and p.is_active)
    )
    or (
      bucket_id = 'collection-banners'
      and exists (
        select 1 from public.collections c
         where c.banner_image_url = storage.objects.name and c.is_active and c.starts_at <= now()
      )
    )
    or (
      bucket_id = 'location-images'
      and exists (
        select 1 from public.locations l
         where l.image_url = storage.objects.name and l.is_active and (l.type = 'cafe' or l.is_published)
      )
    )
  );

comment on function public.admin_save_event is
  'Admin: create or update a pop-up event with its menu and staff roster, in one transaction.';
comment on function public.admin_duplicate_event is
  'Admin: copy an event to another Honolulu date (same wall-clock times), unpublished.';
comment on function public.admin_save_collection is
  'Admin: create or update a seasonal collection and its products; ticked products sell only during it.';
