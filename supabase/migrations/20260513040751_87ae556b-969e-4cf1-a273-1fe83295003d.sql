-- Vendor Quote on Template: storage bucket, parsed line items table, RLS
-- ----------------------------------------------------------------------

-- 1. Storage bucket for template-level vendor quotes (private, tenant-scoped path)
insert into storage.buckets (id, name, public)
values ('vendor-quotes', 'vendor-quotes', false)
on conflict (id) do nothing;

-- Storage policies: tenant_id is the first folder segment
create policy "Vendor quotes: tenant read"
on storage.objects for select
to authenticated
using (
  bucket_id = 'vendor-quotes'
  and (storage.foldername(name))[1] = (
    select tenant_id::text from public.profiles where id = auth.uid()
  )
);

create policy "Vendor quotes: tenant insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'vendor-quotes'
  and (storage.foldername(name))[1] = (
    select tenant_id::text from public.profiles where id = auth.uid()
  )
);

create policy "Vendor quotes: tenant update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'vendor-quotes'
  and (storage.foldername(name))[1] = (
    select tenant_id::text from public.profiles where id = auth.uid()
  )
);

create policy "Vendor quotes: tenant delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'vendor-quotes'
  and (storage.foldername(name))[1] = (
    select tenant_id::text from public.profiles where id = auth.uid()
  )
);

-- 2. Parsed line items table (one row per material line on a quote PDF)
create table if not exists public.vendor_quote_line_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  document_id uuid not null references public.documents(id) on delete cascade,
  template_id uuid references public.estimate_templates(id) on delete set null,
  project_id uuid,
  line_number integer,
  description text not null,
  sku text,
  manufacturer text,
  qty numeric,
  unit text,
  unit_cost numeric,
  line_total numeric,
  match_status text not null default 'unmatched'
    check (match_status in ('unmatched','matched','applied','ignored')),
  matched_template_item_id uuid,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vendor_quote_line_items_tenant_idx
  on public.vendor_quote_line_items(tenant_id);
create index if not exists vendor_quote_line_items_document_idx
  on public.vendor_quote_line_items(document_id);
create index if not exists vendor_quote_line_items_template_idx
  on public.vendor_quote_line_items(template_id);
create index if not exists vendor_quote_line_items_project_idx
  on public.vendor_quote_line_items(project_id);

alter table public.vendor_quote_line_items enable row level security;

-- Tenant-scoped read
create policy "vendor_quote_line_items: tenant read"
on public.vendor_quote_line_items for select
to authenticated
using (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));

-- Tenant-scoped insert
create policy "vendor_quote_line_items: tenant insert"
on public.vendor_quote_line_items for insert
to authenticated
with check (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));

-- Tenant-scoped update
create policy "vendor_quote_line_items: tenant update"
on public.vendor_quote_line_items for update
to authenticated
using (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));

-- Tenant-scoped delete
create policy "vendor_quote_line_items: tenant delete"
on public.vendor_quote_line_items for delete
to authenticated
using (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));

-- updated_at trigger (reuses existing helper if present)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'update_updated_at_column' and pronamespace = 'public'::regnamespace) then
    execute 'create trigger trg_vendor_quote_line_items_updated_at
             before update on public.vendor_quote_line_items
             for each row execute function public.update_updated_at_column()';
  end if;
exception when duplicate_object then null;
end$$;