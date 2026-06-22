// PR #3B — Project Address Panel + Address Readiness Badge.
// Reads canonical `property_addresses` for the project (with idempotent
// hydration from the linked pipeline_entry), shows a status badge, and
// exposes Validate / Fix / Override / History actions backed by the
// reusable AddressValidationResolutionModal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  MapPin,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  History,
  Loader2,
  Pencil,
} from 'lucide-react';
import {
  AddressValidationResolutionModal,
  type AddressGateAction,
} from './AddressValidationResolutionModal';
import type { AddressValidationStatus } from '@/hooks/useAddressValidation';
import { toast } from 'sonner';

const MANAGER_ROLES = [
  'master',
  'owner',
  'corporate',
  'office_admin',
  'regional_manager',
  'sales_manager',
];

interface ProjectAddressRow {
  id: string;
  source_entity_type: string;
  source_entity_id: string;
  validation_status: AddressValidationStatus | null;
  formatted_address: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  locality: string | null;
  administrative_area: string | null;
  postal_code: string | null;
  country_code: string | null;
  override_reason: string | null;
  override_by: string | null;
  override_at: string | null;
  missing_component_types: string[] | null;
  decision_reason: string | null;
  updated_at: string | null;
}

interface HistoryRow {
  id: string;
  previous_status: string | null;
  next_status: string | null;
  reason: string | null;
  changed_by: string | null;
  source: string | null;
  created_at: string;
}

export interface ProjectAddressPanelProps {
  tenantId: string;
  pipelineEntryId: string;
  /** Cached/legacy address from the lead/contact, used as the panel fallback display. */
  fallbackAddress?: {
    address_line_1?: string | null;
    address_line_2?: string | null;
    locality?: string | null;
    administrative_area?: string | null;
    postal_code?: string | null;
    country_code?: string | null;
  };
  className?: string;
}

const STATUS_META: Record<
  AddressValidationStatus | 'missing',
  {
    label: string;
    description: string;
    badgeClass: string;
    Icon: typeof CheckCircle2;
  }
> = {
  valid: {
    label: 'Validated',
    description: 'Ready for measurement, permits, materials, and scheduling.',
    badgeClass: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30',
    Icon: CheckCircle2,
  },
  override_accepted: {
    label: 'Override Accepted',
    description: 'Manager override accepted. Reason and audit history available.',
    badgeClass: 'bg-blue-500/10 text-blue-700 border-blue-500/30',
    Icon: ShieldCheck,
  },
  needs_review: {
    label: 'Needs Review',
    description:
      'Address has a suggestion or missing/inferred component. Review before production.',
    badgeClass: 'bg-amber-500/10 text-amber-700 border-amber-500/30',
    Icon: AlertTriangle,
  },
  invalid: {
    label: 'Invalid',
    description:
      'Production actions are blocked until corrected or manager-overridden.',
    badgeClass: 'bg-red-500/10 text-red-700 border-red-500/30',
    Icon: AlertTriangle,
  },
  unvalidated: {
    label: 'Unvalidated',
    description:
      'Validate this address before ordering measurements or scheduling work.',
    badgeClass: 'bg-muted text-muted-foreground border-border',
    Icon: HelpCircle,
  },
  missing: {
    label: 'No Address',
    description: 'Add a property address to enable measurements, permits, and scheduling.',
    badgeClass: 'bg-muted text-muted-foreground border-border',
    Icon: HelpCircle,
  },
};

