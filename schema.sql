-- =====================================================================
-- Class Hub: database setup for Supabase
-- Run this whole file ONCE: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- It is safe to run again later (it will not delete your data).
-- =====================================================================

-- 1. Tables ------------------------------------------------------------

create table if not exists public.classes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  code        text not null unique check (code = upper(code) and char_length(code) between 4 and 24),
  roll_regex  text not null default '^[A-Z]{4}[0-9]{3}[A-Z]$',
  created_at  timestamptz not null default now()
);

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  class_id    uuid not null references public.classes(id) on delete restrict,
  name        text not null check (char_length(name) between 1 and 60),
  roll        text not null unique check (roll = upper(roll)),
  role        text not null default 'student' check (role in ('student', 'editor', 'admin')),
  created_at  timestamptz not null default now(),
  last_seen   timestamptz
);
alter table public.profiles add column if not exists last_seen timestamptz;

create table if not exists public.notices (
  id               uuid primary key default gen_random_uuid(),
  class_id         uuid references public.classes(id) on delete cascade,   -- null = whole college
  title            text not null check (char_length(title) between 1 and 120),
  body             text not null default '' check (char_length(body) <= 4000),
  cat              text not null default 'announcement'
                   check (cat in ('exam', 'project', 'syllabus', 'holiday', 'event', 'announcement')),
  notice_date      date,
  notice_time      time,
  unconfirmed      boolean not null default false,
  attachment_path  text,
  attachment_kind  text check (attachment_kind in ('image', 'pdf')),
  author_id        uuid references public.profiles(id) on delete set null,
  author_name      text not null,
  created_at       timestamptz not null default now()
);
create index if not exists notices_class_created_idx on public.notices (class_id, created_at desc);

create table if not exists public.notes (
  id               uuid primary key default gen_random_uuid(),
  class_id         uuid not null references public.classes(id) on delete cascade,
  title            text not null check (char_length(title) between 1 and 80),
  subject          text not null check (char_length(subject) between 1 and 40),
  link             text check (link is null or link ~* '^https?://'),
  attachment_path  text,
  author_id        uuid references public.profiles(id) on delete set null,
  author_name      text not null,
  created_at       timestamptz not null default now(),
  check (link is not null or attachment_path is not null)
);
create index if not exists notes_class_created_idx on public.notes (class_id, created_at desc);

-- 2. Helper functions (used by the security rules) -----------------------

create or replace function public.my_class() returns uuid
language sql stable security definer set search_path = public as $$
  select class_id from public.profiles where id = auth.uid()
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- Can the current user post or change things in this class?
-- Admin: anywhere (including college-wide, class_id null). Editor: only their own class.
create or replace function public.can_write_class(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.my_role()
    when 'admin' then true
    when 'editor' then cid is not null and cid = public.my_class()
    else false
  end
$$;

-- 3. Security rules (Row Level Security) ---------------------------------
-- Nobody can read or write anything unless a rule below allows it.

alter table public.classes  enable row level security;
alter table public.profiles enable row level security;
alter table public.notices  enable row level security;
alter table public.notes    enable row level security;

revoke all on public.classes, public.profiles, public.notices, public.notes from anon;
revoke all on public.classes, public.profiles, public.notices, public.notes from authenticated;
grant select, insert, update, delete on public.classes to authenticated;
grant select, delete on public.profiles to authenticated;           -- profiles are created and changed only by the functions below
grant select, insert, update, delete on public.notices to authenticated;
grant select, insert, update, delete on public.notes to authenticated;

-- classes: members see their own class, the admin sees all and manages them
drop policy if exists classes_select on public.classes;
create policy classes_select on public.classes for select to authenticated
  using (id = public.my_class() or public.my_role() = 'admin');
drop policy if exists classes_admin_write on public.classes;
create policy classes_admin_write on public.classes for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- profiles: you see yourself, editors see their class, the admin sees everyone
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid()
         or public.my_role() = 'admin'
         or (public.my_role() = 'editor' and class_id = public.my_class()));
drop policy if exists profiles_admin_delete on public.profiles;
create policy profiles_admin_delete on public.profiles for delete to authenticated
  using (public.my_role() = 'admin');

-- notices: everyone reads their class and college-wide notices; only editors and the admin write
drop policy if exists notices_select on public.notices;
create policy notices_select on public.notices for select to authenticated
  using (class_id is null or class_id = public.my_class() or public.my_role() = 'admin');
drop policy if exists notices_insert on public.notices;
create policy notices_insert on public.notices for insert to authenticated
  with check (author_id = auth.uid() and public.can_write_class(class_id));
drop policy if exists notices_update on public.notices;
create policy notices_update on public.notices for update to authenticated
  using (public.can_write_class(class_id)) with check (public.can_write_class(class_id));
drop policy if exists notices_delete on public.notices;
create policy notices_delete on public.notices for delete to authenticated
  using (public.can_write_class(class_id));

-- notes: same idea, but always inside one class
drop policy if exists notes_select on public.notes;
create policy notes_select on public.notes for select to authenticated
  using (class_id = public.my_class() or public.my_role() = 'admin');
