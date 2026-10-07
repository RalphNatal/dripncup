-- ============================================================================
-- Phase 9: running the cafe from /admin.
--
--   locations      the cafe's details, weekly hours (several ranges a day),
--                  closures and holiday hours
--   settings       typed, range-checked updates; owner confirmation
--   site content   About, contact, social links, logo, policies
--   promotions     create and edit; once a code has been redeemed its code
--                  and discount are locked (DC040)
--   rewards        tiers, their order, programme totals
--   users          role changes (never your own, never the last admin;
--                  demoting staff clears their rosters), staff rosters,
--                  search
--   orders         search, resend a receipt
--   attention      everything that needs a person: payments that did not
--                  match, failed refunds, failed emails, new catering,
--                  unpaid orders stuck past expiry; and how each is resolved
--
-- Every function here checks the caller is an admin (42501 otherwise) and
-- runs as them, so the audit log names them.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Locations.
-- ----------------------------------------------------------------------------

-- The cafe's own details (pop-up events are saved by admin_save_event).
-- p: id, name, description, address_line1, address_line2, city, state,
--    postal_code, phone, map_url, latitude, longitude, pickup_instructions,
--    prep_time_minutes, image_url
create or replace function public.admin_save_cafe(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_name text := btrim(coalesce(p ->> 'name', ''));
  v_postal text := nullif(btrim(coalesce(p ->> 'postal_code', '')), '');
  v_map text := nullif(btrim(coalesce(p ->> 'map_url', '')), '');
  v_prep integer := coalesce(nullif(p ->> 'prep_time_minutes', '')::integer, -1);
begin
  perform public.assert_admin();
  if char_length(v_name) not between 2 and 80 then
    raise exception 'Give the cafe a name of 2 to 80 characters' using errcode = 'invalid_parameter_value';
  end if;
  if v_postal is not null and v_postal !~ '^[0-9]{5}$' then
    raise exception 'Enter a 5-digit ZIP code' using errcode = 'invalid_parameter_value';
  end if;
  if v_map is not null and (v_map !~* '^https://\S+$' or char_length(v_map) > 500) then
    raise exception 'Paste a full https:// map link' using errcode = 'invalid_parameter_value';
  end if;
  if v_prep not between 0 and 240 then
    raise exception 'Prep time must be between 0 and 240 minutes' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(coalesce(p ->> 'pickup_instructions', '')) > 300
     or char_length(coalesce(p ->> 'description', '')) > 500
     or char_length(coalesce(p ->> 'address_line1', '')) > 120
     or char_length(coalesce(p ->> 'address_line2', '')) > 120
     or char_length(coalesce(p ->> 'phone', '')) > 32 then
    raise exception 'One of the fields is too long' using errcode = 'invalid_parameter_value';
  end if;

  update public.locations
     set name = v_name,
         description = nullif(btrim(coalesce(p ->> 'description', '')), ''),
         address_line1 = nullif(btrim(coalesce(p ->> 'address_line1', '')), ''),
         address_line2 = nullif(btrim(coalesce(p ->> 'address_line2', '')), ''),
         city = coalesce(nullif(btrim(coalesce(p ->> 'city', '')), ''), 'Honolulu'),
         state = coalesce(nullif(btrim(coalesce(p ->> 'state', '')), ''), 'HI'),
         postal_code = v_postal,
         phone = nullif(btrim(coalesce(p ->> 'phone', '')), ''),
         map_url = v_map,
         latitude = nullif(p ->> 'latitude', '')::numeric,
         longitude = nullif(p ->> 'longitude', '')::numeric,
         pickup_instructions = nullif(btrim(coalesce(p ->> 'pickup_instructions', '')), ''),
         prep_time_minutes = v_prep,
         image_url = case when p ? 'image_url' then nullif(p ->> 'image_url', '') else image_url end
   where id = v_id and type = 'cafe';
  if not found then
    raise exception 'Cafe not found' using errcode = 'no_data_found';
  end if;
  return v_id;
end;
$$;

-- Weekly hours: the whole week at once. p_hours: [{day_of_week, opens_at,
-- closes_at}] ("07:00", "18:00"; "24:00" closes at midnight). A day with no
-- rows is closed. Ranges on one day may touch (they merge) but not overlap.
create or replace function public.admin_save_location_hours(p_location_id uuid, p_hours jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  hours jsonb := coalesce(p_hours, '[]'::jsonb);
  bad record;
begin
  perform public.assert_admin();
  if not exists (select 1 from public.locations where id = p_location_id and type = 'cafe') then
    raise exception 'Weekly hours are for the cafe; pop-ups have their own window' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(hours) <> 'array' or jsonb_array_length(hours) > 42 then
    raise exception 'Up to 6 time ranges a day' using errcode = 'invalid_parameter_value';
  end if;
  if exists (
    select 1 from jsonb_array_elements(hours) h
     where coalesce((h ->> 'day_of_week')::integer, -1) not between 0 and 6
        or coalesce(h ->> 'opens_at', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$'
        or coalesce(h ->> 'closes_at', '') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)(:00)?$'
        or (h ->> 'closes_at')::time <= (h ->> 'opens_at')::time
  ) then
    raise exception 'Each range needs an opening time before its closing time' using errcode = 'invalid_parameter_value';
  end if;
  if exists (
    select 1 from jsonb_array_elements(hours) h group by (h ->> 'day_of_week') having count(*) > 6
  ) then
    raise exception 'Up to 6 time ranges a day' using errcode = 'invalid_parameter_value';
  end if;

  select a.day into bad
    from (select (h ->> 'day_of_week')::integer as day, (h ->> 'opens_at')::time as opens, (h ->> 'closes_at')::time as closes
            from jsonb_array_elements(hours) h) a
    join (select (h ->> 'day_of_week')::integer as day, (h ->> 'opens_at')::time as opens, (h ->> 'closes_at')::time as closes
            from jsonb_array_elements(hours) with ordinality as t(h, n)) b
      on a.day = b.day and (a.opens, a.closes) <> (b.opens, b.closes) and a.opens < b.closes and b.opens < a.closes
   limit 1;
  if found then
    raise exception 'Two ranges on the same day overlap' using errcode = 'invalid_parameter_value';
  end if;
  if exists (
    select 1 from jsonb_array_elements(hours) h
     group by h ->> 'day_of_week', h ->> 'opens_at', h ->> 'closes_at' having count(*) > 1
  ) then
    raise exception 'Two ranges on the same day overlap' using errcode = 'invalid_parameter_value';
  end if;

  delete from public.location_hours where location_id = p_location_id;
  insert into public.location_hours (location_id, day_of_week, opens_at, closes_at)
  select p_location_id, (h ->> 'day_of_week')::smallint, (h ->> 'opens_at')::time, (h ->> 'closes_at')::time
    from jsonb_array_elements(hours) h;
end;
$$;

-- A closure or holiday hours for one Honolulu date.
-- p: id (null to create), location_id (null = every location), closure_date,
--    is_closed, opens_at, closes_at, reason
create or replace function public.admin_save_closure(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_date date := (p ->> 'closure_date')::date;
  v_closed boolean := coalesce((p ->> 'is_closed')::boolean, true);
  v_opens time := case when v_closed then null else nullif(p ->> 'opens_at', '')::time end;
  v_closes time := case when v_closed then null else nullif(p ->> 'closes_at', '')::time end;
  v_reason text := nullif(btrim(coalesce(p ->> 'reason', '')), '');
  v_location uuid := nullif(p ->> 'location_id', '')::uuid;
begin
  perform public.assert_admin();
  if v_date is null then
    raise exception 'Pick a date' using errcode = 'invalid_parameter_value';
  end if;
  if v_id is null and v_date < public.cafe_today() then
    raise exception 'That date has already passed' using errcode = 'invalid_parameter_value';
  end if;
  if not v_closed and (v_opens is null or v_closes is null or v_closes <= v_opens) then
    raise exception 'Holiday hours need an opening time before the closing time' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(coalesce(v_reason, '')) > 200 then
    raise exception 'Keep the reason to 200 characters' using errcode = 'invalid_parameter_value';
  end if;
  if v_location is not null and not exists (select 1 from public.locations where id = v_location) then
    raise exception 'Location not found' using errcode = 'invalid_parameter_value';
  end if;

  if v_id is null then
    insert into public.closures (location_id, closure_date, is_closed, opens_at, closes_at, reason)
    values (v_location, v_date, v_closed, v_opens, v_closes, v_reason)
    returning id into v_id;
  else
    update public.closures
       set location_id = v_location, closure_date = v_date, is_closed = v_closed,
           opens_at = v_opens, closes_at = v_closes, reason = v_reason
     where id = v_id;
    if not found then
      raise exception 'Closure not found' using errcode = 'no_data_found';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_delete_closure(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_admin();
  delete from public.closures where id = p_id;
  if not found then
    raise exception 'Closure not found' using errcode = 'no_data_found';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Settings: one typed, range-checked update. The type and limits are on the
-- row (see 20260101000026); the friendly checks run first on the server
-- (src/lib/settings/registry.ts), these are the ones nobody can skip.
-- ----------------------------------------------------------------------------
create or replace function public.admin_update_setting(p_key text, p_value jsonb)
returns public.settings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.settings;
  n numeric;
  t text;
  ok boolean;
begin
  perform public.assert_admin();
  select * into s from public.settings where key = p_key for update;
  if not found or s.value_type is null then
    raise exception 'Unknown setting' using errcode = 'invalid_parameter_value';
  end if;

  ok := case s.value_type
    when 'boolean' then jsonb_typeof(p_value) = 'boolean'
    when 'integer' then jsonb_typeof(p_value) = 'number'
    when 'number' then jsonb_typeof(p_value) = 'number'
    when 'text' then jsonb_typeof(p_value) = 'string'
    when 'email' then jsonb_typeof(p_value) = 'string'
    when 'number_list' then jsonb_typeof(p_value) = 'array'
    when 'zip_list' then jsonb_typeof(p_value) = 'array'
    else false
  end;
  if not ok then
    raise exception 'That is the wrong kind of value for this setting' using errcode = 'invalid_parameter_value';
  end if;

  if s.value_type in ('integer', 'number') then
    n := (p_value #>> '{}')::numeric;
    if s.value_type = 'integer' and n <> trunc(n) then
      raise exception 'Use a whole number' using errcode = 'invalid_parameter_value';
    end if;
    if (s.min_value is not null and n < s.min_value) or (s.max_value is not null and n > s.max_value) then
      raise exception 'Use a value between % and %', s.min_value, s.max_value using errcode = 'invalid_parameter_value';
    end if;
  elsif s.value_type in ('text', 'email') then
    t := p_value #>> '{}';
    if char_length(t) < coalesce(s.min_value, 0) or char_length(t) > coalesce(s.max_value, 10000) then
      raise exception 'Use between % and % characters', coalesce(s.min_value, 0), coalesce(s.max_value, 10000)
        using errcode = 'invalid_parameter_value';
    end if;
    if s.value_type = 'email' and t <> '' and t !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then
      raise exception 'Enter a valid email address' using errcode = 'invalid_parameter_value';
    end if;
  elsif s.value_type = 'number_list' then
    if jsonb_array_length(p_value) not between 1 and 10
       or exists (
         select 1 from jsonb_array_elements(p_value) x
          where jsonb_typeof(x) <> 'number'
             or (s.min_value is not null and (x #>> '{}')::numeric < s.min_value)
             or (s.max_value is not null and (x #>> '{}')::numeric > s.max_value)
       )
       or (select count(distinct x) from jsonb_array_elements(p_value) x) <> jsonb_array_length(p_value) then
      raise exception 'Use 1 to 10 different numbers between % and %', s.min_value, s.max_value
        using errcode = 'invalid_parameter_value';
    end if;
  elsif s.value_type = 'zip_list' then
    if jsonb_array_length(p_value) > 500
       or exists (select 1 from jsonb_array_elements(p_value) x where jsonb_typeof(x) <> 'string' or (x #>> '{}') !~ '^[0-9]{5}$') then
      raise exception 'Use 5-digit ZIP codes' using errcode = 'invalid_parameter_value';
    end if;
  end if;

  update public.settings
     set value = p_value, updated_by = auth.uid()
   where key = p_key
  returning * into s;
  return s;
end;
$$;

-- Owner confirmation on the setup checklist. p_kind: setting | content | task.
create or replace function public.admin_set_confirmed(p_kind text, p_key text, p_confirmed boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  stamp timestamptz := case when p_confirmed then now() end;
  who uuid := case when p_confirmed then auth.uid() end;
begin
  perform public.assert_admin();
  if p_kind = 'setting' then
    update public.settings set confirmed_at = stamp, confirmed_by = who where key = p_key;
  elsif p_kind = 'content' then
    update public.site_content set confirmed_at = stamp, confirmed_by = who where key = p_key;
  elsif p_kind = 'task' then
    update public.setup_tasks set confirmed_at = stamp, confirmed_by = who where key = p_key;
  else
    raise exception 'Unknown checklist item' using errcode = 'invalid_parameter_value';
  end if;
  if not found then
    raise exception 'Unknown checklist item' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Site content.
-- ----------------------------------------------------------------------------
create or replace function public.admin_save_content(p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v text := btrim(coalesce(p_value, ''));
begin
  perform public.assert_admin();
  if not exists (select 1 from public.site_content where key = p_key) then
    raise exception 'Unknown content' using errcode = 'invalid_parameter_value';
  end if;
  if p_key = 'contact_email' and v <> '' and (v !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' or char_length(v) > 254) then
    raise exception 'Enter a valid email address' using errcode = 'invalid_parameter_value';
  end if;
  if p_key = 'contact_phone' and v <> '' and v !~ '^\([2-9][0-9]{2}\) [2-9][0-9]{2}-[0-9]{4}$' then
    raise exception 'Enter a US phone number, like (808) 555-0123' using errcode = 'invalid_parameter_value';
  end if;
  if p_key = 'instagram_url' and v <> '' and v !~* '^https://(www\.)?instagram\.com/[A-Za-z0-9_.]+/?$' then
    raise exception 'Paste the Instagram profile link, like https://www.instagram.com/drincupcafe' using errcode = 'invalid_parameter_value';
  end if;
  if p_key = 'facebook_url' and v <> '' and v !~* '^https://(www\.|m\.)?facebook\.com/[A-Za-z0-9_.\-/]+$' then
    raise exception 'Paste the Facebook page link, like https://www.facebook.com/drincupcafe' using errcode = 'invalid_parameter_value';
  end if;
  if p_key = 'logo_path' and v <> '' and v !~ '^[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}\.(jpg|png|webp)$' then
    raise exception 'Upload the logo with the image uploader' using errcode = 'invalid_parameter_value';
  end if;
  if p_key in ('about', 'privacy_policy', 'terms') and (char_length(v) < 20 or char_length(v) > 20000) then
    raise exception 'Use between 20 and 20,000 characters' using errcode = 'invalid_parameter_value';
  end if;
  if p_key = 'refund_policy' and (char_length(v) < 20 or char_length(v) > 2000) then
    raise exception 'Use between 20 and 2,000 characters' using errcode = 'invalid_parameter_value';
  end if;

  update public.site_content set value = v, updated_by = auth.uid() where key = p_key and value is distinct from v;
end;
$$;

-- The logo is public wherever it is used.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand-assets', 'brand-assets', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "Admins manage brand images" on storage.objects;
create policy "Admins manage brand images"
  on storage.objects for all to authenticated
  using (
    bucket_id in ('product-images', 'collection-banners', 'location-images', 'brand-assets')
    and public.is_admin()
  )
  with check (
    bucket_id in ('product-images', 'collection-banners', 'location-images', 'brand-assets')
    and public.is_admin()
  );

drop policy if exists "Published images are readable" on storage.objects;
create policy "Published images are readable"
  on storage.objects for select to anon, authenticated
  using (
    (bucket_id in ('product-images', 'collection-banners', 'location-images', 'brand-assets') and public.is_admin())
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
    or (
      bucket_id = 'brand-assets'
      and exists (select 1 from public.site_content s where s.key = 'logo_path' and s.value = storage.objects.name)
    )
  );

-- ----------------------------------------------------------------------------
-- Promotions.
--
-- Once a code has been redeemed (a paid order used it), what it is and what
-- it gives are fixed: the code, percent or fixed, the amount and the cap.
-- Dates, limits, the minimum spend and the on/off switch can still change.
-- Enforced by trigger, whoever writes.
-- ----------------------------------------------------------------------------
create or replace function public.guard_redeemed_promo()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (upper(new.code) is distinct from upper(old.code)
      or new.type is distinct from old.type
      or new.percent is distinct from old.percent
      or new.amount_cents is distinct from old.amount_cents
      or new.max_discount_cents is distinct from old.max_discount_cents)
     and (old.times_used > 0 or exists (select 1 from public.promo_redemptions where promo_id = old.id)) then
    raise exception 'This code has been used, so its code and discount can''t change. Create a new code instead.'
      using errcode = 'DC040';
  end if;
  return new;
end;
$$;

create trigger promos_lock_after_redemption
  before update on public.promos
  for each row execute function public.guard_redeemed_promo();

-- p: id (null to create), code, description, type (percent | fixed), percent,
--    amount_cents, min_spend_cents, max_discount_cents, usage_limit,
--    per_user_limit, starts_at, ends_at, is_active
create or replace function public.admin_save_promo(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_code text := upper(btrim(coalesce(p ->> 'code', '')));
  v_type public.promo_type := (p ->> 'type')::public.promo_type;
  v_percent numeric := case when v_type = 'percent' then nullif(p ->> 'percent', '')::numeric end;
  v_amount integer := case when v_type = 'fixed' then nullif(p ->> 'amount_cents', '')::integer end;
  v_starts timestamptz := coalesce(nullif(p ->> 'starts_at', '')::timestamptz, now());
  v_ends timestamptz := nullif(p ->> 'ends_at', '')::timestamptz;
begin
  perform public.assert_admin();
  if v_code !~ '^[A-Z0-9][A-Z0-9-]{2,29}$' then
    raise exception 'Codes are 3 to 30 letters, numbers or hyphens' using errcode = 'invalid_parameter_value';
  end if;
  if v_type = 'percent' and (v_percent is null or v_percent <= 0 or v_percent > 100 or v_percent <> round(v_percent, 2)) then
    raise exception 'A percentage between 0.01 and 100' using errcode = 'invalid_parameter_value';
  end if;
  if v_type = 'fixed' and (v_amount is null or v_amount not between 1 and 100000) then
    raise exception 'An amount between $0.01 and $1,000.00' using errcode = 'invalid_parameter_value';
  end if;
  if v_ends is not null and v_ends <= v_starts then
    raise exception 'The end must be after the start' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(nullif(p ->> 'min_spend_cents', '')::integer, 0) not between 0 and 1000000
     or coalesce(nullif(p ->> 'max_discount_cents', '')::integer, 1) not between 1 and 1000000
     or coalesce(nullif(p ->> 'usage_limit', '')::integer, 1) not between 1 and 1000000
     or coalesce(nullif(p ->> 'per_user_limit', '')::integer, 1) not between 1 and 1000
     or char_length(coalesce(p ->> 'description', '')) > 200 then
    raise exception 'Check the limits' using errcode = 'invalid_parameter_value';
  end if;

  if v_id is null then
    insert into public.promos (
      code, description, type, percent, amount_cents, min_spend_cents, max_discount_cents,
      usage_limit, per_user_limit, starts_at, ends_at, is_active
    )
    values (
      v_code, nullif(btrim(coalesce(p ->> 'description', '')), ''), v_type, v_percent, v_amount,
      coalesce(nullif(p ->> 'min_spend_cents', '')::integer, 0), nullif(p ->> 'max_discount_cents', '')::integer,
      nullif(p ->> 'usage_limit', '')::integer, nullif(p ->> 'per_user_limit', '')::integer,
      v_starts, v_ends, coalesce((p ->> 'is_active')::boolean, true)
    )
    returning id into v_id;
  else
    update public.promos
       set code = v_code, description = nullif(btrim(coalesce(p ->> 'description', '')), ''), type = v_type,
           percent = v_percent, amount_cents = v_amount,
           min_spend_cents = coalesce(nullif(p ->> 'min_spend_cents', '')::integer, 0),
           max_discount_cents = nullif(p ->> 'max_discount_cents', '')::integer,
           usage_limit = nullif(p ->> 'usage_limit', '')::integer,
           per_user_limit = nullif(p ->> 'per_user_limit', '')::integer,
           starts_at = v_starts, ends_at = v_ends,
           is_active = coalesce((p ->> 'is_active')::boolean, is_active)
     where id = v_id;
    if not found then
      raise exception 'Promo not found' using errcode = 'no_data_found';
    end if;
  end if;
  return v_id;
end;
$$;

-- The list: each code with uses and the discount it has given so far.
create or replace function public.admin_list_promos()
returns table (
  id uuid, code text, description text, type public.promo_type, percent numeric, amount_cents integer,
  min_spend_cents integer, max_discount_cents integer, usage_limit integer, per_user_limit integer,
  times_used integer, starts_at timestamptz, ends_at timestamptz, is_active boolean,
  discount_given_cents bigint, redemptions bigint, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_admin();
  return query
    select p.id, p.code, p.description, p.type, p.percent, p.amount_cents, p.min_spend_cents, p.max_discount_cents,
           p.usage_limit, p.per_user_limit, p.times_used, p.starts_at, p.ends_at, p.is_active,
           coalesce(sum(r.amount_cents), 0)::bigint, count(r.id), p.created_at
      from public.promos p
      left join public.promo_redemptions r on r.promo_id = p.id
     group by p.id
     order by p.created_at desc;
end;
$$;

-- One code's redemptions: order number, when, the customer's first name.
create or replace function public.admin_promo_redemptions(p_promo_id uuid)
returns table (order_id uuid, order_number text, redeemed_at timestamptz, customer_first_name text, amount_cents integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_admin();
  return query
    select r.order_id, o.order_number, r.created_at,
           coalesce(nullif(o.customer_first_name, ''), case when o.anonymized_at is not null then 'Deleted account' end),
           r.amount_cents
      from public.promo_redemptions r
      join public.orders o on o.id = r.order_id
     where r.promo_id = p_promo_id
     order by r.created_at desc;
end;
$$;

-- ----------------------------------------------------------------------------
-- Rewards.
-- p: id (null to create), name, description, points_cost, type, value_cents,
--    covers_modifiers, applicable_product_ids[], applicable_category_ids[],
--    applicable_modifier_group_ids[], eligibility_label, is_active
-- ----------------------------------------------------------------------------
create or replace function public.admin_save_reward(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_type public.reward_type := (p ->> 'type')::public.reward_type;
  v_value integer := nullif(p ->> 'value_cents', '')::integer;
  v_cost integer := nullif(p ->> 'points_cost', '')::integer;
  v_products uuid[] := array(select x::uuid from jsonb_array_elements_text(coalesce(p -> 'applicable_product_ids', '[]'::jsonb)) x);
  v_categories uuid[] := array(select x::uuid from jsonb_array_elements_text(coalesce(p -> 'applicable_category_ids', '[]'::jsonb)) x);
  v_groups uuid[] := array(select x::uuid from jsonb_array_elements_text(coalesce(p -> 'applicable_modifier_group_ids', '[]'::jsonb)) x);
begin
  perform public.assert_admin();
  if char_length(btrim(coalesce(p ->> 'name', ''))) not between 2 and 60 then
    raise exception 'Give the reward a name of 2 to 60 characters' using errcode = 'invalid_parameter_value';
  end if;
  if v_cost is null or v_cost not between 1 and 100000 then
    raise exception 'Points cost must be between 1 and 100,000' using errcode = 'invalid_parameter_value';
  end if;
  if v_type = 'amount_off' and (v_value is null or v_value not between 1 and 100000) then
    raise exception 'An amount-off reward needs an amount between $0.01 and $1,000.00' using errcode = 'invalid_parameter_value';
  end if;
  if v_value is not null and v_value not between 1 and 100000 then
    raise exception 'The value cap must be between $0.01 and $1,000.00' using errcode = 'invalid_parameter_value';
  end if;
  if v_type <> 'free_modifier' and cardinality(v_groups) > 0 then
    raise exception 'Add-on groups only apply to a free add-on reward' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from unnest(v_products) x where not exists (select 1 from public.products where id = x))
     or exists (select 1 from unnest(v_categories) x where not exists (select 1 from public.categories where id = x))
     or exists (select 1 from unnest(v_groups) x where not exists (select 1 from public.modifier_groups where id = x)) then
    raise exception 'One of the eligible items no longer exists' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(coalesce(p ->> 'description', '')) > 300 or char_length(coalesce(p ->> 'eligibility_label', '')) > 60 then
    raise exception 'Keep the description to 300 characters and the label to 60' using errcode = 'invalid_parameter_value';
  end if;

  if v_id is null then
    insert into public.rewards (
      name, description, points_cost, type, value_cents, covers_modifiers, applicable_product_ids,
      applicable_category_ids, applicable_modifier_group_ids, eligibility_label, is_active, sort_order
    )
    values (
      btrim(p ->> 'name'), nullif(btrim(coalesce(p ->> 'description', '')), ''), v_cost, v_type, v_value,
      v_type = 'free_item' and coalesce((p ->> 'covers_modifiers')::boolean, false), v_products, v_categories, v_groups,
      nullif(btrim(coalesce(p ->> 'eligibility_label', '')), ''), coalesce((p ->> 'is_active')::boolean, true),
      coalesce((select max(sort_order) + 10 from public.rewards), 0)
    )
    returning id into v_id;
  else
    update public.rewards
       set name = btrim(p ->> 'name'), description = nullif(btrim(coalesce(p ->> 'description', '')), ''),
           points_cost = v_cost, type = v_type, value_cents = v_value,
           covers_modifiers = v_type = 'free_item' and coalesce((p ->> 'covers_modifiers')::boolean, false),
           applicable_product_ids = v_products, applicable_category_ids = v_categories,
           applicable_modifier_group_ids = v_groups,
           eligibility_label = nullif(btrim(coalesce(p ->> 'eligibility_label', '')), ''),
           is_active = coalesce((p ->> 'is_active')::boolean, is_active)
     where id = v_id;
    if not found then
      raise exception 'Reward not found' using errcode = 'no_data_found';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_reorder_rewards(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_admin();
  update public.rewards r
     set sort_order = (o.n - 1)::integer * 10
    from unnest(p_ids) with ordinality as o(id, n)
   where r.id = o.id and r.sort_order is distinct from (o.n - 1)::integer * 10;
end;
$$;

-- Programme totals, from the ledger.
--   issued       earned at pickup, plus positive adjustments
--   redeemed     spent on rewards, less what came back (releases)
--   reversed     taken back after refunds
--   expired      expired by the expiry job
--   adjusted_out negative adjustments
--   outstanding  the sum of every open account's balance
create or replace function public.admin_rewards_totals()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_admin();
  return (
    select jsonb_build_object(
      'issued', coalesce(sum(points) filter (where type = 'earn' or (type = 'adjust' and points > 0)), 0),
      'redeemed', coalesce(-sum(points) filter (where type in ('redeem', 'release')), 0),
      'reversed', coalesce(-sum(points) filter (where type = 'reverse'), 0),
      'expired', coalesce(-sum(points) filter (where type = 'expire'), 0),
      'adjusted_out', coalesce(-sum(points) filter (where type = 'adjust' and points < 0), 0),
      'outstanding', (select coalesce(sum(loyalty_points), 0) from public.profiles where deleted_at is null),
      'members_with_points', (select count(*) from public.profiles where deleted_at is null and loyalty_points > 0)
    )
    from public.loyalty_transactions
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- Users.
-- ----------------------------------------------------------------------------

-- Search by name, email or member code; filter by role. Newest first.
create or replace function public.admin_list_users(
  p_query text default null,
  p_role public.user_role default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid, email text, full_name text, first_name text, role public.user_role, loyalty_points integer,
  member_code text, created_at timestamptz, total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  q text := nullif(btrim(coalesce(p_query, '')), '');
  code text := translate(upper(regexp_replace(coalesce(p_query, ''), '[^0-9A-Za-z]', '', 'g')), 'OIL', '011');
begin
  perform public.assert_admin();
  return query
    select p.id, p.email, p.full_name, p.first_name, p.role, p.loyalty_points, p.member_code, p.created_at,
           count(*) over ()
      from public.profiles p
     where p.deleted_at is null
       and (p_role is null or p.role = p_role)
       and (
         q is null
         or p.email ilike '%' || q || '%'
         or p.full_name ilike '%' || q || '%'
         or (char_length(code) = 12 and p.member_code = code)
       )
     order by p.created_at desc, p.id
     limit greatest(1, least(coalesce(p_limit, 25), 100))
    offset greatest(0, coalesce(p_offset, 0));
end;
$$;

-- Change a role. Never your own; never the last admin. Demoting staff to
-- customer clears their location rosters. Errors:
--   DC050  you can't change your own role
--   DC051  that would leave no admin
create or replace function public.admin_set_role(p_user_id uuid, p_role public.user_role)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target public.profiles;
  admins integer;
begin
  perform public.assert_admin();
  if p_user_id = auth.uid() then
    raise exception 'You can''t change your own role' using errcode = 'DC050';
  end if;

  -- Serialise role changes, so two admins demoting each other at once
  -- cannot both succeed and leave nobody. Having waited for the lock, check
  -- the caller again: the other change may have just demoted them.
  perform 1 from public.profiles where role = 'admin' for update;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and deleted_at is null) then
    raise exception 'Only an admin can do that' using errcode = 'insufficient_privilege';
  end if;
  select * into target from public.profiles where id = p_user_id and deleted_at is null for update;
  if not found then
    raise exception 'User not found' using errcode = 'no_data_found';
  end if;
  if target.role = p_role then
    return target;
  end if;

  if target.role = 'admin' then
    select count(*) into admins from public.profiles where role = 'admin' and deleted_at is null;
    if admins <= 1 then
      raise exception 'There must always be at least one admin' using errcode = 'DC051';
    end if;
  end if;

  update public.profiles set role = p_role where id = p_user_id returning * into target;
  if p_role = 'customer' then
    delete from public.staff_locations where profile_id = p_user_id;
  end if;
  return target;
end;
$$;

-- A staff member's counters (the cafe and pop-up events), replaced as a set.
create or replace function public.admin_set_staff_locations(p_user_id uuid, p_location_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_admin();
  if not exists (select 1 from public.profiles where id = p_user_id and role = 'staff' and deleted_at is null) then
    raise exception 'Only staff accounts are assigned to locations' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from unnest(coalesce(p_location_ids, '{}')) x where not exists (select 1 from public.locations where id = x)) then
    raise exception 'Location not found' using errcode = 'invalid_parameter_value';
  end if;
  delete from public.staff_locations
   where profile_id = p_user_id and not (location_id = any (coalesce(p_location_ids, '{}')));
  insert into public.staff_locations (profile_id, location_id)
  select p_user_id, x from unnest(coalesce(p_location_ids, '{}')) x
  on conflict (profile_id, location_id) do nothing;
end;
$$;

-- ----------------------------------------------------------------------------
-- Orders.
-- ----------------------------------------------------------------------------

-- What a payment looks like from the admin's chair.
create or replace function public.order_payment_state(p_order_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select case
      when bool_or(p.status = 'refunded') and not bool_or(p.status in ('succeeded', 'partially_refunded')) then 'refunded'
      when bool_or(p.status = 'partially_refunded') then 'partially_refunded'
      when bool_or(p.status = 'succeeded') then 'paid'
      when bool_or(p.status = 'processing') then 'processing'
      when bool_or(p.status = 'failed') then 'failed'
      else 'unpaid'
    end
    from public.payments p where p.order_id = p_order_id
  ), 'unpaid');
$$;

revoke execute on function public.order_payment_state(uuid) from public, anon, authenticated;

-- Search: order number, customer name or email; Honolulu date range on when
-- the order was created; location; status; payment state. Newest first.
create or replace function public.admin_list_orders(
  p_query text default null,
  p_from date default null,
  p_to date default null,
  p_location_id uuid default null,
  p_status public.order_status default null,
  p_payment text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid, order_number text, created_at timestamptz, placed_at timestamptz, status public.order_status,
  location_id uuid, location_name text, customer_name text, customer_email text, total_cents integer,
  refunded_cents bigint, payment_state text, flagged boolean, total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  perform public.assert_admin();
  return query
    with matched as (
      select o.*, l.name as l_name, pr.full_name as pr_name, pr.email as pr_email,
             public.order_payment_state(o.id) as pay_state
        from public.orders o
        join public.locations l on l.id = o.location_id
        left join public.profiles pr on pr.id = o.user_id
       where (p_from is null or o.created_at >= (p_from::timestamp at time zone 'Pacific/Honolulu'))
         and (p_to is null or o.created_at < ((p_to + 1)::timestamp at time zone 'Pacific/Honolulu'))
         and (p_location_id is null or o.location_id = p_location_id)
         and (p_status is null or o.status = p_status)
         and (
           q is null
           or o.order_number ilike '%' || q || '%'
           or o.customer_first_name ilike '%' || q || '%'
           or o.customer_email ilike '%' || q || '%'
           or pr.full_name ilike '%' || q || '%'
           or pr.email ilike '%' || q || '%'
         )
    )
    select m.id, m.order_number, m.created_at, m.placed_at, m.status, m.location_id, m.l_name,
           coalesce(nullif(m.pr_name, ''), m.customer_first_name), coalesce(m.pr_email, m.customer_email), m.total_cents,
           (select coalesce(sum(p.refunded_cents), 0) from public.payments p where p.order_id = m.id)::bigint,
           m.pay_state,
           m.flagged_for_review_at is not null and m.review_resolved_at is null,
           count(*) over ()
      from matched m
     where p_payment is null or m.pay_state = p_payment
     order by m.created_at desc, m.id
     limit greatest(1, least(coalesce(p_limit, 25), 100))
    offset greatest(0, coalesce(p_offset, 0));
end;
$$;

-- Send the receipt again (to the customer's address as it is now). One
-- resend in flight at a time (DC062).
create or replace function public.admin_resend_receipt(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.orders;
  new_id uuid;
begin
  perform public.assert_admin();
  select * into o from public.orders where id = p_order_id;
  if not found or o.placed_at is null then
    raise exception 'Only a paid order has a receipt' using errcode = 'invalid_parameter_value';
  end if;
  if exists (
    select 1 from public.email_outbox
     where order_id = o.id and kind = 'order_receipt' and status in ('pending', 'sending')
  ) then
    raise exception 'A receipt for this order is already on its way' using errcode = 'DC062';
  end if;
  insert into public.email_outbox (kind, order_id, dedupe_key, requested_by)
  values ('order_receipt', o.id, 'order_receipt:' || o.id || ':resend:' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint, auth.uid())
  returning id into new_id;
  return new_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- The attention queue.
-- ----------------------------------------------------------------------------

-- The expiry job notes when it tried an unpaid order and had to leave it
-- (money on its way, or an error), so the queue can tell "stuck" from "not
-- swept yet".
alter table public.orders
  add column expiry_attempted_at timestamptz,
  add column expiry_note text check (expiry_note is null or char_length(expiry_note) <= 500);

-- Everything that needs a person, newest first. Each kind disappears when it
-- is resolved:
--   flagged_order     a payment did not match its order -> placed or refunded
--   flagged_catering  a catering payment did not match -> reviewed
--   failed_refund     a refund failed -> retried or marked handled
--   failed_email      an email gave up -> retried or dismissed
--   catering          new requests, change and cancellation requests,
--                     payments -> opened
--   stuck_unpaid      unpaid past its expiry, and the expiry job could not
--                     settle it (or has not run for a day) -> checked
create or replace function public.admin_attention_items()
returns table (
  kind text, id uuid, title text, detail text, occurred_at timestamptz,
  order_id uuid, catering_request_id uuid, amount_cents integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  expiry integer := coalesce((public.get_setting('orders.pending_expiry_minutes') #>> '{}')::integer, 30);
begin
  perform public.assert_admin();
  return query
    select * from (
      select 'flagged_order'::text, o.id, 'Payment didn''t match order ' || o.order_number, o.review_reason,
             o.flagged_for_review_at, o.id, null::uuid, o.total_cents
        from public.orders o
       where o.flagged_for_review_at is not null and o.review_resolved_at is null
      union all
      select 'flagged_catering', c.id, 'Catering payment didn''t match ' || c.request_number, c.review_reason,
             c.flagged_for_review_at, null::uuid, c.id, null::integer
        from public.catering_requests c
       where c.flagged_for_review_at is not null and c.review_resolved_at is null
      union all
      select 'failed_refund', r.id,
             'Refund failed: ' || coalesce(o.order_number, c.request_number, 'payment'),
             r.failure_reason, r.updated_at, r.order_id, r.catering_request_id, r.amount_cents
        from public.refunds r
        left join public.orders o on o.id = r.order_id
        left join public.catering_requests c on c.id = r.catering_request_id
       where r.status = 'failed' and r.handled_at is null
      union all
      select 'failed_email', e.id,
             'Email not sent: ' || replace(e.kind, '_', ' ') || ' · ' || coalesce(o.order_number, c.request_number, ''),
             e.last_error, e.updated_at, e.order_id, e.catering_request_id, null::integer
        from public.email_outbox e
        left join public.orders o on o.id = e.order_id
        left join public.catering_requests c on c.id = e.catering_request_id
       where e.status = 'failed' and e.dismissed_at is null
      union all
      select 'catering', c.id,
             case
               when c.status = 'submitted' and c.quoted_at is null then 'New catering request ' || c.request_number
               when c.cancellation_requested_at is not null and c.status = 'confirmed' then 'Cancellation asked for: ' || c.request_number
               when c.status = 'confirmed' then 'Catering paid: ' || c.request_number
               else 'Catering update: ' || c.request_number
             end,
             coalesce(c.contact_name, '') || ' · ' || c.headcount || ' people',
             c.admin_attention_at, null::uuid, c.id, null::integer
        from public.catering_requests c
       where c.admin_attention_at is not null and (c.admin_seen_at is null or c.admin_seen_at < c.admin_attention_at)
      union all
      select 'stuck_unpaid', o.id, 'Unpaid order ' || o.order_number || ' is past its expiry',
             coalesce(o.expiry_note, 'Not settled by the expiry job.'), o.created_at, o.id, null::uuid, o.total_cents
        from public.orders o
       where o.status = 'pending_payment'
         and o.flagged_for_review_at is null
         and o.created_at < now() - make_interval(mins => expiry)
         and (o.expiry_attempted_at is not null or o.created_at < now() - interval '24 hours')
    ) items
    order by 5 desc nulls last;
end;
$$;

-- A payment that did not match its order: place the order (accept the money
-- as it is), or cancel it so the server refunds it. A note is required.
-- Returns the order's status.
--   DC060  nothing to resolve (not flagged, or already resolved)
--   DC061  "place" without a captured payment
create or replace function public.admin_resolve_flagged_order(p_order_id uuid, p_resolution text, p_note text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.orders;
  note text := btrim(coalesce(p_note, ''));
  inserted integer;
begin
  perform public.assert_admin();
  if char_length(note) < 3 then
    raise exception 'Add a short note about what you decided' using errcode = 'invalid_parameter_value';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found or o.flagged_for_review_at is null or o.review_resolved_at is not null or o.status <> 'pending_payment' then
    raise exception 'This order has nothing waiting for review' using errcode = 'DC060';
  end if;

  if p_resolution = 'place' then
    if not exists (select 1 from public.payments where order_id = o.id and status in ('succeeded', 'partially_refunded')) then
      raise exception 'There is no captured payment to accept' using errcode = 'DC061';
    end if;
    update public.orders
       set status = 'placed', review_resolved_at = now(), review_resolved_by = auth.uid(), review_note = left(note, 1000)
     where id = o.id;
    -- As mark_order_paid would have: count the promo.
    if o.promo_id is not null then
      insert into public.promo_redemptions (promo_id, user_id, order_id, amount_cents)
      values (o.promo_id, o.user_id, o.id, o.discount_cents - o.reward_discount_cents)
      on conflict (promo_id, order_id) do nothing;
      get diagnostics inserted = row_count;
      if inserted > 0 then
        update public.promos set times_used = times_used + 1 where id = o.promo_id;
      end if;
    end if;
    return 'placed';
  elsif p_resolution = 'cancel' then
    update public.orders
       set status = 'cancelled',
           cancellation_reason = 'The payment didn''t match the order, so it was cancelled and refunded.',
           review_resolved_at = now(), review_resolved_by = auth.uid(), review_note = left(note, 1000)
     where id = o.id;
    return 'cancelled';
  end if;
  raise exception 'Choose place or cancel' using errcode = 'invalid_parameter_value';
end;
$$;

create or replace function public.admin_clear_catering_flag(p_request_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  note text := btrim(coalesce(p_note, ''));
begin
  perform public.assert_admin();
  if char_length(note) < 3 then
    raise exception 'Add a short note about what you decided' using errcode = 'invalid_parameter_value';
  end if;
  update public.catering_requests
     set review_resolved_at = now(), review_resolved_by = auth.uid(), review_note = left(note, 1000)
   where id = p_request_id and flagged_for_review_at is not null and review_resolved_at is null;
  if not found then
    raise exception 'This request has nothing waiting for review' using errcode = 'DC060';
  end if;
end;
$$;

-- A failed refund settled some other way (by hand in Stripe, cash, or not owed).
create or replace function public.admin_mark_refund_handled(p_refund_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  note text := btrim(coalesce(p_note, ''));
begin
  perform public.assert_admin();
  if char_length(note) < 3 then
    raise exception 'Add a short note about how it was handled' using errcode = 'invalid_parameter_value';
  end if;
  update public.refunds
     set handled_at = now(), handled_by = auth.uid(), handled_note = left(note, 1000)
   where id = p_refund_id and status = 'failed' and handled_at is null;
  if not found then
    raise exception 'This refund is not waiting for anyone' using errcode = 'DC060';
  end if;
end;
$$;

-- A failed email: back in the queue now, or set aside with a note.
create or replace function public.admin_retry_email(p_email_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_admin();
  update public.email_outbox
     set status = 'pending', attempts = 0, next_attempt_at = now(), locked_at = null
   where id = p_email_id and status = 'failed' and dismissed_at is null;
  if not found then
    raise exception 'This email is not waiting for anyone' using errcode = 'DC060';
  end if;
end;
$$;

create or replace function public.admin_dismiss_email(p_email_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  note text := btrim(coalesce(p_note, ''));
begin
  perform public.assert_admin();
  if char_length(note) < 3 then
    raise exception 'Add a short note about why' using errcode = 'invalid_parameter_value';
  end if;
  update public.email_outbox
     set dismissed_at = now(), dismissed_by = auth.uid(), dismissed_note = left(note, 1000)
   where id = p_email_id and status = 'failed' and dismissed_at is null;
  if not found then
    raise exception 'This email is not waiting for anyone' using errcode = 'DC060';
  end if;
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
    'public.admin_save_cafe(jsonb)',
    'public.admin_save_location_hours(uuid, jsonb)',
    'public.admin_save_closure(jsonb)',
    'public.admin_delete_closure(uuid)',
    'public.admin_update_setting(text, jsonb)',
    'public.admin_set_confirmed(text, text, boolean)',
    'public.admin_save_content(text, text)',
    'public.admin_save_promo(jsonb)',
    'public.admin_list_promos()',
    'public.admin_promo_redemptions(uuid)',
    'public.admin_save_reward(jsonb)',
    'public.admin_reorder_rewards(uuid[])',
    'public.admin_rewards_totals()',
    'public.admin_list_users(text, public.user_role, integer, integer)',
    'public.admin_set_role(uuid, public.user_role)',
    'public.admin_set_staff_locations(uuid, uuid[])',
    'public.admin_list_orders(text, date, date, uuid, public.order_status, text, integer, integer)',
    'public.admin_resend_receipt(uuid)',
    'public.admin_attention_items()',
    'public.admin_resolve_flagged_order(uuid, text, text)',
    'public.admin_clear_catering_flag(uuid, text)',
    'public.admin_mark_refund_handled(uuid, text)',
    'public.admin_retry_email(uuid)',
    'public.admin_dismiss_email(uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;

comment on function public.admin_set_role is
  'Admin: change a role (never your own, never the last admin; demoting to customer clears rosters).';
comment on function public.admin_attention_items is
  'Admin: everything that needs a person (flagged payments, failed refunds and emails, new catering, stuck unpaid orders).';
