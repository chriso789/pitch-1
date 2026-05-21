/**
 * Referral Analytics API
 * All functions are TENANT-scoped (the existing referral tables use tenant_id).
 * The "companyId" argument in the public signatures maps to tenant_id.
 *
 * Strategy: fetch the relevant rows once per filter set and aggregate in JS.
 * For typical contractor scale (< ~50k events per tenant) this is fast and
 * avoids new SQL views. If scale grows, replace internals with RPCs/views.
 */
import { supabase } from "@/integrations/supabase/client";
import { format, eachDayOfInterval, parseISO } from "date-fns";

export interface ReferralAnalyticsFilters {
  dateFrom?: string;
  dateTo?: string;
  campaignId?: string;
  referrerContactId?: string;
  serviceNeeded?: string;
  city?: string;
  zip?: string;
  utmSource?: string;
  utmCampaign?: string;
}

const CLICK_EVENTS = new Set(["page_view", "click", "page-view", "view", "visit"]);
const FORM_START_EVENTS = new Set(["form_start", "form-start", "form_started"]);

function applySubFilters(q: any, f: ReferralAnalyticsFilters) {
  if (f.dateFrom) q = q.gte("created_at", f.dateFrom);
  if (f.dateTo) q = q.lte("created_at", f.dateTo);
  if (f.referrerContactId) q = q.eq("referrer_contact_id", f.referrerContactId);
  if (f.serviceNeeded) q = q.eq("service_needed", f.serviceNeeded);
  if (f.city) q = q.ilike("referred_city", f.city);
  if (f.zip) q = q.eq("referred_zip", f.zip);
  if (f.utmSource) q = q.eq("utm_source", f.utmSource);
  if (f.utmCampaign) q = q.eq("utm_campaign", f.utmCampaign);
  return q;
}

function applyEventFilters(q: any, f: ReferralAnalyticsFilters) {
  if (f.dateFrom) q = q.gte("created_at", f.dateFrom);
  if (f.dateTo) q = q.lte("created_at", f.dateTo);
  if (f.referrerContactId) q = q.eq("referrer_contact_id", f.referrerContactId);
  if (f.utmSource) q = q.eq("utm_source", f.utmSource);
  if (f.utmCampaign) q = q.eq("utm_campaign", f.utmCampaign);
  return q;
}

async function fetchAll(tenantId: string, f: ReferralAnalyticsFilters) {
  let linksQ = supabase.from("referral_codes").select("*").eq("tenant_id", tenantId);
  if (f.referrerContactId) linksQ = linksQ.eq("customer_id", f.referrerContactId);

  let eventsQ = applyEventFilters(
    supabase.from("referral_events").select("*").eq("tenant_id", tenantId),
    f,
  );
  let subsQ = applySubFilters(
    supabase.from("referral_submissions").select("*").eq("tenant_id", tenantId),
    f,
  );
  let payoutsQ = supabase.from("referral_payouts").select("*").eq("tenant_id", tenantId);
  if (f.dateFrom) payoutsQ = payoutsQ.gte("created_at", f.dateFrom);
  if (f.dateTo) payoutsQ = payoutsQ.lte("created_at", f.dateTo);
  if (f.referrerContactId) payoutsQ = payoutsQ.eq("referrer_contact_id", f.referrerContactId);

  let sendsQ = supabase.from("referral_send_logs").select("*").eq("tenant_id", tenantId);
  if (f.dateFrom) sendsQ = sendsQ.gte("created_at", f.dateFrom);
  if (f.dateTo) sendsQ = sendsQ.lte("created_at", f.dateTo);
  if (f.referrerContactId) sendsQ = sendsQ.eq("referrer_contact_id", f.referrerContactId);

  const creditsQ = supabase.from("referral_credit_ledger").select("*").eq("tenant_id", tenantId);

  const [links, events, subs, payouts, sends, credits] = await Promise.all([
    linksQ, eventsQ, subsQ, payoutsQ, sendsQ, creditsQ,
  ]);

  return {
    links: links.data ?? [],
    events: events.data ?? [],
    subs: subs.data ?? [],
    payouts: payouts.data ?? [],
    sends: sends.data ?? [],
    credits: credits.data ?? [],
  };
}

