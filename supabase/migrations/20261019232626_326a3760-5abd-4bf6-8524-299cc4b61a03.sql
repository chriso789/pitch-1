-- Helper: platform training access check
create or replace function public.has_training_access(_user_id uuid, _level text default 'reviewer')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and (
      role in ('master','platform_developer')
      or (_level = 'reviewer' and role = 'platform_training_reviewer')
    )
  )
$$;
revoke all on function public.has_training_access(uuid, text) from public, anon;
grant execute on function public.has_training_access(uuid, text) to authenticated;

-- Trainer tables: developer-only access
drop policy if exists "training_originals_read" on public.photo_training_originals;
create policy "training_originals_dev" on public.photo_training_originals for all to authenticated using (public.has_training_access(auth.uid())) with check (public.has_training_access(auth.uid()));

drop policy if exists "training_labels_read" on public.photo_training_labels;
create policy "training_labels_dev" on public.photo_training_labels for all to authenticated using (public.has_training_access(auth.uid())) with check (public.has_training_access(auth.uid()));

drop policy if exists "training_datasets_read" on public.photo_training_datasets;
create policy "training_datasets_dev" on public.photo_training_datasets for all to authenticated using (public.has_training_access(auth.uid())) with check (public.has_training_access(auth.uid()));

drop policy if exists "training_events_read" on public.photo_training_events;
create policy "training_events_dev" on public.photo_training_events for all to authenticated using (public.has_training_access(auth.uid())) with check (public.has_training_access(auth.uid()));

drop policy if exists "training_models_read" on public.photo_damage_models;
create policy "training_models_dev" on public.photo_damage_models for all to authenticated using (public.has_training_access(auth.uid())) with check (public.has_training_access(auth.uid()));

drop policy if exists "training_deployments_read" on public.photo_damage_deployments;
create policy "training_deployments_dev" on public.photo_damage_deployments for all to authenticated using (public.has_training_access(auth.uid())) with check (public.has_training_access(auth.uid()));

drop policy if exists "prc_select" on public.photo_reference_candidates;
drop policy if exists "prc_insert" on public.photo_reference_candidates;
drop policy if exists "prc_delete" on public.photo_reference_candidates;
create policy "prc_dev" on public.photo_reference_candidates for all to authenticated using (public.has_training_access(auth.uid())) with check (public.has_training_access(auth.uid()));

drop policy if exists "prr_select" on public.photo_reference_reviews;
create policy "prr_dev" on public.photo_reference_reviews for all to authenticated using (public.has_training_access(auth.uid())) with check (public.has_training_access(auth.uid()));

drop policy if exists "ptr_rw" on public.photo_triage_results;
create policy "ptr_dev" on public.photo_triage_results for all to authenticated using (public.has_training_access(auth.uid())) with check (public.has_training_access(auth.uid()));

drop policy if exists "prp_rw" on public.photo_region_proposals;
create policy "prp_dev" on public.photo_region_proposals for all to authenticated using (public.has_training_access(auth.uid())) with check (public.has_training_access(auth.uid()));

drop policy if exists "Company members manage their benchmark sets" on public.photo_benchmark_sets;
create policy "benchmark_sets_dev" on public.photo_benchmark_sets for all to authenticated using (public.has_training_access(auth.uid())) with check (public.has_training_access(auth.uid()));

drop policy if exists "Company members manage their benchmark items" on public.photo_benchmark_items;
create policy "benchmark_items_dev" on public.photo_benchmark_items for all to authenticated using (public.has_training_access(auth.uid())) with check (public.has_training_access(auth.uid()));

-- RPC wrappers: guard before delegating to internal definer functions
create or replace function public.photo_training_label_save(o uuid, s text, r jsonb, a jsonb, n boolean, tags_input text[], submit boolean default false, expected_revision integer default 0)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.has_training_access(auth.uid()) then raise exception 'Platform training access required'; end if;
  return photo_training_internal.photo_training_label_save(o,s,r,a,n,tags_input,submit,expected_revision);
end $$;

