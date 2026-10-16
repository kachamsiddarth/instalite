-- Run this in Supabase SQL Editor before using the app.
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null check (char_length(username) between 1 and 30),
  caption text not null check (char_length(caption) between 1 and 500),
  image_url text not null,
  image_path text not null,
  created_at timestamptz not null default now()
);

create index if not exists posts_created_at_idx on public.posts (created_at desc);
alter table public.posts enable row level security;

drop policy if exists "Posts are publicly readable" on public.posts;
create policy "Posts are publicly readable" on public.posts for select using (true);
drop policy if exists "Users can create their own posts" on public.posts;
create policy "Users can create their own posts" on public.posts for insert
  with check ((select auth.uid()) = user_id);
drop policy if exists "Posts cannot be updated" on public.posts;
create policy "Posts cannot be updated" on public.posts for update using (false);
drop policy if exists "Posts cannot be deleted" on public.posts;
create policy "Posts cannot be deleted" on public.posts for delete using (false);

-- Likes: one row per (post, user). Counts are derived with count queries
-- so no denormalized counter can drift out of sync.
create table if not exists public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists post_likes_post_id_idx on public.post_likes (post_id);
alter table public.post_likes enable row level security;

drop policy if exists "Likes are publicly readable" on public.post_likes;
create policy "Likes are publicly readable" on public.post_likes for select using (true);
drop policy if exists "Users can like posts" on public.post_likes;
create policy "Users can like posts" on public.post_likes for insert
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users can unlike their own likes" on public.post_likes;
create policy "Users can unlike their own likes" on public.post_likes for delete
  using ((select auth.uid()) = user_id);
drop policy if exists "Likes cannot be updated" on public.post_likes;
create policy "Likes cannot be updated" on public.post_likes for update using (false);

-- Comments: signed-in users can comment; text is validated for length
-- both in the app and here so direct API calls cannot bypass it.
-- The displayed author name is derived server-side from the caller's
-- auth JWT (server-controlled app_metadata display name, else the email
-- local part), so a client can never impersonate another user via a
-- chosen username.
create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null check (char_length(username) between 1 and 30),
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);

create or replace function public.set_post_comment_username()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_claims jsonb := auth.jwt();
  derived_name text;
begin
  if NEW.user_id is distinct from (select auth.uid()) then
    raise exception 'post_comments.user_id must match the authenticated user';
  end if;

  derived_name := nullif(trim(both from coalesce(
    jwt_claims -> 'app_metadata' ->> 'display_name',
    jwt_claims ->> 'email',
    ''
  )), '');

  if derived_name is not null and position('@' in derived_name) > 0 then
    derived_name := split_part(derived_name, '@', 1);
  end if;

  derived_name := left(nullif(trim(both from coalesce(derived_name, '')), ''), 30);

  if derived_name is null then
    raise exception 'Unable to derive a comment author name from the authenticated user';
  end if;

  NEW.username := derived_name;
  return NEW;
end;
$$;

drop trigger if exists set_post_comment_username on public.post_comments;
create trigger set_post_comment_username
  before insert on public.post_comments
  for each row execute function public.set_post_comment_username();

create index if not exists post_comments_post_id_idx on public.post_comments (post_id, created_at);
alter table public.post_comments enable row level security;

drop policy if exists "Comments are publicly readable" on public.post_comments;
create policy "Comments are publicly readable" on public.post_comments for select using (true);
drop policy if exists "Signed-in users can comment" on public.post_comments;
create policy "Signed-in users can comment" on public.post_comments for insert
  with check ((select auth.uid()) = user_id and char_length(body) between 1 and 300);
drop policy if exists "Users can delete their own comments" on public.post_comments;
create policy "Users can delete their own comments" on public.post_comments for delete
  using ((select auth.uid()) = user_id);
drop policy if exists "Comments cannot be updated" on public.post_comments;
create policy "Comments cannot be updated" on public.post_comments for update using (false);

-- Saved posts: private per-user bookmarks. No public read policy exists,
-- so a user can only ever see their own saved-post rows.
create table if not exists public.saved_posts (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists saved_posts_user_id_idx on public.saved_posts (user_id, created_at desc);
alter table public.saved_posts enable row level security;

drop policy if exists "Users can read their own saved posts" on public.saved_posts;
create policy "Users can read their own saved posts" on public.saved_posts for select
  using ((select auth.uid()) = user_id);
drop policy if exists "Users can save posts" on public.saved_posts;
create policy "Users can save posts" on public.saved_posts for insert
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users can unsave their own posts" on public.saved_posts;
create policy "Users can unsave their own posts" on public.saved_posts for delete
  using ((select auth.uid()) = user_id);
drop policy if exists "Saved posts cannot be updated" on public.saved_posts;
create policy "Saved posts cannot be updated" on public.saved_posts for update using (false);

insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', true)
on conflict (id) do update set public = true;

drop policy if exists "Authenticated users can upload their own post images" on storage.objects;
create policy "Authenticated users can upload their own post images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'post-images' and (storage.foldername(name))[1] = 'posts'
    and (storage.foldername(name))[2] = (select auth.uid()::text));
drop policy if exists "Anyone can read post images" on storage.objects;
create policy "Anyone can read post images" on storage.objects
  for select to public using (bucket_id = 'post-images');
drop policy if exists "Users can delete their own post images" on storage.objects;
create policy "Users can delete their own post images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'post-images' and (storage.foldername(name))[1] = 'posts'
    and (storage.foldername(name))[2] = (select auth.uid()::text));

alter table public.posts replica identity full;
alter table public.post_likes replica identity full;
alter table public.post_comments replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'posts'
  ) then
    alter publication supabase_realtime add table public.posts;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'post_likes'
  ) then
    alter publication supabase_realtime add table public.post_likes;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'post_comments'
  ) then
    alter publication supabase_realtime add table public.post_comments;
  end if;
  -- saved_posts rows are strictly owner-scoped; keep the table out of the
  -- realtime publication and remove it for setups that already added it.
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'saved_posts'
  ) then
    alter publication supabase_realtime drop table public.saved_posts;
  end if;
end
$$;
