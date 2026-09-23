-- =============================================================================
-- Auth, profiles and avatars
--   * the first account becomes owner even when two sign-ups race
--   * username rules and an availability check that does not expose profiles
--   * avatars bucket: public read, each user writes only their own file
-- =============================================================================

-- -----------------------------------------------------------------------------
-- First account = owner, serialised
-- -----------------------------------------------------------------------------

-- initialize_user() gives "owner" to whoever finds user_roles empty. The lock
-- makes concurrent sign-ups wait for each other, so only one can see it empty.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('public.handle_new_user'));
  perform public.initialize_user(new.id, coalesce(new.raw_user_meta_data ->> 'locale', 'en'));
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

-- -----------------------------------------------------------------------------
-- Profiles
-- -----------------------------------------------------------------------------

-- 3–20 characters: lowercase letters, digits, dot, underscore.
alter table public.profiles
  add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9._]{3,20}$');

alter table public.profiles
  add constraint profiles_display_name_length
  check (display_name is null or char_length(display_name) between 1 and 60);

-- RLS hides other people's profiles, so availability is answered here
-- without revealing anything but a boolean.
create or replace function public.username_available(_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select _username ~ '^[a-z0-9._]{3,20}$'
    and not exists (
      select 1 from public.profiles
      where lower(username) = lower(_username)
        and id is distinct from auth.uid()
    );
$$;
revoke execute on function public.username_available(text) from public, anon;
grant execute on function public.username_available(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Settings: keep the values format.ts understands
-- -----------------------------------------------------------------------------

alter table public.user_settings
  add constraint user_settings_locale_check check (locale in ('en', 'cs')),
  add constraint user_settings_country_check check (country_code ~ '^[A-Z]{2}$'),
  add constraint user_settings_currency_check check (currency ~ '^[A-Z]{3}$'),
  add constraint user_settings_date_format_check
    check (date_format in ('d. M. yyyy', 'dd.MM.yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd')),
  add constraint user_settings_time_format_check check (time_format in ('HH:mm', 'h:mm a')),
  add constraint user_settings_number_format_check
    check (number_format in ('cs', 'en', 'de', 'fr', 'ch')),
  add constraint user_settings_first_day_check check (first_day_of_week in (0, 1, 6));

-- -----------------------------------------------------------------------------
-- Storage: avatars, one file per user under <user_id>/
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- Reads go through the public URL; select is needed for upsert and delete.
create policy "avatars_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