// ---------- helpers ----------
function isClick(e: any) { return CLICK_EVENTS.has(e.event_type); }
function isFormStart(e: any) { return FORM_START_EVENTS.has(e.event_type); }
function num(x: any) { return Number(x || 0); }
function safeDiv(n: number, d: number): number | null {
  if (!d || d <= 0) return null;
  return n / d;
}
function sumWhere<T>(arr: T[], pred: (x: T) => boolean, getter: (x: T) => number): number {
  return arr.filter(pred).reduce((a, x) => a + num(getter(x)), 0);
}

// Compute current balance per referrer from ledger (last balance_after per contact)
function computeStoredBalances(credits: any[]): Map<string, number> {
  const sorted = [...credits].sort((a, b) =>
    String(a.created_at).localeCompare(String(b.created_at)),
  );
  const m = new Map<string, number>();
  for (const c of sorted) {
    if (c.referrer_contact_id) m.set(c.referrer_contact_id, num(c.balance_after));
  }
  return m;
}

// ---------- 1. Overview ----------
export async function getReferralAnalyticsOverview(
  tenantId: string,
  filters: ReferralAnalyticsFilters = {},
) {
  const { links, events, subs, payouts, sends, credits } = await fetchAll(tenantId, filters);

  const totalReferralLinks = links.length;
  const activeReferralLinks = links.filter((l: any) => l.is_active).length;
  const totalSends = sends.length;

  const clickEvents = events.filter(isClick);
  const totalClicks = clickEvents.length;
  const uniqueVisitors = new Set(clickEvents.map((e: any) => e.visitor_id).filter(Boolean)).size;
  const formStarts = events.filter(isFormStart).length;

  const submittedLeads = subs.length;
  const validLeads = subs.filter((s: any) => s.payout_eligible || s.status === "valid" || s.status === "sold" || s.status === "completed").length;
  const duplicateLeads = subs.filter((s: any) => s.status === "duplicate").length;
  const invalidLeads = subs.filter((s: any) => ["invalid", "rejected", "spam"].includes(s.status)).length;
  const appointmentSet = subs.filter((s: any) => s.appointment_completed_at || s.status === "appointment_set").length;
  const estimatesSent = subs.filter((s: any) => s.status === "estimate_sent" || num(s.estimated_value) > 0).length;
  const soldReferrals = subs.filter((s: any) => s.status === "sold" || s.sold_at).length;
  const completedReferrals = subs.filter((s: any) => s.status === "completed" || s.completed_at).length;

  const collectedRevenue = sumWhere(subs, () => true, (s: any) => s.collected_revenue);
  const soldRevenue = sumWhere(subs, () => true, (s: any) => s.sold_value || s.estimated_value);

  const pendingPayouts = sumWhere(payouts, (p: any) => p.payout_status === "pending", (p: any) => p.payout_amount);
  const approvedPayouts = sumWhere(payouts, (p: any) => p.payout_status === "approved", (p: any) => p.payout_amount);
  const paidPayouts = sumWhere(payouts, (p: any) => p.payout_status === "paid", (p: any) => p.payout_amount);

  const balances = computeStoredBalances(credits);
  const storedCreditOutstanding = Array.from(balances.values()).reduce((a, b) => a + b, 0);
  const storedCreditEarned = sumWhere(credits, (c: any) => c.transaction_type === "credit_earned", (c: any) => c.amount);

  const payoutCost = paidPayouts + approvedPayouts + storedCreditEarned;
  const referralRoi = safeDiv(collectedRevenue - payoutCost, payoutCost);
  const costPerSoldReferral = safeDiv(payoutCost, soldReferrals);

  return {
    totalReferralLinks,
    activeReferralLinks,
    totalSends,
    totalClicks,
    uniqueVisitors,
    formStarts,
    submittedLeads,
    validLeads,
    duplicateLeads,
    invalidLeads,
    appointmentSet,
    estimatesSent,
    soldReferrals,
    completedReferrals,
    collectedRevenue,
    soldRevenue,
    pendingPayouts,
    approvedPayouts,
    paidPayouts,
    storedCreditOutstanding,
    storedCreditEarned,
    visitorToLeadRate: safeDiv(submittedLeads, uniqueVisitors),
    leadToSoldRate: safeDiv(soldReferrals, submittedLeads),
    leadToCompletedRate: safeDiv(completedReferrals, submittedLeads),
    revenuePerLead: safeDiv(collectedRevenue, submittedLeads),
    payoutCost,
    costPerSoldReferral,
    referralRoi,
  };
}

