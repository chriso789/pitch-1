-- ============================================================================
-- 2025-09-27_automations_dynamic_tags.sql
-- Drop‑in migration: Automations + Dynamic Tags + Smart Docs
-- Requires: Supabase (PostgREST RPC), auth.jwt()/auth.uid() claims in JWT
-- Notes: adjust table names if your contacts/leads/jobs/estimates differ.
-- ============================================================================

-- Safety: required for gen_random_uuid()
create extension if not exists "pgcrypto";

-- ----------------------------
-- Helper functions
-- ----------------------------
create or replace function public.get_user_tenant_id() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'tenant_id','')::uuid
$$;

create or replace function public.has_role(p_role text) returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'role','') = p_role
$$;

create or replace function public.has_any_role(p_roles text[]) returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'role','') = any(p_roles)
$$;

-- JSON helpers
create or replace function public.jsonb_get_path(obj jsonb, path text)
returns jsonb language plpgsql immutable as $$
declare segs text[] := regexp_split_to_array(path, '\.');
        v jsonb := obj;
        part text;
begin
  if obj is null or path is null then
    return null;
  end if;
  foreach part in array segs loop
    if v is null then
      return null;
    end if;
    v := v -> part;
  end loop;
  return v;
end $$;

create or replace function public.jsonb_as_text(j jsonb)
returns text language sql immutable as $$
select case jsonb_typeof(j)
         when 'string' then trim(both '"' from j::text)
         else j::text
       end
$$;

create or replace function public.extract_tokens(t text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct m[1]), array[]::text[])
  from regexp_matches(t, '\{\{\s*([A-Za-z0-9_\.]+)\s*\}\}', 'g') as m
$$;

create or replace function public.escape_token_re(token text)
returns text language sql immutable as $$
  select replace(token, '.', '\.')
$$;

-- ----------------------------
-- Automations
-- ----------------------------
create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  description text,
  is_active boolean not null default false,
  triggers jsonb not null,
  conditions jsonb,
  actions jsonb not null,
  scope jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automations_triggers_is_array check (jsonb_typeof(triggers) = 'array'),
  constraint automations_actions_is_array check (jsonb_typeof(actions) = 'array')
);
create index if not exists automations_tenant_active_idx on public.automations(tenant_id, is_active);
create index if not exists automations_triggers_gin on public.automations using gin (triggers);
create index if not exists automations_conditions_gin on public.automations using gin (conditions);
create index if not exists automations_actions_gin on public.automations using gin (actions);

alter table public.automations enable row level security;
drop policy if exists automations_select on public.automations;
create policy automations_select on public.automations
  for select using (tenant_id = public.get_user_tenant_id());

drop policy if exists automations_insert on public.automations;
create policy automations_insert on public.automations
  for insert
  with check (tenant_id = public.get_user_tenant_id()
              and public.has_any_role(array['manager','admin','master']));

drop policy if exists automations_update on public.automations;
create policy automations_update on public.automations
  for update
  using (tenant_id = public.get_user_tenant_id() and public.has_any_role(array['manager','admin','master']))
  with check (tenant_id = public.get_user_tenant_id() and public.has_any_role(array['manager','admin','master']));

drop policy if exists automations_delete on public.automations;
create policy automations_delete on public.automations
  for delete using (tenant_id = public.get_user_tenant_id() and public.has_any_role(array['admin','master']));

-- ----------------------------
-- Automation logs (forensics)
-- ----------------------------
create table if not exists public.automation_logs (
  id bigserial primary key,
  tenant_id uuid not null,
  automation_id uuid not null references public.automations(id) on delete cascade,
  fired_at timestamptz not null default now(),
  event text not null,
  cause text,
  input jsonb,
  outcome text,
  result jsonb,
  created_by uuid
);
create index if not exists automation_logs_tenant_idx on public.automation_logs(tenant_id, automation_id, fired_at desc);

alter table public.automation_logs enable row level security;
drop policy if exists automation_logs_select on public.automation_logs;
create policy automation_logs_select on public.automation_logs
  for select using (tenant_id = public.get_user_tenant_id());

drop policy if exists automation_logs_insert on public.automation_logs;
create policy automation_logs_insert on public.automation_logs
  for insert with check (tenant_id = public.get_user_tenant_id());

-- ----------------------------
-- Dynamic tags
-- ----------------------------
create table if not exists public.dynamic_tags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  token text not null,                 -- e.g., contact.last_name
  label text,
  description text,
  json_path text not null,             -- dot path into render context
  is_frequently_used boolean not null default false,
  sample_value text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, token)
);
create index if not exists dynamic_tags_tenant_idx on public.dynamic_tags(tenant_id);
create index if not exists dynamic_tags_freq_idx on public.dynamic_tags(tenant_id, is_frequently_used);

alter table public.dynamic_tags enable row level security;
drop policy if exists dynamic_tags_select on public.dynamic_tags;
create policy dynamic_tags_select on public.dynamic_tags
  for select using (tenant_id = public.get_user_tenant_id());

