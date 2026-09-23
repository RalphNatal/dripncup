-- ============================================================================
-- "Delete my account".
--
-- The deleteAccount server action (next to the /account page) re-checks the
-- password, calls delete_account_data() with the service role, then deletes
-- the auth user through the Supabase admin API. Deleting the auth user
-- cascades to the profile row.
--
-- What this function does, in one transaction:
--   1. cancels orders that are not finished, and catering requests that are
--      not fulfilled or cancelled
--   2. keeps every order and catering record for sales and tax reports, but
--      scrubs the personal fields and detaches user_id
--   3. deletes favourites, the loyalty ledger and any staff roster rows
--   4. scrubs the profile and stamps deleted_at, which locks the account out
--      immediately even if the auth-user deletion that follows were to fail
--
-- order_items are deliberately untouched: they are the immutable snapshot of
-- what was sold (see freeze_order_items) and hold no contact details.
-- ============================================================================

create or replace function public.delete_account_data(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_role public.user_role;
  closing_reason constant text := 'Customer closed their account';
begin
  select role into target_role
    from public.profiles
   where id = target_user_id
     and deleted_at is null
     for update;

  if not found then
    raise exception 'No open account with id %', target_user_id
      using errcode = 'no_data_found';
  end if;

  -- The owner must never be able to lock everyone out of /admin. The advisory
  -- lock serialises admin deletions, so two admins deleting themselves at the
  -- same moment cannot each see the other and both leave.
  if target_role = 'admin' then
    perform pg_advisory_xact_lock(hashtext('public.delete_account_data/last_admin'));

    if not exists (
      select 1
        from public.profiles
       where role = 'admin'
         and deleted_at is null
         and id <> target_user_id
    ) then
      raise exception 'The last remaining admin cannot delete their own account'
        using errcode = 'DC001';
    end if;
  end if;

  -- 1. Cancel what is still in flight. The transition triggers stamp
  --    cancelled_at and write order_status_history.
  update public.orders
     set status = 'cancelled',
         cancellation_reason = closing_reason
   where user_id = target_user_id
     and status in ('pending_payment', 'placed', 'accepted', 'preparing', 'ready');

  update public.catering_requests
     set status = 'cancelled',
         cancellation_reason = closing_reason
   where user_id = target_user_id
     and status in ('submitted', 'quoted', 'confirmed');

  -- 2. Keep the records, lose the person. Stripe payloads carry billing
  --    names and receipt emails, so the stored copy goes too.
  update public.payments p
     set provider_customer_id = null,
         raw = null
    from public.orders o
   where p.order_id = o.id
     and o.user_id = target_user_id;

  update public.orders
     set user_id = null,
         customer_first_name = null,
         customer_phone = null,
         customer_email = null,
         notes = null,
         anonymized_at = now()
   where user_id = target_user_id;

  update public.catering_requests
     set user_id = null,
         contact_name = null,
         contact_email = null,
         contact_phone = null,
         delivery_address = null,
         notes = null,
         custom_drink_request = null,
         anonymized_at = now()
   where user_id = target_user_id;

  update public.promo_redemptions
     set user_id = null
   where user_id = target_user_id;

  -- 3. Nothing here is needed for reporting.
  delete from public.favorites where user_id = target_user_id;
  delete from public.loyalty_transactions where user_id = target_user_id;
  delete from public.staff_locations where profile_id = target_user_id;

  -- 4. Tombstone. Every signed-in check treats deleted_at as signed out.
  update public.profiles
     set email = null,
         full_name = null,
         first_name = null,
         phone = null,
         marketing_opt_in = false,
         sms_opt_in = false,
         deleted_at = now()
   where id = target_user_id;
end;
$$;

-- Only the server, after it has re-verified the password. Granting this to
-- `authenticated` would let a stolen session wipe an account without it.
revoke execute on function public.delete_account_data(uuid) from public, anon, authenticated;
grant execute on function public.delete_account_data(uuid) to service_role;

comment on function public.delete_account_data is
  'Account deletion: cancels open orders/catering, anonymises records kept for reports, removes favourites and loyalty rows, tombstones the profile. Service role only.';
