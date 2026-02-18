

# Batch 1: Phases 25-29 Implementation

## Status Assessment

After thorough codebase analysis, Phases 19-24 are already fully implemented. The first 5 truly unimplemented phases are **25 through 29**.

---

## Phase 25: Upsell/Cross-Sell Recommendation Engine

AI-powered component that suggests add-on services (gutters, siding, solar, windows) based on property data, job type, and measurement reports.

**New files:**
- `src/features/leads/components/UpsellRecommendations.tsx` -- Card component showing AI-generated add-on suggestions with estimated value, displayed on lead/project detail pages
- Uses existing AI gateway (`ai.gateway.lovable.dev`) to analyze property data and generate recommendations
- Integrates into existing lead detail view (`src/hooks/useLeadDetails.ts` context)

**No database changes needed** -- recommendations are generated on-the-fly from existing property/measurement data.

---

## Phase 26: Subscription Maintenance Plans

Recurring annual roof inspection/maintenance plans with billing tracking.

**Database migration:**
- New `maintenance_plans` table: id, tenant_id, contact_id, project_id, plan_type, frequency (annual/semi-annual/quarterly), price, status, next_service_date, created_by, etc.
- New `maintenance_visits` table: id, plan_id, scheduled_date, completed_date, technician_id, notes, photos

**New files:**
- `src/features/projects/components/MaintenancePlanManager.tsx` -- Create/manage maintenance plans from project detail
- `src/features/projects/components/MaintenancePlanCard.tsx` -- Compact card showing plan status and next service date

---

## Phase 27: Customer Lifecycle Stage Automation

Auto-move contacts through lifecycle stages: Prospect, Lead, Customer, Repeat Customer, Advocate.

**Database migration:**
- Add `lifecycle_stage` column to contacts table (enum: prospect, lead, customer, repeat_customer, advocate)
- Add `lifecycle_updated_at` timestamp column

**New files:**
- `src/features/contacts/components/LifecycleStageIndicator.tsx` -- Visual badge showing current stage with color coding
- Automation logic added to existing `automation-processor` edge function to auto-advance stages based on events (job closed = customer, second job = repeat, review left = advocate)

---

## Phase 28: Multi-Language Proposal Support

Generate proposals in Spanish, Portuguese, and Creole using AI translation.

**New files:**
- `src/components/proposals/LanguageSelector.tsx` -- Language picker dropdown (English, Spanish, Portuguese, Creole)
- `supabase/functions/translate-proposal/index.ts` -- Edge function that takes proposal content and target language, returns translated version via AI gateway
- Integration into existing `ProposalBuilder.tsx` with a language toggle

**No database changes** -- translated content is generated on demand and stored in the existing proposal JSONB fields.

---

## Phase 29: Video Testimonial Capture

In-app video recording from homeowners with publishing to a testimonial gallery.

**Database migration:**
- New `video_testimonials` table: id, tenant_id, project_id, contact_id, video_url, thumbnail_url, duration_seconds, transcript, status (pending/approved/published), recorded_at

**New files:**
- `src/features/reviews/components/VideoTestimonialCapture.tsx` -- MediaRecorder-based video capture component with preview
- `src/features/reviews/components/TestimonialGallery.tsx` -- Grid gallery of approved testimonials for embedding in proposals
- Videos stored in Supabase Storage bucket `video-testimonials`

---

## Implementation Order

1. Phase 27 (Lifecycle Stages) -- database migration first, then UI
2. Phase 25 (Upsell Engine) -- pure frontend + AI, no DB changes
3. Phase 26 (Maintenance Plans) -- database migration + UI
4. Phase 28 (Multi-Language) -- edge function + UI integration
5. Phase 29 (Video Testimonials) -- database migration + storage + UI

## After This Batch

Remaining unimplemented phases (30, 32-35, 37-44, 46-47, 49-54, 55-66, 68-76, 78-86, 87-89, 91-94, 96-108, 110, 112-114, 116-118) will continue in subsequent batches of 5.