create or replace function public.photo_training_label_review(l uuid, decision text, note text, expected_revision integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_training_access(auth.uid()) then raise exception 'Platform training access required'; end if;
  perform photo_training_internal.photo_training_label_review(l,decision,note,expected_revision);
end $$;

create or replace function public.photo_training_dataset_create(t uuid, v text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.has_training_access(auth.uid(),'developer') then raise exception 'Platform developer access required'; end if;
  return photo_training_internal.photo_training_dataset_create(t,v);
end $$;

create or replace function public.photo_training_original_add(t uuid, property text, hash text, path text, name text, w integer, h integer)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.has_training_access(auth.uid()) then raise exception 'Platform training access required'; end if;
  return photo_training_internal.photo_training_original_add(t,property,hash,path,name,w,h);
end $$;

create or replace function public.photo_training_access(t uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.has_training_access(auth.uid()) then raise exception 'Platform training access required'; end if;
  return photo_training_internal.photo_training_access(t);
end $$;

create or replace function public.photo_damage_model_register(t uuid, d uuid, v text, config jsonb, hash text, path text, license text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.has_training_access(auth.uid(),'developer') then raise exception 'Platform developer access required'; end if;
  return photo_training_internal.photo_damage_model_register(t,d,v,config,hash,path,license);
end $$;

create or replace function public.photo_damage_model_evaluate(m uuid, hash text, predictions jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_training_access(auth.uid(),'developer') then raise exception 'Platform developer access required'; end if;
  perform photo_training_internal.photo_damage_model_evaluate(m,hash,predictions);
end $$;

create or replace function public.photo_damage_model_review(m uuid, note text, license_verified boolean, execution_verified boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_training_access(auth.uid()) then raise exception 'Platform training access required'; end if;
  perform photo_training_internal.photo_damage_model_review(m,note,license_verified,execution_verified);
end $$;

create or replace function public.photo_damage_model_activate(m uuid, note text, rollback boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_training_access(auth.uid(),'developer') then raise exception 'Platform developer access required to promote or roll back models'; end if;
  perform photo_training_internal.photo_damage_model_activate(m,note,rollback);
end $$;

drop function if exists public.review_reference_candidate(uuid, text, text);
create function public.review_reference_candidate(_id uuid, _action text, _reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare c public.photo_reference_candidates%rowtype;
begin
  if not public.has_training_access(auth.uid()) then raise exception 'Platform training access required'; end if;
  if _action not in ('approved','rejected','needs_correction') then raise exception 'Invalid review action'; end if;
  select * into c from public.photo_reference_candidates where id = _id for update;
  if not found then raise exception 'Label not found'; end if;
  if c.labeled_by = auth.uid() then raise exception 'You cannot review your own label'; end if;
  if c.review_status <> 'pending' then raise exception 'This label was already reviewed'; end if;
  if _action <> 'approved' and coalesce(trim(_reason), '') = '' then raise exception 'A reason is required'; end if;
  update public.photo_reference_candidates set review_status = _action, reviewed_by = auth.uid(), reviewed_at = now(),
    review_comment = nullif(trim(_reason), ''),
    approved_by = case when _action = 'approved' then auth.uid() else null end,
    approved_at = case when _action = 'approved' then now() else null end
  where id = _id;
  insert into public.photo_reference_reviews(candidate_id, tenant_id, reviewer_id, action, reason, previous_cls)
  values (_id, c.tenant_id, auth.uid(), _action, nullif(trim(_reason), ''), c.cls);
end $$;

create or replace function public.platform_training_overview()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if auth.uid() is null or not public.has_training_access(auth.uid(),'developer') then raise exception 'Platform developer access required'; end if;
  insert into public.platform_training_access_log(actor_id, action) values (auth.uid(), 'overview');
  with opted as (select tenant_id from public.photo_training_contributions where status = 'opted_in'),
  ex as (select c.cls, c.condition, c.source_property_key, c.tenant_id from public.photo_reference_candidates c
         join opted o on o.tenant_id = c.tenant_id
         where c.approved_by is not null and coalesce(c.review_status,'approved') = 'approved' and c.approved_by <> c.labeled_by)
  select jsonb_build_object(
    'companies_total', (select count(distinct tenant_id) from public.customer_photos),
    'companies_opted_in', (select count(*) from opted),
    'eligible_photos', (select count(*) from public.customer_photos p join opted o on o.tenant_id = p.tenant_id where p.mime_type is null or p.mime_type like 'image/%')
       + (select count(*) from public.canvass_photos p join opted o on o.tenant_id = p.tenant_id),
    'approved_examples', (select count(*) from ex),
    'properties', (select count(distinct tenant_id::text || source_property_key) from ex),
    'by_class', coalesce((select jsonb_agg(jsonb_build_object('cls', cls, 'condition', condition, 'examples', n, 'properties', p, 'companies', t)) from
        (select cls, condition, count(*) n, count(distinct tenant_id::text || source_property_key) p, count(distinct tenant_id) t from ex group by cls, condition) g), '[]'::jsonb),
    'pooling_active', false
  ) into r;
  return r;
end $$;

-- Internal implementations used by storage RLS: keep EXECUTE, pin search_path
alter function photo_training_internal.canvass_training_reference_locked(text) set search_path = public;
alter function photo_training_internal.photo_training_access(uuid) set search_path = public;