// ---------- 2. Funnel ----------
export async function getReferralFunnel(tenantId: string, filters: ReferralAnalyticsFilters = {}) {
  const o = await getReferralAnalyticsOverview(tenantId, filters);
  return [
    { stage: "Referral Links Created", count: o.totalReferralLinks },
    { stage: "Referral Links Sent", count: o.totalSends },
    { stage: "Page Visits", count: o.totalClicks },
    { stage: "Form Starts", count: o.formStarts },
    { stage: "Referral Leads Submitted", count: o.submittedLeads },
    { stage: "Appointments Set", count: o.appointmentSet },
    { stage: "Estimates Sent", count: o.estimatesSent },
    { stage: "Sold Referrals", count: o.soldReferrals },
    { stage: "Paid / Completed", count: o.completedReferrals },
    { stage: "Rewards Approved", count: Math.round(o.approvedPayouts > 0 ? 1 : 0) }, // placeholder count by amount not available; we'll show payout count below
  ];
}

// ---------- 3. Time series ----------
export async function getReferralTimeSeries(tenantId: string, filters: ReferralAnalyticsFilters = {}) {
  const { events, subs, payouts } = await fetchAll(tenantId, filters);

  const from = filters.dateFrom ? parseISO(filters.dateFrom) : new Date(Date.now() - 90 * 86400000);
  const to = filters.dateTo ? parseISO(filters.dateTo) : new Date();
  const days = eachDayOfInterval({ start: from, end: to });

  const rows = days.map((d) => ({
    date: format(d, "yyyy-MM-dd"),
    clicks: 0,
    uniqueVisitors: 0,
    formStarts: 0,
    submittedLeads: 0,
    soldReferrals: 0,
    completedReferrals: 0,
    collectedRevenue: 0,
    payoutsApproved: 0,
    payoutsPaid: 0,
  }));
  const idx = new Map(rows.map((r, i) => [r.date, i]));
  const visitorsByDay = new Map<string, Set<string>>();

  for (const e of events) {
    const k = format(new Date(e.created_at), "yyyy-MM-dd");
    const i = idx.get(k); if (i === undefined) continue;
    if (isClick(e)) rows[i].clicks += 1;
    if (isFormStart(e)) rows[i].formStarts += 1;
    if (e.visitor_id) {
      if (!visitorsByDay.has(k)) visitorsByDay.set(k, new Set());
      visitorsByDay.get(k)!.add(e.visitor_id);
    }
  }
  for (const [k, s] of visitorsByDay) {
    const i = idx.get(k); if (i !== undefined) rows[i].uniqueVisitors = s.size;
  }
  for (const s of subs) {
    const k = format(new Date(s.created_at), "yyyy-MM-dd");
    const i = idx.get(k); if (i === undefined) continue;
    rows[i].submittedLeads += 1;
    if (s.status === "sold" || s.sold_at) rows[i].soldReferrals += 1;
    if (s.status === "completed" || s.completed_at) rows[i].completedReferrals += 1;
    rows[i].collectedRevenue += num(s.collected_revenue);
  }
  for (const p of payouts) {
    const ap = p.approved_at, pd = p.paid_at;
    if (ap) {
      const i = idx.get(format(new Date(ap), "yyyy-MM-dd"));
      if (i !== undefined) rows[i].payoutsApproved += num(p.payout_amount);
    }
    if (pd) {
      const i = idx.get(format(new Date(pd), "yyyy-MM-dd"));
      if (i !== undefined) rows[i].payoutsPaid += num(p.payout_amount);
    }
  }
  return rows;
}

