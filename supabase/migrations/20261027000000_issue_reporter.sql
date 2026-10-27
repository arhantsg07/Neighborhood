-- Apply once to a fresh Supabase project using migrations (not a client connection).
begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  is_admin boolean not null default false
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  image_url text not null,
  category text not null check (category in ('Pothole', 'Garbage', 'Streetlight', 'Water leak', 'Other')),
  description text not null check (char_length(description) <= 2000 and char_length(btrim(description)) >= 10),
  severity text not null check (severity in ('Low', 'Medium', 'High')),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  status text not null default 'Submitted' check (status in ('Submitted', 'In progress', 'Resolved')),
  created_at timestamptz not null default now(),
  constraint report_image_owner_path check (
    image_url ~ ('^' || user_id::text || '/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,199}\.(jpg|jpeg|png|webp)$')
  )
);

create table public.upvotes (
  report_id uuid not null references public.reports(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (report_id, user_id)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) <= 1000 and char_length(btrim(body)) >= 1),
  created_at timestamptz not null default now()
);

create index reports_created_at_idx on public.reports (created_at desc);
create index reports_user_id_idx on public.reports (user_id);
create index reports_image_url_idx on public.reports (image_url);
create index comments_report_created_idx on public.comments (report_id, created_at);
create index comments_user_id_idx on public.comments (user_id);
create index upvotes_user_id_idx on public.upvotes (user_id);

alter table public.profiles enable row level security;
alter table public.reports enable row level security;
alter table public.upvotes enable row level security;
alter table public.comments enable row level security;

-- Explicit grants avoid relying on a project's default table privileges.
revoke all on public.profiles, public.reports, public.upvotes, public.comments from public, anon, authenticated;
grant select on public.profiles, public.reports, public.upvotes, public.comments to authenticated;
grant insert (user_id, image_url, category, description, severity, latitude, longitude, status)
  on public.reports to authenticated;
grant insert (report_id, user_id, body) on public.comments to authenticated;

create policy profiles_read_self on public.profiles for select to authenticated
  using (id = (select auth.uid()));
-- No client INSERT/UPDATE/DELETE policy or grant on profiles, including for admins.
create policy reports_read on public.reports for select to authenticated using (true);
create policy reports_insert on public.reports for insert to authenticated with check (
  user_id = (select auth.uid()) and status = 'Submitted'
  and exists (
    select 1 from storage.objects o
    where o.bucket_id = 'report-images' and o.name = image_url
  )
);
create policy upvotes_read on public.upvotes for select to authenticated using (true);
create policy comments_read on public.comments for select to authenticated using (true);
create policy comments_insert on public.comments for insert to authenticated
  with check (user_id = (select auth.uid()));

create function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- Never trust raw_user_meta_data (or any client-supplied admin flag).
  insert into public.profiles (id, is_admin) values (new.id, false)
    on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
insert into public.profiles (id, is_admin)
  select id, false from auth.users on conflict (id) do nothing;

create function public.toggle_upvote(p_report_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  -- Serialize toggles for this report, including the first vote (no row yet).
  -- The PK is also a final unique-vote invariant. No check-then-insert race.
  perform 1 from public.reports where id = p_report_id for update;
  if not found then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;
  delete from public.upvotes where report_id = p_report_id and user_id = v_user_id;
  if not found then
    insert into public.upvotes (report_id, user_id) values (p_report_id, v_user_id);
  end if;
end;
$$;
revoke all on function public.toggle_upvote(uuid) from public, anon, authenticated;
grant execute on function public.toggle_upvote(uuid) to authenticated;

create function public.set_report_status(p_report_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and is_admin
  ) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('Submitted', 'In progress', 'Resolved') then
    raise exception 'Invalid report status' using errcode = '22023';
  end if;
  update public.reports set status = p_status where id = p_report_id;
  if not found then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.set_report_status(uuid, text) from public, anon, authenticated;
grant execute on function public.set_report_status(uuid, text) to authenticated;

-- A bounded, sliding-hour quota. This schema must NOT be exposed by PostgREST.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.ai_request_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz[] not null default '{}'
);
alter table private.ai_request_limits enable row level security;
revoke all on private.ai_request_limits from public, anon, authenticated, service_role;

create function public.claim_ai_request(p_user_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_requests timestamptz[];
  v_now timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Backend access required' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'User ID required' using errcode = '22023';
  end if;
  insert into private.ai_request_limits (user_id) values (p_user_id)
    on conflict (user_id) do nothing;
  select requested_at into v_requests from private.ai_request_limits
    where user_id = p_user_id for update;
  -- Evaluate the clock AFTER obtaining the per-user lock, not at tx start.
  v_now := clock_timestamp();
  select coalesce(array_agg(t), '{}'::timestamptz[]) into v_requests
    from unnest(v_requests) as t where t > v_now - interval '1 hour';
  if cardinality(v_requests) >= 10 then
    return false;
  end if;
  update private.ai_request_limits
    set requested_at = array_append(v_requests, v_now) where user_id = p_user_id;
  return true;
end;
$$;
revoke all on function public.claim_ai_request(uuid) from public, anon, authenticated;
grant execute on function public.claim_ai_request(uuid) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-images', 'report-images', false, 6291456, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy report_images_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'report-images'
  and name ~ ('^' || (select auth.uid())::text || '/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,199}\.(jpg|jpeg|png|webp)$')
);
create policy report_images_read on storage.objects for select to authenticated using (
  bucket_id = 'report-images' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.reports r where r.image_url = name)
  )
);
create policy report_images_delete on storage.objects for delete to authenticated using (
  bucket_id = 'report-images' and (storage.foldername(name))[1] = (select auth.uid())::text
);
-- No UPDATE policy: upload with upsert:false; images cannot be replaced in place.

commit;
