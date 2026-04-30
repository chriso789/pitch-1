# ConstructionBase vs pitch-1 — Product Comparison & Roadmap

> Strategic competitive analysis. Source: internal product review, Nov 2025.

## Executive Summary

ConstructionBase markets a coherent all-in-one construction OS (CRM, takeoffs, estimating, bidding, scheduling, accounting, automation, HR/Admin). pitch-1 already implements substantial CRM/field-ops depth — lead intake/scoring, pipeline, SMS/calling, public quotes, customer portal, scheduling, dispatch, material orders, AI roof measurement, QuickBooks, Google Calendar.

The gap is **packaging, back-office breadth, and developer/compliance maturity** — not core capability. Repackage what exists into role-based hubs, then fill three gaps: **inventory control, workforce/HR/time tracking, and a public developer/integration layer.**

---

## ConstructionBase Strengths (Public Marketing)

- All-in-one packaging across sales, ops, inventory, finance, HR/Admin
- Workflow-centric CRM language: drag-drop pipeline, auto follow-up, quote versions, instant proposals
- Operations depth: scheduling, resource allocation, collaboration, automation, alerts
- Back-office: job costing, payroll, cash flow, tax/overtime, GPS time tracking, onboarding, ESS
- Trust posture: SOC 2 / ISO 27001 hosting claims, TLS/AES-256, GDPR/CCPA, AI disclaimers
- Sales-led enterprise pricing (no public pricing page)

## pitch-1 Strengths (Already Implemented)

- **CRM core**: LeadForm, score-lead, receive-lead edge function, lead scoring dashboard
- **Field sales (roofing-specific edge)**: live GPS canvassing, assigned areas, territory alerts, offline photo sync, knock/disposition workflows — **likely stronger than ConstructionBase here**
- **Scheduling/dispatch**: AppointmentCalendar, SchedulingDashboard, DispatchDashboard, CrewRouteOptimizer
- **Sales delivery**: estimate builder, public quote viewer, signature flows, branded portals
- **Ops**: material calculations/orders, async AI measurement jobs, QuickBooks worker (token refresh, rate limiting, project sync, invoice creation), SMS, AI follow-up queue
- **Communications**: unified inbox, text blasts, AI answering automation, Telnyx call center

## Feature Gap Map

| ConstructionBase Capability | pitch-1 Status | Notes |
|---|---|---|
| All-in-one packaging | Partial | Depth exists, packaging fragmented |
| CRM + pipeline + follow-ups | ✅ Strong | |
| Integrated communications | ✅ Strong | Telephony stack mixed (Twilio/Telnyx) |
| Door-to-door canvassing | ✅ Stronger than CB | Roofing-specific advantage |
| Proposals / e-sign | ✅ Strong | |
| Takeoffs + estimating | Partial | Roofing-strong; not generalized |
| Scheduling + resource allocation | Partial | No drag-drop Gantt/CPM |
| Dispatch + route optimization | ✅ | Polish gap |
| Accounting / invoicing / payments | Partial | AR + QBO good; payroll missing |
| Inventory management | Partial | No stock ledger / reorder points |
| HR / workforce / time tracking | ❌ | **Largest breadth gap** |
| Public API / developer surface | ❌ | Internal edge functions only |

---

## Roadmap

### Short-term (Now)

1. **Repackage UI into role-based hubs** — Sales / Ops / Finance / Materials / Admin. Reduce route sprawl. Files: `App.tsx`, `protectedRoutes.tsx`, sidebar/nav.
2. **Public API + webhooks layer** — Tenant-scoped API keys, HMAC-signed webhooks, OpenAPI spec, idempotency. Reuse `receive-lead` and `qbo-worker` patterns.
3. **Productize scheduling & dispatch** — Drag-drop reschedule, travel-time scoring, capacity rules, SLA alerts.
4. **Inventory-lite → real inventory ops** — SKU master, on-hand/on-order, receiving, reorder points, low-stock alerts, vendor catalogs, PO approvals.

### Mid-term

5. **Workforce / payroll-lite** — GPS clock-in/out, timesheets, PTO, job-cost-coded labor, payroll export (Gusto/Check/QBO Payroll).
6. **Unified workflow/event engine** — `workflow_templates`, `workflow_runs`, `event_bus`, `trigger_rules`. Triggers: lead created, appointment missed, proposal viewed, payment overdue, measurement completed.
7. **Analytics → decision systems** — KPI cards, funnel/cohort, rep scorecards, cycle times, margin variance, route efficiency, forecast confidence.

### Long-term

8. **Developer platform & marketplace** — OAuth apps, OpenAPI docs, SDKs, webhook explorer, marketplace listings.
9. **Generalize takeoff beyond roofing** — Connect blueprint analysis, takeoff extraction, estimating, materials into one pipeline.
10. **Enterprise compliance** — SOC 2 readiness, DPA/SCCs, formal RLS audits, signed links, field-level encryption for PII, model vendor governance.

---

## Suggested API Surface

```
POST   /v1/leads                          PATCH /v1/leads/{id}
POST   /v1/pipeline/{id}/stage
POST   /v1/measurements                   GET   /v1/measurements/{id}/report
POST   /v1/appointments/suggest           POST  /v1/appointments
POST   /v1/dispatch/routes:optimize
POST   /v1/proposals                      POST  /v1/proposals/{id}/send
POST   /v1/portal-links
POST   /v1/material-orders
GET    /v1/inventory/items                POST  /v1/inventory/receipts
POST   /v1/time-entries                   POST  /v1/payroll/export
```

**Webhooks**: `lead.created`, `lead.scored`, `measurement.completed`, `appointment.updated`, `proposal.viewed`, `proposal.signed`, `invoice.sent`, `payment.received`, `material_order.updated`

---

## UX Reframe

Stop exposing pitch-1 as a long list of pages. Expose three end-to-end journeys:

- **Acquire** — marketing, canvassing, lead capture, scoring, communications
- **Sell** — measurement, estimate, proposal, signature, scheduling
- **Deliver & Collect** — production, dispatch, materials, invoices, portal, AR

---

## Security / Compliance Priorities

- Tenant isolation audits for every new API surface
- Signed portal links + webhook signing
- SMS/calling consent capture & retention
- GPS/privacy consent for canvassing & time-tracking
- Audit logs on proposals, payments, exports
- Field-level encryption for high-sensitivity PII
- Retention/deletion workflows + admin compliance exports

## KPIs to Instrument

Lead response time · Lead→appointment rate · Show rate · Estimate turnaround · Proposal acceptance · Route miles saved/crew/day · Material variance · Stockout rate · DSO · Portal adoption · Revenue per rep/canvasser · Automation success rate · Measurement SLA & correction rate

---

*Source: ConstructionBase public site review + pitch-1 repo audit, Nov 2025.*