// ---------- 4. Top referrers ----------
export async function getTopReferrers(tenantId: string, filters: ReferralAnalyticsFilters = {}) {
  const { links, events, subs, payouts, sends, credits } = await fetchAll(tenantId, filters);
  const balances = computeStoredBalances(credits);

  const ids = new Set<string>();
  links.forEach((l: any) => l.customer_id && ids.add(l.customer_id));
  subs.forEach((s: any) => s.referrer_contact_id && ids.add(s.referrer_contact_id));
  events.forEach((e: any) => e.referrer_contact_id && ids.add(e.referrer_contact_id));

  // resolve contact names
  let nameById = new Map<string, string>();
  if (ids.size > 0) {
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, first_name, last_name")
      .in("id", Array.from(ids));
    for (const c of contacts ?? []) {
      nameById.set(c.id, `${c.first_name || ""} ${c.last_name || ""}`.trim() || "(no name)");
    }
  }

  const byContact = new Map<string, any>();
  function ensure(id: string) {
    if (!byContact.has(id)) {
      byContact.set(id, {
        referrerContactId: id,
        referrerName: nameById.get(id) || "(unknown)",
        referralLinks: 0, sends: 0, clicks: 0, submittedLeads: 0,
        soldReferrals: 0, completedReferrals: 0,
        soldRevenue: 0, collectedRevenue: 0,
        pendingPayouts: 0, paidOrStoredRewards: 0,
        storedCreditBalance: balances.get(id) || 0,
        conversionRate: null as number | null, roi: null as number | null,
        _payoutCost: 0,
      });
    }
    return byContact.get(id);
  }

  for (const l of links) if (l.customer_id) ensure(l.customer_id).referralLinks += 1;
  for (const s of sends) if (s.referrer_contact_id) ensure(s.referrer_contact_id).sends += 1;
  for (const e of events) {
    if (!e.referrer_contact_id || !isClick(e)) continue;
    ensure(e.referrer_contact_id).clicks += 1;
  }
  for (const s of subs) {
    if (!s.referrer_contact_id) continue;
    const r = ensure(s.referrer_contact_id);
    r.submittedLeads += 1;
    if (s.status === "sold" || s.sold_at) r.soldReferrals += 1;
    if (s.status === "completed" || s.completed_at) r.completedReferrals += 1;
    r.soldRevenue += num(s.sold_value || s.estimated_value);
    r.collectedRevenue += num(s.collected_revenue);
  }
  for (const p of payouts) {
    if (!p.referrer_contact_id) continue;
    const r = ensure(p.referrer_contact_id);
    if (p.payout_status === "pending") r.pendingPayouts += num(p.payout_amount);
    if (["paid", "stored_balance", "stored"].includes(p.payout_status)) r.paidOrStoredRewards += num(p.payout_amount);
    if (["paid", "approved"].includes(p.payout_status)) r._payoutCost += num(p.payout_amount);
  }
  for (const c of credits) {
    if (c.transaction_type === "credit_earned" && c.referrer_contact_id) {
      ensure(c.referrer_contact_id)._payoutCost += num(c.amount);
    }
  }

  return Array.from(byContact.values()).map((r) => ({
    ...r,
    conversionRate: safeDiv(r.soldReferrals, r.submittedLeads),
    roi: safeDiv(r.collectedRevenue - r._payoutCost, r._payoutCost),
  })).sort((a, b) => b.collectedRevenue - a.collectedRevenue || b.soldReferrals - a.soldReferrals);
}

// ---------- 5. Source breakdown (UTM) ----------
export async function getReferralSourceBreakdown(tenantId: string, filters: ReferralAnalyticsFilters = {}) {
  const { events, subs } = await fetchAll(tenantId, filters);
  const map = new Map<string, any>();
  const key = (src: any, med: any, camp: any) =>
    `${src || "(direct)"}||${med || ""}||${camp || ""}`;

  for (const e of events) {
    if (!isClick(e)) continue;
    const k = key(e.utm_source, e.utm_medium, e.utm_campaign);
    if (!map.has(k)) map.set(k, {
      source: e.utm_source || "(direct)", medium: e.utm_medium || "", campaign: e.utm_campaign || "",
      clicks: 0, submittedLeads: 0, soldReferrals: 0, collectedRevenue: 0, payoutCost: 0, roi: null,
    });
    map.get(k).clicks += 1;
  }
  for (const s of subs) {
    const k = key(s.utm_source, s.utm_medium, s.utm_campaign);
    if (!map.has(k)) map.set(k, {
      source: s.utm_source || "(direct)", medium: s.utm_medium || "", campaign: s.utm_campaign || "",
      clicks: 0, submittedLeads: 0, soldReferrals: 0, collectedRevenue: 0, payoutCost: 0, roi: null,
    });
    const r = map.get(k);
    r.submittedLeads += 1;
    if (s.status === "sold" || s.sold_at) r.soldReferrals += 1;
    r.collectedRevenue += num(s.collected_revenue);
  }
  return Array.from(map.values()).map((r) => ({
    ...r, roi: safeDiv(r.collectedRevenue - r.payoutCost, r.payoutCost),
  })).sort((a, b) => b.clicks - a.clicks);
}

