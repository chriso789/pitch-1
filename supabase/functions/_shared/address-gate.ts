// PR #3C — Shared production address gate.
// Enforce that any production-impacting flow (measurement order, permit packet,
// material delivery, production schedule) operates against a canonical
// property_addresses row with validation_status in ('valid','override_accepted').
//
// Master/owner roles may bypass the gate, but the bypass is always audit-logged
// into public.audit_log with action='measurement_address_gate_bypassed'.

import { corsHeaders } from "./cors.ts";

export type AddressGateAction =
  | "lead_to_project"
  | "measurement_order"
  | "permit_packet"
  | "material_delivery"
  | "production_schedule";

export type AddressGateSourceEntityType =
  | "project"
  | "pipeline_entry"
  | "contact"
  | "lead";

export interface RequireProductionReadyAddressInput {
  client: any; // service-role supabase client
  tenantId: string;
  sourceEntityType: AddressGateSourceEntityType;
  sourceEntityId: string;
  /** Optional secondary candidates (e.g. contact_id when source is pipeline_entry). */
  fallbackEntities?: Array<{
    sourceEntityType: AddressGateSourceEntityType;
    sourceEntityId: string;
  }>;
  requiredForAction: AddressGateAction;
  actorUserId?: string | null;
  actorRole?: string | null;
}

const ALLOWED_OVERRIDE_ROLES = [
  "sales_manager",
  "regional_manager",
  "office_admin",
  "corporate",
  "owner",
  "master",
];
const BYPASS_ROLES = new Set(["master", "owner"]);

export interface AddressGatePassResult {
  ok: true;
  bypass: boolean;
  propertyAddressId: string | null;
  validationStatus: string | null;
  addressRow: any | null;
}

export interface AddressGateFailResult {
  ok: false;
  response: Response;
  reason: string;
}

export type AddressGateResult = AddressGatePassResult | AddressGateFailResult;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function requireProductionReadyAddress(
  input: RequireProductionReadyAddressInput,
): Promise<AddressGateResult> {
  const {
    client,
    tenantId,
    sourceEntityType,
    sourceEntityId,
    fallbackEntities = [],
    requiredForAction,
    actorUserId,
    actorRole,
  } = input;

  const candidates = [
    { sourceEntityType, sourceEntityId },
    ...fallbackEntities,
  ].filter((c) => !!c?.sourceEntityId);

  const candidateIds = Array.from(new Set(candidates.map((c) => c.sourceEntityId)));

  let scoped: any[] = [];
  if (candidateIds.length > 0) {
    const { data: addrRows, error } = await client
      .from("property_addresses")
      .select(
        "id, source_entity_type, source_entity_id, validation_status, formatted_address, address_line_1, address_line_2, locality, administrative_area, postal_code, country_code, latitude, longitude, place_id, override_reason, override_accepted_at, override_accepted_by",
      )
      .eq("tenant_id", tenantId)
      .is("archived_at", null)
      .in("source_entity_id", candidateIds);

    if (error) {
      return {
        ok: false,
        reason: "lookup_failed",
        response: jsonResponse(
          {
            error: "address_gate_lookup_failed",
            code: "address_gate_lookup_failed",
            message:
              "Could not verify project address. Please retry in a moment.",
            details: error.message,
          },
          500,
        ),
      };
    }

    scoped = (addrRows ?? []).filter((r: any) =>
      candidates.some(
        (c) =>
          c.sourceEntityType === r.source_entity_type &&
          c.sourceEntityId === r.source_entity_id,
      ),
    );
  }

  const readyRow = scoped.find(
    (r) =>
      r.validation_status === "valid" ||
      r.validation_status === "override_accepted",
  );

  if (readyRow) {
    return {
      ok: true,
      bypass: false,
      propertyAddressId: readyRow.id,
      validationStatus: readyRow.validation_status,
      addressRow: readyRow,
    };
  }

  const currentRow = scoped[0] ?? null;
  const isBypassRole = !!actorRole && BYPASS_ROLES.has(actorRole);

  if (isBypassRole) {
    // Audit the bypass and let the action proceed.
    try {
      await client.from("audit_log").insert({
        tenant_id: tenantId,
        table_name: "property_addresses",
        record_id: currentRow?.id ?? sourceEntityId,
        action: "measurement_address_gate_bypassed",
        changed_by: actorUserId ?? null,
        new_values: {
          required_for_action: requiredForAction,
          source_entity_type: sourceEntityType,
          source_entity_id: sourceEntityId,
          property_address_id: currentRow?.id ?? null,
          previous_validation_status:
            currentRow?.validation_status ?? "unvalidated",
          actor_role: actorRole,
        },
      });
    } catch (_auditError) {
      // Never block production work on audit-log failure.
      console.error(
        "[address-gate] failed to write bypass audit row",
        _auditError,
      );
    }

    return {
      ok: true,
      bypass: true,
      propertyAddressId: currentRow?.id ?? null,
      validationStatus: currentRow?.validation_status ?? "unvalidated",
      addressRow: currentRow,
    };
  }

  const canOverride = !!actorRole && ALLOWED_OVERRIDE_ROLES.includes(actorRole);

  return {
    ok: false,
    reason: currentRow?.validation_status ?? "unvalidated",
    response: jsonResponse(
      {
        error: "address_validation_required",
        code: "address_validation_required",
        message:
          "A valid or manager-overridden project address is required before ordering measurements.",
        source_entity_type: sourceEntityType,
        source_entity_id: sourceEntityId,
        property_address_id: currentRow?.id ?? null,
        validation_status: currentRow?.validation_status ?? "unvalidated",
        required_for_action: requiredForAction,
        can_override: canOverride,
        allowed_override_roles: ALLOWED_OVERRIDE_ROLES,
      },
      412,
    ),
  };
}

/** Build the snapshot payload to persist with the measurement request. */
export function buildAddressSnapshot(addressRow: any | null): {
  property_address_id: string | null;
  validated_address_snapshot: Record<string, unknown> | null;
  address_validation_status_at_order: string | null;
  address_validated_at_order: string;
  address_override_reason_at_order: string | null;
} {
  if (!addressRow) {
    return {
      property_address_id: null,
      validated_address_snapshot: null,
      address_validation_status_at_order: null,
      address_validated_at_order: new Date().toISOString(),
      address_override_reason_at_order: null,
    };
  }
  return {
    property_address_id: addressRow.id ?? null,
    validated_address_snapshot: {
      formatted_address: addressRow.formatted_address ?? null,
      address_line_1: addressRow.address_line_1 ?? null,
      address_line_2: addressRow.address_line_2 ?? null,
      locality: addressRow.locality ?? null,
      administrative_area: addressRow.administrative_area ?? null,
      postal_code: addressRow.postal_code ?? null,
      country_code: addressRow.country_code ?? null,
      latitude: addressRow.latitude ?? null,
      longitude: addressRow.longitude ?? null,
      place_id: addressRow.place_id ?? null,
      validation_status: addressRow.validation_status ?? null,
    },
    address_validation_status_at_order: addressRow.validation_status ?? null,
    address_validated_at_order: new Date().toISOString(),
    address_override_reason_at_order:
      addressRow.validation_status === "override_accepted"
        ? addressRow.override_reason ?? null
        : null,
  };
}
