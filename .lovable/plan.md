

## Plan: Add AccuLynx-Inspired Feature Set to PITCH CRM

This is a large feature set with 6 distinct capabilities. Here's the implementation plan broken into manageable pieces.

---

### 1. Side-by-Side Team Calendars

**What:** View multiple team members' calendars simultaneously when booking appointments.

**Changes:**
- **Edit `src/components/scheduling/AppointmentCalendar.tsx`**: Add a multi-select team member picker. Fetch appointments for all selected team members. Render columns side-by-side (one per rep) within the week/day view, color-coded by rep.
- Add a `selectedReps` state with checkboxes for team members fetched from `profiles` table.
- Query appointments filtered by `assigned_to IN (selected_rep_ids)`.

---

### 2. Custom Fields on Lead Form

**What:** Let admins define custom fields that appear on the lead creation form.

**Changes:**
- **New migration**: Create `lead_custom_fields` table (`id, tenant_id, field_name, field_type [text/number/select/checkbox/date], options JSONB, sort_order, required, active`). RLS scoped by tenant.
- **New component `src/components/settings/LeadCustomFieldsManager.tsx`**: CRUD UI for managing custom fields (add to Settings page).
- **Edit `src/features/contacts/components/LeadForm.tsx`**: Fetch tenant's active custom fields, render them dynamically below the standard fields, store values in `custom_fields` JSONB column on the lead/contact.
- **Edit `src/features/settings/components/Settings.tsx`**: Add "Custom Fields" tab.

---

### 3. SmartDocs Enhancements

**What:** Admin edit permissions, real-time view notifications, e-sign watermark toggle.

**Changes:**
- **Edit `src/features/documents/components/SmartDocs.tsx`**: Add role-based edit/delete controls — only `office_admin` and above can edit templates. Add a toggle for e-sign watermark visibility per document/template.
- **New component `src/components/documents/ViewNotificationBanner.tsx`**: Subscribe to Supabase Realtime on `view_events` table; show toast notification with "@me" mention when a homeowner views a packet.
- **New migration**: Add `show_esign_watermark` boolean column to `smart_doc_templates` (default true).

---

### 4. Apple iCal Integration

**What:** Generate an iCal (.ics) subscription URL so users can sync their PITCH calendar to Apple Calendar.

**Changes:**
- **New edge function `supabase/functions/calendar-ical-feed/index.ts`**: Generate an iCal feed (text/calendar) of the user's appointments. Accept a personal token for auth. Return proper `VCALENDAR`/`VEVENT` format.
- **New migration**: Add `ical_token` (UUID) column to `profiles` for feed authentication.
- **New component `src/components/settings/CalendarSyncSettings.tsx`**: Display the iCal subscription URL, generate/regenerate token, instructions for Apple/Google/Outlook.
- **Edit Settings page**: Add "Calendar Sync" section.

---

### 5. Appointment History (Audit Trail)

**What:** See a full record of every change made to an appointment.

**Changes:**
- **New migration**: Create `appointment_history` table (`id, appointment_id, tenant_id, changed_by, change_type [created/updated/rescheduled/cancelled/attendee_changed], old_values JSONB, new_values JSONB, created_at`). Add a trigger on `appointments` that logs changes automatically.
- **New component `src/components/scheduling/AppointmentHistory.tsx`**: Timeline UI showing change records for a given appointment.
- **Edit `AppointmentCalendar.tsx`**: Add a "History" button/panel on appointment detail click.

---

### 6. Copy Information Between Records

**What:** Quickly copy contact/lead/job info from one record to another.

**Changes:**
- **New component `src/components/shared/CopyRecordDataDialog.tsx`**: Dialog that lets users select a source record type (lead/contact/job), pick fields to copy, and paste into a target record. Works from lead detail, contact detail, and job detail pages.
- **Edit `src/pages/LeadDetails.tsx`**: Add "Copy From..." action button in the header actions.

---

### 7. Calendar Appointment Outcomes

**What:** Record outcomes on appointments with custom, color-coded statuses. Add "Outcomes" column to Appointments Report.

**Changes:**
- **New migration**: Create `appointment_outcome_types` table (`id, tenant_id, name, color, sort_order, active`). Add `outcome_type_id` FK column to `appointments`. Seed defaults: "Sold", "Follow-up Needed", "Not Interested", "No Show", "Rescheduled".
- **New component `src/components/settings/AppointmentOutcomeSettings.tsx`**: CRUD for managing custom outcome types with color pickers. Add to Settings.
- **Edit `src/components/scheduling/AppointmentCalendar.tsx`**: After clicking an appointment, show an "Outcome" dropdown. Display outcome as a color-coded badge on the calendar card.
- **Edit appointment reports** (if exists): Add "Outcomes" column to the Appointments Report table.

---

### Database Migrations Summary

1. `lead_custom_fields` — tenant-scoped custom field definitions
2. `smart_doc_templates.show_esign_watermark` — boolean column
3. `profiles.ical_token` — UUID for calendar feed auth
4. `appointment_history` — audit trail with auto-trigger
5. `appointment_outcome_types` — custom outcomes with colors
6. `appointments.outcome_type_id` — FK to outcome types

### Files Summary

| Action | File |
|--------|------|
| New | `src/components/settings/LeadCustomFieldsManager.tsx` |
| New | `src/components/settings/CalendarSyncSettings.tsx` |
| New | `src/components/settings/AppointmentOutcomeSettings.tsx` |
| New | `src/components/scheduling/AppointmentHistory.tsx` |
| New | `src/components/shared/CopyRecordDataDialog.tsx` |
| New | `src/components/documents/ViewNotificationBanner.tsx` |
| New | `supabase/functions/calendar-ical-feed/index.ts` |
| Edit | `src/components/scheduling/AppointmentCalendar.tsx` |
| Edit | `src/features/contacts/components/LeadForm.tsx` |
| Edit | `src/features/documents/components/SmartDocs.tsx` |
| Edit | `src/features/settings/components/Settings.tsx` |
| Edit | `src/pages/LeadDetails.tsx` |
| New | 6 SQL migrations |