// ---------- 6. Geo breakdown ----------
export async function getReferralGeoBreakdown(tenantId: string, filters: ReferralAnalyticsFilters = {}) {
  const { subs } = await fetchAll(tenantId, filters);
  const map = new Map<string, any>();
  for (const s of subs) {
    const k = `${s.referred_city || ""}||${s.referred_state || ""}||${s.referred_zip || ""}`;
    if (!map.has(k)) map.set(k, {
      city: s.referred_city || "", state: s.referred_state || "", zip: s.referred_zip || "",
      submittedLeads: 0, soldReferrals: 0, completedReferrals: 0,
      collectedRevenue: 0, payoutCost: 0, roi: null,
    });
    const r = map.get(k);
    r.submittedLeads += 1;
    if (s.status === "sold" || s.sold_at) r.soldReferrals += 1;
    if (s.status === "completed" || s.completed_at) r.completedReferrals += 1;
    r.collectedRevenue += num(s.collected_revenue);
  }
  return Array.from(map.values()).map((r) => ({
    ...r, roi: safeDiv(r.collectedRevenue - r.payoutCost, r.payoutCost),
  })).sort((a, b) => b.submittedLeads - a.submittedLeads);
}

// ---------- 7. Service breakdown ----------
export async function getReferralServiceBreakdown(tenantId: string, filters: ReferralAnalyticsFilters = {}) {
  const { subs } = await fetchAll(tenantId, filters);
  const map = new Map<string, any>();
  for (const s of subs) {
    const k = `${s.service_needed || ""}||${s.roof_type_interest || ""}||${s.project_type || ""}`;
    if (!map.has(k)) map.set(k, {
      serviceNeeded: s.service_needed || "(unknown)",
      roofTypeInterest: s.roof_type_interest || "",
      projectType: s.project_type || "",
      submittedLeads: 0, soldReferrals: 0, completedReferrals: 0,
      collectedRevenue: 0, payoutCost: 0, conversionRate: null, roi: null,
    });
    const r = map.get(k);
    r.submittedLeads += 1;
    if (s.status === "sold" || s.sold_at) r.soldReferrals += 1;
    if (s.status === "completed" || s.completed_at) r.completedReferrals += 1;
    r.collectedRevenue += num(s.collected_revenue);
  }
  return Array.from(map.values()).map((r) => ({
    ...r,
    conversionRate: safeDiv(r.soldReferrals, r.submittedLeads),
    roi: safeDiv(r.collectedRevenue - r.payoutCost, r.payoutCost),
  })).sort((a, b) => b.submittedLeads - a.submittedLeads);
}

