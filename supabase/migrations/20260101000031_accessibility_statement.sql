-- ============================================================================
-- Phase 10: the accessibility statement (/accessibility), edited by the
-- admin under Pages & contact like the privacy policy and terms. Seeded with
-- a statement describing what the app does today; the cafe reviews it before
-- launch (it is on the setup checklist with the other site content).
-- ============================================================================

alter table public.site_content drop constraint site_content_key_check;
alter table public.site_content add constraint site_content_key_check check (key in (
  'about', 'contact_phone', 'contact_email', 'instagram_url', 'facebook_url',
  'logo_path', 'privacy_policy', 'terms', 'refund_policy', 'accessibility'
));

insert into public.site_content (key, value) values (
  'accessibility',
  'Drincup Cafe wants everyone to be able to order ahead with ease. We aim for this app to meet the Web Content Accessibility Guidelines (WCAG) 2.1 at level AA.

What we have done: you can browse, customize, pay and track an order using only a keyboard, or with a screen reader such as VoiceOver or TalkBack. Text and buttons meet the contrast guidelines, pages work when zoomed to 200% and on narrow phone screens, and buttons are large enough to tap easily. Price changes, order status updates and the "Your order is ready" alert are announced as they happen. Animations are reduced when your device asks for less motion, and Hawaiian words are spelled with the ʻokina and kahakō.

How we check: automated accessibility tests run on every main page before each update, and we test ordering and paying by keyboard.

Known limitations: the card form is provided by our payment processor, Stripe, and follows its accessibility support. Until our own photos are ready, drinks show an illustrated placeholder.

If anything gets in your way, please tell us at the counter or through the contact details on our About page. We will help you place your order and work to fix the problem.'
) on conflict (key) do nothing;

-- Same checks as before, with the statement among the long texts.
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
  if p_key in ('about', 'privacy_policy', 'terms', 'accessibility') and (char_length(v) < 20 or char_length(v) > 20000) then
    raise exception 'Use between 20 and 20,000 characters' using errcode = 'invalid_parameter_value';
  end if;
  if p_key = 'refund_policy' and (char_length(v) < 20 or char_length(v) > 2000) then
    raise exception 'Use between 20 and 2,000 characters' using errcode = 'invalid_parameter_value';
  end if;

  update public.site_content set value = v, updated_by = auth.uid() where key = p_key and value is distinct from v;
end;
$$;