export function ProjectAddressPanel({
  tenantId,
  pipelineEntryId,
  fallbackAddress,
  className,
}: ProjectAddressPanelProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [hydrating, setHydrating] = useState(false);
  const [row, setRow] = useState<ProjectAddressRow | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalAction, setModalAction] = useState<AddressGateAction>('lead_to_project');
  const [forceOverride, setForceOverride] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const isManager = useMemo(
    () => !!role && MANAGER_ROLES.includes(role),
    [role],
  );

  const loadRow = useCallback(async () => {
    setLoading(true);
    try {
      // Resolve project id from pipeline entry (if converted)
      const { data: project } = await supabase
        .from('projects')
        .select('id')
        .eq('pipeline_entry_id', pipelineEntryId)
        .maybeSingle();
      const resolvedProjectId = (project?.id as string | undefined) ?? null;
      setProjectId(resolvedProjectId);

      // Prefer project-level address if we have a project
      let active: ProjectAddressRow | null = null;
      if (resolvedProjectId) {
        const { data } = await supabase
          .from('property_addresses')
          .select(
            'id, source_entity_type, source_entity_id, validation_status, formatted_address, address_line_1, address_line_2, locality, administrative_area, postal_code, country_code, override_reason, override_by, override_at, missing_component_types, decision_reason, updated_at',
          )
          .eq('tenant_id', tenantId)
          .eq('source_entity_type', 'project')
          .eq('source_entity_id', resolvedProjectId)
          .is('archived_at', null)
          .order('updated_at', { ascending: false })
          .maybeSingle();
        active = (data as ProjectAddressRow | null) ?? null;
      }

      // Fallback to pipeline_entry-level address
      if (!active) {
        const { data } = await supabase
          .from('property_addresses')
          .select(
            'id, source_entity_type, source_entity_id, validation_status, formatted_address, address_line_1, address_line_2, locality, administrative_area, postal_code, country_code, override_reason, override_by, override_at, missing_component_types, decision_reason, updated_at',
          )
          .eq('tenant_id', tenantId)
          .eq('source_entity_type', 'pipeline_entry')
          .eq('source_entity_id', pipelineEntryId)
          .is('archived_at', null)
          .order('updated_at', { ascending: false })
          .maybeSingle();
        active = (data as ProjectAddressRow | null) ?? null;
      }

      setRow(active);
    } finally {
      setLoading(false);
    }
  }, [tenantId, pipelineEntryId]);

  useEffect(() => {
    void loadRow();
  }, [loadRow]);

  // Load user role for override gating
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      if (!cancelled) setRole((data?.role as string) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Idempotent one-time hydrate from pipeline_entry → project when converted
  useEffect(() => {
    if (loading || hydrating) return;
    if (!projectId) return;
    if (!row) return;
    if (row.source_entity_type === 'project') return;
    if (row.source_entity_type !== 'pipeline_entry') return;

    const hydrate = async () => {
      setHydrating(true);
      try {
        // Re-check there isn't already a project-level row (race-safe)
        const { data: existing } = await supabase
          .from('property_addresses')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('source_entity_type', 'project')
          .eq('source_entity_id', projectId)
          .is('archived_at', null)
          .maybeSingle();
        if (existing?.id) {
          await loadRow();
          return;
        }

        const payload = {
          tenant_id: tenantId,
          source_entity_type: 'project' as const,
          source_entity_id: projectId,
          address_line_1: row.address_line_1,
          address_line_2: row.address_line_2,
          locality: row.locality,
          administrative_area: row.administrative_area,
          postal_code: row.postal_code,
          country_code: row.country_code ?? 'US',
          formatted_address: row.formatted_address,
          validation_status: row.validation_status ?? 'unvalidated',
        };
        const { error } = await supabase.from('property_addresses').insert(payload);
        if (error) {
          console.warn('[ProjectAddressPanel] hydrate failed', error);
        }
        await loadRow();
      } finally {
        setHydrating(false);
      }
    };
    void hydrate();
  }, [loading, hydrating, projectId, row, tenantId, loadRow]);

  const openValidate = (action: AddressGateAction = 'lead_to_project') => {
    setModalAction(action);
    setForceOverride(false);
    setModalOpen(true);
  };
  const openOverride = () => {
    if (!isManager) {
      toast.error('Manager role required to override address validation.');
      return;
    }
    setModalAction('lead_to_project');
    setForceOverride(true);
    setModalOpen(true);
  };

  const openHistory = async () => {
    if (!row) return;
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from('property_address_validation_history')
        .select('id, previous_status, next_status, reason, changed_by, source, created_at')
        .eq('property_address_id', row.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setHistory((data ?? []) as HistoryRow[]);
    } catch (e: any) {
      toast.error(`Failed to load history: ${e.message ?? e}`);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Source entity used by the modal — project if available, else pipeline_entry.
  const modalSourceType: 'project' | 'pipeline_entry' = projectId
    ? 'project'
    : 'pipeline_entry';
  const modalSourceId = projectId ?? pipelineEntryId;

  const statusKey: AddressValidationStatus | 'missing' = row?.validation_status
    ? row.validation_status
    : row
    ? 'unvalidated'
    : 'missing';
  const meta = STATUS_META[statusKey];
  const StatusIcon = meta.Icon;

  const isReady = statusKey === 'valid' || statusKey === 'override_accepted';

  const displayLines = (() => {
    if (row?.formatted_address) return [row.formatted_address];
    const built = [
      row?.address_line_1 ?? fallbackAddress?.address_line_1,
      row?.address_line_2 ?? fallbackAddress?.address_line_2,
      [
        row?.locality ?? fallbackAddress?.locality,
        row?.administrative_area ?? fallbackAddress?.administrative_area,
        row?.postal_code ?? fallbackAddress?.postal_code,
      ]
        .filter(Boolean)
        .join(', '),
    ].filter((s) => s && String(s).trim());
    return built as string[];
  })();

  const showLegacyNotice = !row && !!fallbackAddress;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4 text-primary" />
            Property Address
          </CardTitle>
          <Badge variant="outline" className={meta.badgeClass}>
            <StatusIcon className="h-3 w-3 mr-1" />
            {meta.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading address…
          </div>
        ) : (
          <>
            {displayLines.length > 0 ? (
              <div className="text-sm">
                {displayLines.map((line, i) => (
                  <div key={i} className="break-words">
                    {line}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic">
                No address recorded for this project yet.
              </div>
            )}

            <p className="text-xs text-muted-foreground">{meta.description}</p>

            {showLegacyNotice && (
              <p className="text-xs text-muted-foreground italic">
                Showing cached lead address. Validate to promote it to the canonical project address.
              </p>
            )}

            {statusKey === 'override_accepted' && row && (
              <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2 text-xs space-y-1">
                <div className="flex items-center gap-1 font-medium text-blue-800">
                  <ShieldCheck className="h-3 w-3" /> Override on file
                </div>
                {row.override_reason && (
                  <div className="text-foreground/80">
                    <span className="text-muted-foreground">Reason:</span> {row.override_reason}
                  </div>
                )}
                {row.override_at && (
                  <div className="text-muted-foreground">
                    {new Date(row.override_at).toLocaleString()}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {!isReady && statusKey !== 'missing' && (
                <Button size="sm" onClick={() => openValidate()}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                  {statusKey === 'needs_review' ? 'Review Suggestion' : 'Validate Address'}
                </Button>
              )}
              {statusKey === 'missing' && (
                <Button size="sm" onClick={() => openValidate()}>
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Add &amp; Validate
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => openValidate()}>
                <Pencil className="h-3.5 w-3.5 mr-1" />
                {isReady ? 'Edit &amp; Revalidate' : 'Edit'}
              </Button>
              {!isReady && statusKey !== 'missing' && isManager && (
                <Button size="sm" variant="secondary" onClick={openOverride}>
                  <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Manager Override
                </Button>
              )}
              {!isReady && statusKey !== 'missing' && !isManager && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    toast.message('Override requires a manager. Request manager review.')
                  }
                >
                  Request Manager Override
                </Button>
              )}
              {row && (
                <Button size="sm" variant="ghost" onClick={openHistory}>
                  <History className="h-3.5 w-3.5 mr-1" /> History
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>

      {modalOpen && (
        <AddressValidationResolutionModal
          open={modalOpen}
          tenantId={tenantId}
          sourceEntityType={modalSourceType}
          sourceEntityId={modalSourceId}
          initialAddress={{
            address_line_1: row?.address_line_1 ?? fallbackAddress?.address_line_1 ?? null,
            address_line_2: row?.address_line_2 ?? fallbackAddress?.address_line_2 ?? null,
            locality: row?.locality ?? fallbackAddress?.locality ?? null,
            administrative_area:
              row?.administrative_area ?? fallbackAddress?.administrative_area ?? null,
            postal_code: row?.postal_code ?? fallbackAddress?.postal_code ?? null,
            country_code: row?.country_code ?? fallbackAddress?.country_code ?? 'US',
          }}
          gateReason={
            forceOverride
              ? 'Manager override: record a reason to mark this address acceptable for production actions.'
              : 'Validate or correct the project address before measurement, permit, material, or scheduling actions.'
          }
          requiredForAction={modalAction}
          canOverride={forceOverride ? true : isManager}
          onCancel={() => setModalOpen(false)}
          onResolved={async () => {
            setModalOpen(false);
            await loadRow();
          }}
        />
      )}

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Address validation history</DialogTitle>
            <DialogDescription>
              Audit trail of validation, review, and override events for this address.
            </DialogDescription>
          </DialogHeader>
          {historyLoading ? (
            <div className="py-6 flex items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3">No history yet.</p>
          ) : (
            <ul className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
              {history.map((h) => (
                <li key={h.id} className="border rounded-md p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {(h.previous_status ?? '—')} → {h.next_status ?? '—'}
                    </span>
                    <span className="text-muted-foreground">
                      {new Date(h.created_at).toLocaleString()}
                    </span>
                  </div>
                  {h.reason && <div className="mt-1">{h.reason}</div>}
                  <div className="mt-1 text-muted-foreground">
                    Source: {h.source ?? 'n/a'}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default ProjectAddressPanel;
