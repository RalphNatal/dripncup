-- ============================================================================
-- Phase 10: "Your order is ready" as a Web Push notification, even when the
-- app is closed.
--
--   push_subscriptions  one row per browser (device) a customer turned
--                       notifications on in. The endpoint is the browser's
--                       push service address; p256dh and auth are the keys
--                       the payload is encrypted to. A browser has one
--                       subscription per site, so a second account signing
--                       in on the same device takes the row over.
--   push_outbox         pushes owed, written by a trigger in the same
--                       transaction as the status change that owes them,
--                       exactly like email_outbox: the status change never
--                       waits on, or fails because of, a push service. The
--                       server sends them (src/lib/push/outbox.ts) and
--                       removes subscriptions the push service says are gone.
--
-- Who writes what:
--   customers  read and delete their own subscriptions (Account →
--              Notifications). They add one only through the server
--              (save_push_subscription, service role), which first checks
--              the endpoint belongs to a known push service: an endpoint is
--              a URL our server will POST to, so a customer must never be
--              able to point it anywhere else.
--   server     everything else, with the service role.
--
-- notification_prefs: "order_ready_push" is gone. Turning push on is a
-- per-device choice, recorded by the subscription itself.
-- ============================================================================

create table public.push_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  -- https only, except the e2e suite's stand-in push service on this
  -- machine: the server refuses that one everywhere but the Playwright test
  -- server, when saving and again before every send (src/lib/push).
  endpoint         text not null unique
                   check ((endpoint ~ '^https://' or endpoint ~ '^http://127\.0\.0\.1:[0-9]+/') and char_length(endpoint) <= 2048),
  p256dh           text not null check (char_length(p256dh) between 40 and 200),
  auth             text not null check (char_length(auth) between 10 and 100),
  -- "Chrome on Android", shown in Account → Notifications. Never the user agent itself.
  device_label     text not null default 'This device' check (char_length(device_label) between 1 and 80),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_success_at  timestamptz,
  last_failure_at  timestamptz,
  failure_count    integer not null default 0 check (failure_count >= 0)
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id, created_at desc);

create trigger push_subscriptions_set_updated_at
  before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_own_read on public.push_subscriptions
  for select to authenticated
  using (user_id = auth.uid());

create policy push_subscriptions_own_delete on public.push_subscriptions
  for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.push_subscriptions from anon;
revoke insert, update, truncate on public.push_subscriptions from authenticated;

comment on table public.push_subscriptions is
  'Web Push subscriptions, one per browser that turned order notifications on. Added by the server only (save_push_subscription); customers read and delete their own.';

-- At most this many devices per customer; the oldest goes when a new one is added.
create or replace function public.push_subscription_limit()
returns integer
language sql
immutable
as $$ select 10 $$;

-- Saves this browser's subscription for p_user_id (the server has checked
-- the session and the endpoint). A known endpoint is taken over: same
-- browser, possibly a different account. Returns the row id.
create or replace function public.save_push_subscription(
  p_user_id uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_device_label text default 'This device'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved_id uuid;
begin
  if not exists (select 1 from public.profiles where id = p_user_id and deleted_at is null) then
    raise exception 'unknown user' using errcode = '42501';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device_label)
  values (p_user_id, p_endpoint, p_p256dh, p_auth, coalesce(nullif(btrim(p_device_label), ''), 'This device'))
  on conflict (endpoint) do update
     set user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         device_label = excluded.device_label,
         failure_count = 0,
         last_failure_at = null
  returning id into saved_id;

  delete from public.push_subscriptions
   where user_id = p_user_id
     and id in (
       select id from public.push_subscriptions
        where user_id = p_user_id
        order by created_at desc, id desc
       offset public.push_subscription_limit()
     );

  return saved_id;
end;
$$;

revoke execute on function public.save_push_subscription(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.save_push_subscription(uuid, text, text, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- The outbox
-- ----------------------------------------------------------------------------
create table public.push_outbox (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind in ('order_ready')),
  order_id           uuid not null references public.orders (id) on delete cascade,
  -- kind:order_id. A second insert for the same push is a no-op.
  dedupe_key         text not null unique,
  status             text not null default 'pending'
                     check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts           integer not null default 0 check (attempts >= 0),
  -- "Ready" is only worth saying for a short while: few, quick retries.
  max_attempts       integer not null default 4 check (max_attempts >= 1),
  next_attempt_at    timestamptz not null default now(),
  locked_at          timestamptz,
  -- Devices already reached, so a retry only goes to the ones that failed.
  delivered_to       uuid[] not null default '{}',
  last_error         text,
  sent_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index push_outbox_due_idx on public.push_outbox (next_attempt_at)
  where status in ('pending', 'sending');
create index push_outbox_order_idx on public.push_outbox (order_id);

create trigger push_outbox_set_updated_at
  before update on public.push_outbox
  for each row execute function public.set_updated_at();

alter table public.push_outbox enable row level security;

create policy push_outbox_admin_read on public.push_outbox
  for select to authenticated
  using (public.is_admin());

revoke all on public.push_outbox from anon;
revoke insert, update, delete, truncate on public.push_outbox from authenticated;

comment on table public.push_outbox is
  'Push notifications owed by order status changes. Written by trigger, delivered by the server-side sender (src/lib/push/outbox.ts).';

-- An order turning Ready owes one push, if its customer has turned
-- notifications on anywhere. Which devices get it is decided when it is
-- sent, so a device removed in between gets nothing.
create or replace function public.enqueue_order_push()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status is not distinct from old.status or new.status <> 'ready' or new.user_id is null then
    return new;
  end if;

  if exists (select 1 from public.push_subscriptions s where s.user_id = new.user_id) then
    insert into public.push_outbox (kind, order_id, dedupe_key)
    values ('order_ready', new.id, 'order_ready:' || new.id)
    on conflict (dedupe_key) do nothing;
  end if;

  return new;
end;
$$;

create trigger orders_enqueue_push
  after update of status on public.orders
  for each row execute function public.enqueue_order_push();

-- Hands the sender up to p_limit due rows, marked `sending` so a concurrent
-- sender skips them; a `sending` row older than two minutes belongs to a
-- sender that died and is handed out again.
create or replace function public.claim_push_outbox(p_limit integer default 10)
returns setof public.push_outbox
language sql
set search_path = public, pg_temp
as $$
  update public.push_outbox o
     set status = 'sending', locked_at = now(), attempts = o.attempts + 1
   where o.id in (
     select id from public.push_outbox
      where (status = 'pending' and next_attempt_at <= now())
         or (status = 'sending' and locked_at < now() - interval '2 minutes')
      order by next_attempt_at
      limit greatest(1, least(p_limit, 50))
      for update skip locked
   )
  returning o.*;
$$;

revoke execute on function public.claim_push_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_push_outbox(integer) to service_role;

-- ----------------------------------------------------------------------------
-- notification_prefs: drop the unused push flag
-- ----------------------------------------------------------------------------
alter table public.profiles
  alter column notification_prefs set default '{"order_ready_email": false}'::jsonb;

update public.profiles
   set notification_prefs = notification_prefs - 'order_ready_push'
 where notification_prefs ? 'order_ready_push';