// ---------- 8. Payout report ----------
export async function getReferralPayoutReport(tenantId: string, filters: ReferralAnalyticsFilters = {}) {
  let q = supabase.from("referral_payouts").select("*").eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (filters.dateFrom) q = q.gte("created_at", filters.dateFrom);
  if (filters.dateTo) q = q.lte("created_at", filters.dateTo);
  if (filters.referrerContactId) q = q.eq("referrer_contact_id", filters.referrerContactId);
  const { data: payouts } = await q;
  const list = payouts ?? [];

  const ids = new Set<string>();
  list.forEach((p: any) => {
    if (p.referrer_contact_id) ids.add(p.referrer_contact_id);
  });
  const subIds = list.map((p: any) => p.referral_submission_id).filter(Boolean);

  const [contactsRes, subsRes] = await Promise.all([
    ids.size ? supabase.from("contacts").select("id, first_name, last_name").in("id", Array.from(ids)) : Promise.resolve({ data: [] as any[] }),
    subIds.length ? supabase.from("referral_submissions").select("id, referred_first_name, referred_last_name").in("id", subIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const nameById = new Map<string, string>();
  for (const c of (contactsRes.data ?? [])) nameById.set(c.id, `${c.first_name || ""} ${c.last_name || ""}`.trim() || "(no name)");
  const leadById = new Map<string, string>();
  for (const s of (subsRes.data ?? [])) leadById.set(s.id, `${s.referred_first_name || ""} ${s.referred_last_name || ""}`.trim() || "(no name)");

  return list.map((p: any) => ({
    payoutId: p.id,
    referrerName: nameById.get(p.referrer_contact_id) || "(unknown)",
    referredLeadName: leadById.get(p.referral_submission_id) || "(unknown)",
    payoutMethod: p.payout_method,
    payoutAmount: num(p.payout_amount),
    payoutStatus: p.payout_status,
    approvedAt: p.approved_at,
    paidAt: p.paid_at,
    paymentReference: p.payment_reference,
    notes: p.notes,
  }));
}

// ---------- 9. Stored credit report ----------
export async function getReferralStoredCreditReport(tenantId: string, _filters: ReferralAnalyticsFilters = {}) {
  const { data: credits } = await supabase
    .from("referral_credit_ledger").select("*").eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });
  const list = credits ?? [];
  const byContact = new Map<string, any>();
  for (const c of list) {
    if (!c.referrer_contact_id) continue;
    if (!byContact.has(c.referrer_contact_id)) {
      byContact.set(c.referrer_contact_id, {
        referrerContactId: c.referrer_contact_id, referrerName: "(unknown)",
        currentBalance: 0, totalEarned: 0, totalUsed: 0, totalAdjusted: 0, totalExpired: 0,
        lastActivityAt: null as string | null,
      });
    }
    const r = byContact.get(c.referrer_contact_id);
    r.currentBalance = num(c.balance_after);
    if (c.transaction_type === "credit_earned") r.totalEarned += num(c.amount);
    if (c.transaction_type === "credit_used") r.totalUsed += Math.abs(num(c.amount));
    if (c.transaction_type === "credit_adjustment") r.totalAdjusted += num(c.amount);
    if (c.transaction_type === "credit_expired") r.totalExpired += Math.abs(num(c.amount));
    if (!r.lastActivityAt || String(c.created_at) > String(r.lastActivityAt)) r.lastActivityAt = c.created_at;
  }
  const ids = Array.from(byContact.keys());
  if (ids.length) {
    const { data: contacts } = await supabase
      .from("contacts").select("id, first_name, last_name").in("id", ids);
    for (const c of contacts ?? []) {
      const r = byContact.get(c.id);
      if (r) r.referrerName = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "(no name)";
    }
  }
  return Array.from(byContact.values()).sort((a, b) => b.currentBalance - a.currentBalance);
}

// ---------- Payout accounting (group by status / method / month) ----------
export async function getReferralPayoutAccounting(tenantId: string, filters: ReferralAnalyticsFilters = {}) {
  const rows = await getReferralPayoutReport(tenantId, filters);
  const byMonth = new Map<string, any>();
  const byStatus: Record<string, number> = {};
  const byMethod: Record<string, number> = {};
  for (const r of rows) {
    const m = r.approvedAt || r.paidAt ? format(new Date(r.approvedAt || r.paidAt), "yyyy-MM") : "unscheduled";
    if (!byMonth.has(m)) byMonth.set(m, { month: m, pending: 0, approved: 0, paid: 0, stored: 0, rejected: 0 });
    const b = byMonth.get(m);
    if (r.payoutStatus === "pending") b.pending += r.payoutAmount;
    if (r.payoutStatus === "approved") b.approved += r.payoutAmount;
    if (r.payoutStatus === "paid") b.paid += r.payoutAmount;
    if (["stored_balance", "stored"].includes(r.payoutStatus)) b.stored += r.payoutAmount;
    if (r.payoutStatus === "rejected") b.rejected += r.payoutAmount;
    byStatus[r.payoutStatus] = (byStatus[r.payoutStatus] || 0) + r.payoutAmount;
    byMethod[r.payoutMethod || "(none)"] = (byMethod[r.payoutMethod || "(none)"] || 0) + r.payoutAmount;
  }
  return {
    byMonth: Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month)),
    byStatus, byMethod, rows,
  };
}
