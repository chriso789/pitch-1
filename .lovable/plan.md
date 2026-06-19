# Crew Portal Labor Orders — Full Workflow

## Why only one order shows now
The current screenshot shows a single card because the query is filtered to `order_type='labor'` on `production_order_assignments`, and only one project has rows there. We'll widen the view, add the job number, and surface every labor order in the tenant for staff (managers/owners) — crew logins remain scoped to their `crew_id`.

## What we'll build

### 1. Labor Order card improvements (crew portal)
- Show **Job # / Project #** (pulled from `projects.project_number` or `jobs.job_number` via `project_id`)
- Show **Project address / customer name** as subtitle
- Inline **Crew dropdown**: shows assigned crew name if set; otherwise "Assign crew…" — staff and crew leads can change it
- Inline **Status dropdown** (see #2)
- If status = `scheduled`: inline **date picker** (writes `scheduled_date`)
- Per-status **Checklist** drawer (see #3)
- **Upload photos** button (already wired) stays on the card

### 2. Company-configurable statuses
New table `labor_order_statuses` (per tenant):
- `key` (slug, e.g. `assigned`, `scheduled`, `in_progress`, `completed`)
- `label`, `color`, `sort_order`, `is_terminal`, `requires_date`
- Seeded defaults: Assigned → Scheduled → In Progress → Completed
- Settings UI: **Settings → Production → Labor Order Statuses** (add/edit/reorder)
- Status dropdown on the card pulls from this table

### 3. Per-status checklists
New tables:
- `labor_order_status_checklists` — checklist template attached to a status (per tenant)
- `labor_order_checklist_items` — items on the template
- `labor_order_checklist_completions` — checked items per assignment
- When the crew opens the card and a status is active, the checklist for that status appears. Status can only advance to a terminal status after required items are checked.

### 4. Scheduling → Calendar integration
- Selecting **Scheduled** + date writes `scheduled_date` and creates events:
  - On the **assigned sales rep's calendar** (via `appointments` table — `assigned_to = project.sales_rep_id`, `appointment_type = 'labor_order'`)
  - On the **crew's calendar** (new `crew_calendar_events` view aggregating assignments where `crew_id = my crew`; the existing crew portal "Navigate" tab will also list scheduled orders)
- Rescheduling updates both events; clearing date removes them.

### 5. Automations on schedule
Edge function `notify-labor-order-scheduled` (authenticated tenant route):
- Triggered by DB trigger on `production_order_assignments` when `status` transitions to `scheduled` OR `scheduled_date` changes while status is scheduled
- Sends:
  - **Email** to crew (`crews.email`) and sales rep (`profiles.email`) via `send-transactional-email` with new template `labor-order-scheduled`
  - **SMS** to crew (`crews.phone`) and sales rep (`profiles.phone`) via existing Telnyx send function
- Includes: job #, address, scheduled date, crew name, rep name, link to project
- Idempotency key: `labor-order-scheduled-{assignment_id}-{scheduled_date}` so re-saves don't double-send

## Files to change / add

**Database (migration):**
- `labor_order_statuses` table + seed defaults per tenant
- `labor_order_status_checklists`, `labor_order_checklist_items`, `labor_order_checklist_completions`
- Add `sales_rep_id` reference resolved from `projects`/`jobs` for trigger lookup (read-only join)
- Trigger `trg_labor_order_schedule_notify` → invokes edge function via `pg_net`

**Frontend:**
- `src/components/crew/LaborOrderCard.tsx` (extract from CrewPortal)
- `src/components/crew/LaborOrderStatusSelect.tsx`
- `src/components/crew/LaborOrderChecklist.tsx`
- `src/components/settings/LaborOrderStatusManagement.tsx` (new settings tab)
- Update `src/components/crew/CrewPortal.tsx` Labor Orders tab to use card + join `projects(project_number, address, sales_rep_id, contacts(...))`
- Update "Navigate" tab to also list scheduled labor orders for the crew

**Edge function:**
- `supabase/functions/notify-labor-order-scheduled/index.ts` (authenticated/internal route, tenant-resolved from assignment row, audit-logged)

**Email template:**
- `supabase/functions/_shared/transactional-email-templates/labor-order-scheduled.tsx`

## Security (tenant enforcement)
- All new tables: RLS scoped by `tenant_id` via `profiles` / `current_user_crew_id()`
- Edge function resolves `tenant_id` server-side from the assignment row, never trusts the body
- Crews can only change status / check items on assignments where `crew_id = current_user_crew_id()`
- Staff (master/owner/corporate/office_admin/manager) can change any assignment in their tenant

## Out of scope (ask before adding)
- Two-way calendar sync to Google/Outlook (we only write to internal `appointments`)
- Custom checklist editor UI (initial release: seed defaults; editor is a follow-up)
- SMS replies / two-way confirmation flow

## Open questions
1. **Default statuses** — confirm: Assigned, Scheduled, In Progress, Completed. Add "On Hold" / "Cancelled"?
2. **Who can change status** — crew + staff, or staff only?
3. **Checklist editor UI now or later?** I recommend later (seed sensible defaults this round so the gate works end-to-end).
4. **Rep phone source** — `profiles.phone`? Some reps have no phone — should we skip SMS silently or fall back to email-only?