drop policy if exists notes_insert on public.notes;
create policy notes_insert on public.notes for insert to authenticated
  with check (author_id = auth.uid() and public.can_write_class(class_id));
drop policy if exists notes_update on public.notes;
create policy notes_update on public.notes for update to authenticated
  using (public.can_write_class(class_id)) with check (public.can_write_class(class_id));
drop policy if exists notes_delete on public.notes;
create policy notes_delete on public.notes for delete to authenticated
  using (public.can_write_class(class_id));

-- 4. Functions the app calls ----------------------------------------------

-- Before sign up: is this class code real? (works without login, returns the class name and roll format)
create or replace function public.check_class_code(p_code text)
returns table (class_name text, roll_regex text)
language sql stable security definer set search_path = public as $$
  select name, roll_regex from public.classes where code = upper(trim(p_code)) limit 1
$$;
revoke all on function public.check_class_code(text) from public;
grant execute on function public.check_class_code(text) to anon, authenticated;

-- After sign up: attach the new account to its class as a student.
create or replace function public.join_class(p_code text, p_name text, p_roll text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.classes;
  r text := upper(regexp_replace(coalesce(p_roll, ''), '\s', '', 'g'));
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then raise exception 'already_joined'; end if;
  select * into c from public.classes where code = upper(trim(coalesce(p_code, '')));
  if c.id is null then raise exception 'bad_code'; end if;
  if r !~ c.roll_regex then raise exception 'bad_roll'; end if;
  if char_length(trim(coalesce(p_name, ''))) = 0 then raise exception 'bad_name'; end if;
  insert into public.profiles (id, class_id, name, roll)
  values (auth.uid(), c.id, left(trim(p_name), 60), r);
end
$$;
revoke all on function public.join_class(text, text, text) from public;
grant execute on function public.join_class(text, text, text) to authenticated;

-- Admin only: make a person an editor (CR) or a normal student again.
create or replace function public.set_role(p_roll text, p_role text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.my_role(), '') <> 'admin' then raise exception 'not_allowed'; end if;
  if p_role not in ('student', 'editor') then raise exception 'bad_role'; end if;
  update public.profiles set role = p_role
   where roll = upper(trim(coalesce(p_roll, ''))) and role <> 'admin';
  if not found then raise exception 'not_found'; end if;
end
$$;
revoke all on function public.set_role(text, text) from public;
grant execute on function public.set_role(text, text) to authenticated;

-- Called by the app when someone opens it, so the admin can see who is actually using it.
create or replace function public.touch_seen()
returns void
language sql security definer set search_path = public as $$
  update public.profiles set last_seen = now() where id = auth.uid()
$$;
revoke all on function public.touch_seen() from public;
grant execute on function public.touch_seen() to authenticated;

-- Admin only: delete a person's account completely (they can sign up again with the class code).
create or replace function public.remove_user(p_roll text)
returns void
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if coalesce(public.my_role(), '') <> 'admin' then raise exception 'not_allowed'; end if;
  select id into uid from public.profiles where roll = upper(trim(coalesce(p_roll, ''))) and role <> 'admin';
  if uid is null then raise exception 'not_found'; end if;
  delete from auth.users where id = uid;
end
$$;
revoke all on function public.remove_user(text) from public;
grant execute on function public.remove_user(text) to authenticated;

-- 5. File storage for notice photos and PDFs (private) ----------------------
-- Files live in folders named after the class id, or "college" for college-wide notices.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 8388608, array['image/jpeg', 'application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "attachments read" on storage.objects;
create policy "attachments read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (
    public.my_role() = 'admin'
    or (storage.foldername(name))[1] = 'college'
    or (storage.foldername(name))[1] = public.my_class()::text));

drop policy if exists "attachments insert" on storage.objects;
create policy "attachments insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (
    public.my_role() = 'admin'
    or (public.my_role() = 'editor' and (storage.foldername(name))[1] = public.my_class()::text)));

drop policy if exists "attachments delete" on storage.objects;
create policy "attachments delete" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (
    public.my_role() = 'admin'
    or (public.my_role() = 'editor' and (storage.foldername(name))[1] = public.my_class()::text)));

-- 6. Live updates: new notices appear on everyone's screen without refreshing -----

do $$
begin
  begin alter publication supabase_realtime add table public.notices;
  exception when duplicate_object or undefined_object then null; end;
  begin alter publication supabase_realtime add table public.notes;
  exception when duplicate_object or undefined_object then null; end;
end
$$;

-- =====================================================================
-- AFTER the setup above works, do these two steps (see SETUP.md):
--
-- (a) Create your class. Change the name and the code, then run only this line:
--     insert into public.classes (name, code) values ('FYBSC AI', 'CHANGE-THIS-CODE');
--
-- (b) Sign up in the app with that class code, then make yourself the admin.
--     Replace FDAI001A with YOUR roll number and run only this line:
--     update public.profiles set role = 'admin' where roll = 'FDAI001A';
-- =====================================================================
