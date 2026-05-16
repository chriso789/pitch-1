// ============================================================
// Status badges & UI quality locks for the supplement engine.
// Pure presentation — consumes the summary from
// compare-scope-documents and renders the locks/badges.
// ============================================================

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertTriangle, FileWarning, Sparkles, ShieldCheck, Loader2 } from 'lucide-react';

export type ScopeStatusKey =
  | 'parsed'
  | 'needs_review'
  | 'reconciled'
  | 'reconciliation_warning'
  | 'ai_fallback_used'
  | 'final_report_ready';

const CONFIG: Record<ScopeStatusKey, { label: string; className: string; Icon: React.ComponentType<{ className?: string }> }> = {
  parsed: { label: 'Parsed', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200', Icon: CheckCircle2 },
  needs_review: { label: 'Needs Review', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200', Icon: AlertTriangle },
  reconciled: { label: 'Reconciled', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200', Icon: ShieldCheck },
  reconciliation_warning: { label: 'Reconciliation Warning', className: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200', Icon: FileWarning },
  ai_fallback_used: { label: 'AI Fallback Used', className: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200', Icon: Sparkles },
  final_report_ready: { label: 'Final Report Ready', className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200', Icon: CheckCircle2 },
};

export function ScopeStatusBadge({ status }: { status: ScopeStatusKey }) {
  const cfg = CONFIG[status];
  const Icon = cfg.Icon;
  return (
    <Badge className={`${cfg.className} gap-1`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}

export interface CompareSummaryLike {
  reconciliation: {
    carrier: { passed: boolean; status: 'pass' | 'warning' | 'fail' } | null;
    contractor: { passed: boolean; status: 'pass' | 'warning' | 'fail' } | null;
  };
  totals: { needs_review: number };
  blocking_reasons: string[];
  can_mark_final: boolean;
}

/**
 * Computes the statuses to display for a given compare-run summary.
 * Honours user "manual reconciliation override" via override flag.
 */
export function deriveScopeStatuses(
  summary: CompareSummaryLike | null,
  opts: { aiFallbackUsed?: boolean; manualReconciliationOverride?: boolean } = {},
): ScopeStatusKey[] {
  if (!summary) return ['parsed'];
  const statuses: ScopeStatusKey[] = ['parsed'];

  const carrierPass = summary.reconciliation.carrier?.passed ?? false;
  const contractorPass = summary.reconciliation.contractor?.passed ?? false;
  const anyWarning =
    summary.reconciliation.carrier?.status === 'warning' ||
    summary.reconciliation.contractor?.status === 'warning';

  if (carrierPass && contractorPass) statuses.push('reconciled');
  else if (anyWarning) statuses.push('reconciliation_warning');
  else statuses.push('needs_review');

  if (summary.totals.needs_review > 0) statuses.push('needs_review');
  if (opts.aiFallbackUsed) statuses.push('ai_fallback_used');

  const finalReady = summary.can_mark_final || (opts.manualReconciliationOverride && summary.totals.needs_review === 0);
  if (finalReady) statuses.push('final_report_ready');

  // dedupe
  return [...new Set(statuses)];
}

/**
 * Computes whether the "Generate Final Supplement Report" CTA is enabled.
 * Mirrors the backend `can_mark_final` plus a UI-level override.
 */
export function canGenerateFinalReport(
  summary: CompareSummaryLike | null,
  opts: { manualReconciliationOverride?: boolean } = {},
): { allowed: boolean; reasons: string[] } {
  if (!summary) return { allowed: false, reasons: ['no_compare_run'] };
  const reasons = [...summary.blocking_reasons];
  if (opts.manualReconciliationOverride) {
    return {
      allowed: reasons.every((r) => r === 'carrier_reconciliation_failed' || r === 'contractor_reconciliation_failed'),
      reasons: reasons.filter((r) => r !== 'carrier_reconciliation_failed' && r !== 'contractor_reconciliation_failed'),
    };
  }
  return { allowed: reasons.length === 0, reasons };
}

/**
 * <Loader2 className="h-3 w-3" /> kept as a re-export so callers can render
 * a loading state next to the badges without re-importing lucide.
 */
export const InlineSpinner = ({ className }: { className?: string }) => <Loader2 className={className ?? 'h-3 w-3 animate-spin'} />;