drop policy if exists dynamic_tags_modify on public.dynamic_tags;
create policy dynamic_tags_modify on public.dynamic_tags
  for all using (tenant_id = public.get_user_tenant_id() and public.has_any_role(array['manager','admin','master']))
  with check (tenant_id = public.get_user_tenant_id() and public.has_any_role(array['manager','admin','master']));

-- ----------------------------
-- Smart docs (templates) & renders (audit)
-- ----------------------------
create table if not exists public.smart_docs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  engine text not null default 'liquid', -- liquid|mustache: full rendering should happen in Edge/runtime
  body text not null,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists smart_docs_tenant_idx on public.smart_docs(tenant_id, is_active);

alter table public.smart_docs enable row level security;
drop policy if exists smart_docs_select on public.smart_docs;
create policy smart_docs_select on public.smart_docs
  for select using (tenant_id = public.get_user_tenant_id());

drop policy if exists smart_docs_modify on public.smart_docs;
create policy smart_docs_modify on public.smart_docs
  for all using (tenant_id = public.get_user_tenant_id() and public.has_any_role(array['manager','admin','master']))
  with check (tenant_id = public.get_user_tenant_id() and public.has_any_role(array['manager','admin','master']));

create table if not exists public.smart_doc_renders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  smart_doc_id uuid not null references public.smart_docs(id) on delete cascade,
  context jsonb,
  rendered_text text,
  unresolved_tokens text[] not null default array[]::text[],
  resolved_count int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists smart_doc_renders_tenant_idx on public.smart_doc_renders(tenant_id, smart_doc_id, created_at desc);

alter table public.smart_doc_renders enable row level security;
drop policy if exists smart_doc_renders_select on public.smart_doc_renders;
create policy smart_doc_renders_select on public.smart_doc_renders
  for select using (tenant_id = public.get_user_tenant_id());

drop policy if exists smart_doc_renders_insert on public.smart_doc_renders;
create policy smart_doc_renders_insert on public.smart_doc_renders
  for insert with check (tenant_id = public.get_user_tenant_id());

-- ----------------------------
-- RPCs (Supabase PostgREST)
-- ----------------------------

