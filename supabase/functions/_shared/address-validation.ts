// Shared address validation classifier (PR #3)
// Maps a Google Address Validation API response into our internal status enum.

export type ValidationStatus =
  | 'unvalidated'
  | 'valid'
  | 'needs_review'
  | 'invalid'
  | 'override_accepted';

export interface ClassifiedAddress {
  status: ValidationStatus;
  decision_reason: string;
  formatted_address: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  locality: string | null;
  administrative_area: string | null;
  postal_code: string | null;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  place_id: string | null;
  validation_granularity: string | null;
  geocode_granularity: string | null;
  address_complete: boolean | null;
  has_inferred_components: boolean | null;
  has_replaced_components: boolean | null;
  has_spell_corrected_components: boolean | null;
  has_unconfirmed_components: boolean | null;
  missing_component_types: string[];
  unresolved_tokens: string[];
  usps_dpv_confirmation: string | null;
  is_residential: boolean | null;
  is_po_box: boolean | null;
  validation_response_id: string | null;
  suggested_components: Record<string, unknown>;
}

const PREMISE_LIKE = new Set(['PREMISE', 'SUB_PREMISE']);
const STRUCTURAL = new Set(['PREMISE', 'SUB_PREMISE', 'PREMISE_PROXIMITY']);
const REQUIRED_PRIMARY = new Set([
  'street_number',
  'route',
  'locality',
  'administrative_area_level_1',
  'postal_code',
]);

function pickComponent(components: any[] | undefined, type: string): string | null {
  if (!components) return null;
  const c = components.find((x) => x?.componentType === type);
  return c?.componentName?.text ?? null;
}

export function classifyGoogleAddressValidation(payload: any): ClassifiedAddress {
  const result = payload?.result ?? {};
  const verdict = result?.verdict ?? {};
  const address = result?.address ?? {};
  const geocode = result?.geocode ?? {};
  const metadata = result?.metadata ?? {};
  const usps = result?.uspsData ?? {};

  const components = address?.addressComponents ?? [];
  const missing: string[] = Array.isArray(address?.missingComponentTypes)
    ? address.missingComponentTypes
    : [];
  const unresolved: string[] = Array.isArray(address?.unresolvedTokens)
    ? address.unresolvedTokens
    : [];

  const validationGranularity: string | null = verdict?.validationGranularity ?? null;
  const geocodeGranularity: string | null = verdict?.geocodeGranularity ?? null;
  const addressComplete: boolean | null =
    typeof verdict?.addressComplete === 'boolean' ? verdict.addressComplete : null;
  const hasInferred = !!verdict?.hasInferredComponents;
  const hasReplaced = !!verdict?.hasReplacedComponents;
  const hasSpell = !!verdict?.hasSpellCorrectedComponents;
  const hasUnconfirmed = !!verdict?.hasUnconfirmedComponents;

  const dpv: string | null = usps?.dpvConfirmation ?? null;
  const isPoBox: boolean | null = typeof metadata?.poBox === 'boolean' ? metadata.poBox : null;
  const isResidential: boolean | null =
    typeof metadata?.residential === 'boolean' ? metadata.residential : null;

  const lat: number | null = geocode?.location?.latitude ?? null;
  const lng: number | null = geocode?.location?.longitude ?? null;
  const placeId: string | null = geocode?.placeId ?? null;
  const formatted: string | null = address?.formattedAddress ?? null;

  // Classification
  let status: ValidationStatus = 'needs_review';
  let reason = 'default_needs_review';

  const missingRequired = missing.some((m) => REQUIRED_PRIMARY.has(m));
  const hasUnresolved = unresolved.length > 0;
  const granularityIsRoute =
    !validationGranularity || ['OTHER', 'ROUTE', 'BLOCK'].includes(validationGranularity);
  const dpvFailingUS = dpv === 'N' || dpv === '';

  if (granularityIsRoute || missingRequired || hasUnresolved) {
    status = 'invalid';
    reason = granularityIsRoute
      ? `granularity_${validationGranularity ?? 'unknown'}`
      : missingRequired
        ? `missing_${missing.join(',')}`
        : `unresolved_${unresolved.join(',')}`;
  } else if (
    PREMISE_LIKE.has(validationGranularity!) &&
    addressComplete === true &&
    !hasUnconfirmed &&
    missing.length === 0 &&
    unresolved.length === 0 &&
    dpv !== 'N'
  ) {
    status = 'valid';
    reason = 'premise_complete_confirmed';
  } else if (
    STRUCTURAL.has(validationGranularity!) &&
    (hasInferred || hasReplaced || hasSpell || hasUnconfirmed || addressComplete !== true)
  ) {
    status = 'needs_review';
    reason = `structural_with_${[
      hasInferred && 'inferred',
      hasReplaced && 'replaced',
      hasSpell && 'spell_corrected',
      hasUnconfirmed && 'unconfirmed',
      addressComplete !== true && 'incomplete',
    ]
      .filter(Boolean)
      .join('+')}`;
  } else if (dpv && dpvFailingUS) {
    status = 'needs_review';
    reason = `usps_dpv_${dpv || 'empty'}`;
  }

  return {
    status,
    decision_reason: reason,
    formatted_address: formatted,
    address_line_1: pickComponent(components, 'street_number')
      ? `${pickComponent(components, 'street_number')} ${pickComponent(components, 'route') ?? ''}`.trim()
      : pickComponent(components, 'route'),
    address_line_2: pickComponent(components, 'subpremise'),
    locality: pickComponent(components, 'locality') ?? pickComponent(components, 'postal_town'),
    administrative_area: pickComponent(components, 'administrative_area_level_1'),
    postal_code: pickComponent(components, 'postal_code'),
    country_code: pickComponent(components, 'country'),
    latitude: lat,
    longitude: lng,
    place_id: placeId,
    validation_granularity: validationGranularity,
    geocode_granularity: geocodeGranularity,
    address_complete: addressComplete,
    has_inferred_components: hasInferred,
    has_replaced_components: hasReplaced,
    has_spell_corrected_components: hasSpell,
    has_unconfirmed_components: hasUnconfirmed,
    missing_component_types: missing,
    unresolved_tokens: unresolved,
    usps_dpv_confirmation: dpv,
    is_residential: isResidential,
    is_po_box: isPoBox,
    validation_response_id: payload?.responseId ?? null,
    suggested_components: { components },
  };
}

/**
 * Hard gate used by production-impacting flows
 * (lead→project conversion, measurement orders, permits, material orders).
 */
export function isProductionReady(status: ValidationStatus): boolean {
  return status === 'valid' || status === 'override_accepted';
}
