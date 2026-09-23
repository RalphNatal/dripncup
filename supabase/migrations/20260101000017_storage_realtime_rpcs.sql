-- ============================================================================
-- Storage buckets, Realtime publication, and the handful of RPCs that let
-- staff act without being granted broad table write access.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Storage. Menu photography is public-read (it renders in the storefront for
-- guests) and admin-write.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('product-images',    'product-images',    true, 5242880,
    array['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
  ('collection-banners', 'collection-banners', true, 5242880,
    array['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
  ('location-images',   'location-images',   true, 5242880,
    array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do nothing;

create policy "Brand images are publicly readable"
  on storage.objects for select to anon, authenticated
  using (bucket_id in ('product-images', 'collection-banners', 'location-images'));

create policy "Admins manage brand images"
  on storage.objects for all to authenticated
  using (
    bucket_id in ('product-images', 'collection-banners', 'location-images')
    and public.is_admin()
  )
  with check (
    bucket_id in ('product-images', 'collection-banners', 'location-images')
    and public.is_admin()
  );

-- ---------------------------------------------------------------------------
-- Realtime. Customers subscribe to their own order row; the staff queue
-- subscribes to its location. RLS still applies to realtime payloads, so a
-- customer only ever receives changes to orders they are allowed to select.
-- ---------------------------------------------------------------------------
-- Tolerant of a publication that already carries the table, so the migration
-- stays re-runnable against an existing project.
do $$
declare
  t text;
begin
  foreach t in array array['orders', 'order_status_history', 'location_availability'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then
        raise notice 'publication supabase_realtime not found; skipping %', t;
    end;
  end loop;
end;
$$;

-- REPLICA IDENTITY FULL so the realtime payload carries the previous row,
-- which the client uses to tell "status changed" from any other update.
alter table public.orders replica identity full;

-- ---------------------------------------------------------------------------
-- Staff RPC: pause / resume online ordering.
--
-- Staff are deliberately NOT granted UPDATE on `locations` -- that would let a
-- barista edit addresses and prep times. This definer function exposes exactly
-- the one column they need.
-- ---------------------------------------------------------------------------
create or replace function public.set_location_accepting_orders(
  target_location_id uuid,
  accepting boolean
)
returns public.locations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated public.locations;
begin
  if not public.can_access_location(target_location_id) then
    raise exception 'Not authorised for this location' using errcode = 'insufficient_privilege';
  end if;

  update public.locations
     set accepting_orders = accepting
   where id = target_location_id
  returning * into updated;

  return updated;
end;
$$;

revoke execute on function public.set_location_accepting_orders(uuid, boolean) from public;
grant execute on function public.set_location_accepting_orders(uuid, boolean) to authenticated;

comment on function public.set_location_accepting_orders is
  'Staff pause/resume toggle; the only write path staff have into locations.';