-- Create automation
create or replace function public.api_automations_create(
  p_name text,
  p_description text default null,
  p_triggers jsonb,
  p_conditions jsonb default null,
  p_actions jsonb,
  p_scope jsonb default null,
  p_is_active boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.automations(id, tenant_id, name, description, is_active, triggers, conditions, actions, scope, created_by)
  values (v_id, public.get_user_tenant_id(), p_name, p_description, coalesce(p_is_active,false), p_triggers, p_conditions, p_actions, p_scope, auth.uid());
  return v_id;
end $$;

revoke all on function public.api_automations_create(text, text, jsonb, jsonb, jsonb, jsonb, boolean) from public;
grant execute on function public.api_automations_create(text, text, jsonb, jsonb, jsonb, jsonb, boolean) to authenticated;

-- Update automation
create or replace function public.api_automations_update(
  p_id uuid,
  p_name text,
  p_description text default null,
  p_triggers jsonb,
  p_conditions jsonb default null,
  p_actions jsonb,
  p_scope jsonb default null,
  p_is_active boolean default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.automations a
     set name = coalesce(p_name, a.name),
         description = coalesce(p_description, a.description),
         triggers = coalesce(p_triggers, a.triggers),
         conditions = coalesce(p_conditions, a.conditions),
         actions = coalesce(p_actions, a.actions),
         scope = coalesce(p_scope, a.scope),
         is_active = coalesce(p_is_active, a.is_active),
         updated_at = now()
   where a.id = p_id
     and a.tenant_id = public.get_user_tenant_id();
  if not found then
    raise exception 'NOT_FOUND_OR_FORBIDDEN';
  end if;
end $$;

revoke all on function public.api_automations_update(uuid, text, text, jsonb, jsonb, jsonb, jsonb, boolean) from public;
grant execute on function public.api_automations_update(uuid, text, text, jsonb, jsonb, jsonb, jsonb, boolean) to authenticated;

-- Activate/deactivate
create or replace function public.api_automations_activate(
  p_id uuid,
  p_active boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.automations a
     set is_active = p_active,
         updated_at = now()
   where a.id = p_id
     and a.tenant_id = public.get_user_tenant_id();
  if not found then
    raise exception 'NOT_FOUND_OR_FORBIDDEN';
  end if;
end $$;

revoke all on function public.api_automations_activate(uuid, boolean) from public;
grant execute on function public.api_automations_activate(uuid, boolean) to authenticated;

-- Logs
create or replace function public.api_automations_log_get(
  p_id uuid,
  p_limit int default 50,
  p_offset int default 0
) returns table(
  id bigint,
  fired_at timestamptz,
  event text,
  cause text,
  input jsonb,
  outcome text,
  result jsonb
)
language sql
security definer
set search_path = public
as $$
  select l.id, l.fired_at, l.event, l.cause, l.input, l.outcome, l.result
  from public.automation_logs l
  join public.automations a on a.id = l.automation_id
  where a.id = p_id
    and a.tenant_id = public.get_user_tenant_id()
  order by l.fired_at desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0)
$$;

revoke all on function public.api_automations_log_get(uuid, int, int) from public;
grant execute on function public.api_automations_log_get(uuid, int, int) to authenticated;

-- Dynamic tags: frequently used
create or replace function public.api_dynamic_tags_frequently_used(
  p_limit int default 100
) returns table(
  token text,
  label text,
  description text,
  json_path text,
  sample_value text
)
language sql
security definer
set search_path = public
as $$
  select dt.token, dt.label, dt.description, dt.json_path, dt.sample_value
  from public.dynamic_tags dt
  where dt.tenant_id = public.get_user_tenant_id()
    and dt.is_frequently_used = true
    and dt.active = true
  order by dt.token
  limit greatest(p_limit, 0)
$$;

revoke all on function public.api_dynamic_tags_frequently_used(int) from public;
grant execute on function public.api_dynamic_tags_frequently_used(int) to authenticated;

-- Smart doc render (safe {{token}} interpolation)
create or replace function public.api_smart_doc_render(
  p_smart_doc_id uuid,
  p_context jsonb default null,
  p_contact_id uuid default null,
  p_lead_id uuid default null,
  p_job_id uuid default null,
  p_estimate_id uuid default null
) returns table(
  smart_doc_id uuid,
  rendered_text text,
  unresolved_tokens text[],
  resolved_count int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_doc record;
  v_ctx jsonb := coalesce(p_context, '{}'::jsonb);
  v_tokens text[];
  v_unresolved text[] := array[]::text[];
  v_render text;
  v_resolved int := 0;
  v_token text;
  v_path text;
  v_val jsonb;
  v_val_text text;
  v_pattern text;
begin
  select * into v_doc
  from public.smart_docs d
  where d.id = p_smart_doc_id and d.tenant_id = v_tenant and d.is_active = true;
  if not found then
    raise exception 'NOT_FOUND_OR_FORBIDDEN';
  end if;

  -- Build context from refs if not provided
  if p_contact_id is not null then
    v_ctx := v_ctx || jsonb_build_object('contact',
      (select to_jsonb(c) - 'tenant_id'
       from public.contacts c
       where c.id = p_contact_id and c.tenant_id = v_tenant));
  end if;
  if p_lead_id is not null then
    v_ctx := v_ctx || jsonb_build_object('lead',
      (select to_jsonb(l) - 'tenant_id'
       from public.leads l
       where l.id = p_lead_id and l.tenant_id = v_tenant));
  end if;
  if p_job_id is not null then
    v_ctx := v_ctx || jsonb_build_object('job',
      (select to_jsonb(j) - 'tenant_id'
       from public.jobs j
       where j.id = p_job_id and j.tenant_id = v_tenant));
  end if;
  if p_estimate_id is not null then
    v_ctx := v_ctx || jsonb_build_object('estimate',
      (select to_jsonb(e) - 'tenant_id'
       from public.estimates e
       where e.id = p_estimate_id and e.tenant_id = v_tenant));
  end if;

  v_tokens := public.extract_tokens(v_doc.body);
  v_render := v_doc.body;

  foreach v_token in array v_tokens loop
    select dt.json_path into v_path
    from public.dynamic_tags dt
    where dt.tenant_id = v_tenant and dt.token = v_token and dt.active = true;

    if v_path is null then
      v_unresolved := array_append(v_unresolved, v_token);
      continue;
    end if;

    v_val := public.jsonb_get_path(v_ctx, v_path);

    if v_val is null then
      v_unresolved := array_append(v_unresolved, v_token);
      continue;
    end if;

    v_val_text := public.jsonb_as_text(v_val);
    v_pattern := '\{\{\s*' || public.escape_token_re(v_token) || '\s*\}\}';
    v_render := regexp_replace(v_render, v_pattern, coalesce(v_val_text,''), 'g');
    v_resolved := v_resolved + 1;
  end loop;

  insert into public.smart_doc_renders(id, tenant_id, smart_doc_id, context, rendered_text, unresolved_tokens, resolved_count, created_by)
  values (gen_random_uuid(), v_tenant, p_smart_doc_id, v_ctx, v_render, v_unresolved, v_resolved, auth.uid());

  return query select p_smart_doc_id, v_render, v_unresolved, v_resolved;
end $$;

revoke all on function public.api_smart_doc_render(uuid, jsonb, uuid, uuid, uuid, uuid) from public;
grant execute on function public.api_smart_doc_render(uuid, jsonb, uuid, uuid, uuid, uuid) to authenticated;
