/**
 * Maps free-form CRM status strings (from pipeline_entries.status,
 * pipeline_stages.name, jobs.status, projects.status) into the canonical
 * 9 referral submission statuses + 4 job buckets.
 *
 * Matching is intentionally loose (substring, case-insensitive). Order matters:
 * the first map whose patterns match wins. When nothing matches we fall back
 * to "new" for leads and leave job buckets undefined.
 */

export type ReferralSubmissionStatus =
  | "new"
  | "contacted"
  | "appointment_set"
  | "estimate_sent"
  | "sold"
  | "completed"
  | "rejected"
  | "duplicate"
  | "invalid";

export type ReferralJobBucket = "sold" | "completed" | "cancelled" | "paid";

// Order matters — most specific buckets first.
export const REFERRAL_LEAD_STATUS_MAP: Record<ReferralSubmissionStatus, string[]> = {
  rejected: ["reject", "lost", "dead", "disqualif", "no sale", "not interested"],
  duplicate: ["duplicate", "dupe"],
  invalid: ["invalid", "spam", "fake"],
  completed: ["complete", "closed won", "won", "finished", "done", "installed"],
  sold: ["sold", "signed", "contract", "approved", "deposit"],
  estimate_sent: ["estimate", "quote", "proposal", "bid", "sent"],
  appointment_set: ["appointment", "appt", "scheduled", "inspection", "demo"],
  contacted: ["contacted", "follow", "in progress", "qualifying", "working", "nurtur"],
  new: ["new", "lead", "fresh", "open", "incoming"],
};

export const REFERRAL_JOB_STATUS_MAP: Record<ReferralJobBucket, string[]> = {
  cancelled: ["cancel", "void", "rescind"],
  paid: ["paid", "payment received", "fully paid"],
  completed: ["complete", "closed", "finished", "done", "installed"],
  sold: ["sold", "signed", "contract", "approved", "deposit", "active", "in progress", "production"],
};

const norm = (s: string | null | undefined) => (s || "").toString().toLowerCase().trim();

export function mapLeadStatus(
  raw: string | null | undefined,
  fallback: ReferralSubmissionStatus = "new",
): ReferralSubmissionStatus {
  const v = norm(raw);
  if (!v) return fallback;
  for (const [bucket, patterns] of Object.entries(REFERRAL_LEAD_STATUS_MAP) as [
    ReferralSubmissionStatus,
    string[],
  ][]) {
    if (patterns.some((p) => v.includes(p))) return bucket;
  }
  return fallback;
}

export function mapJobStatus(raw: string | null | undefined): ReferralJobBucket | null {
  const v = norm(raw);
  if (!v) return null;
  for (const [bucket, patterns] of Object.entries(REFERRAL_JOB_STATUS_MAP) as [
    ReferralJobBucket,
    string[],
  ][]) {
    if (patterns.some((p) => v.includes(p))) return bucket;
  }
  return null;
}

/** Convert a job bucket to its corresponding referral submission status. */
export function jobBucketToSubmissionStatus(
  bucket: ReferralJobBucket | null,
  current: ReferralSubmissionStatus,
): ReferralSubmissionStatus {
  if (!bucket) return current;
  if (bucket === "cancelled") return "rejected";
  if (bucket === "paid" || bucket === "completed") return "completed";
  if (bucket === "sold") return "sold";
  return current;
}
