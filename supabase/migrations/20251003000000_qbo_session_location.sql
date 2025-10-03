
-- 2025-10-03_set_active_location.sql
-- Session-based location with RPC to set active location for the signed-in user.
-- Safe "create if not exists" patterns + RLS.

create extension if not exists pgcrypto;

-- Minimal profiles table if you don't have one; otherwise comment this block.
do $$ begin
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='user_sessions') then
    create table public.user_sessions (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null,
      active_location_id uuid,
      updated_at timestamptz not null default now(),
      unique (user_id)
    );
    comment on table public.user_sessions is 'Per-user session preferences; stores active_location_id for QBO DepartmentRef mapping.';
  end if;
end $$;

-- RLS
alter table public.user_sessions enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_sessions' and policyname='user_sessions_select') then
    create policy user_sessions_select on public.user_sessions
      for select using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_sessions' and policyname='user_sessions_upsert') then
    create policy user_sessions_upsert on public.user_sessions
      for all using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end $$;

-- RPC: set active location for the current user
create or replace function public.api_set_active_location(p_location_id uuid)
returns table(active_location_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_sessions(user_id, active_location_id, updated_at)
  values (auth.uid(), p_location_id, now())
  on conflict (user_id) do update
    set active_location_id = excluded.active_location_id,
        updated_at = now();

  return query
    select active_location_id from public.user_sessions where user_id = auth.uid();
end $$;

revoke all on function public.api_set_active_location(uuid) from public;
grant execute on function public.api_set_active_location(uuid) to authenticated;
