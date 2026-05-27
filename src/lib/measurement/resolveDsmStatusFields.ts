// ============================================================================
// resolveDsmStatusFields
// ----------------------------------------------------------------------------
// Pure helper for the Visual QA "DSM Status" card. Fans out across every
// canonical path where DSM size/transform/bounds may live so the card never
// shows "Missing Size" when the data is present under a sibling key.
//
// Tested in __tests__/resolveDsmStatusFields.test.ts. The component
// MeasurementVisualQAOverlay.tsx delegates to this helper.
// ============================================================================

export interface DsmStatusFields {
  dsmW: number | null;
  dsmH: number | null;
  dsmLoaded: boolean;
  dsmRegistered: boolean;
  dsmBoundsFailure: string | null;
  dsmTransformSource: string | null;
  policy: string;
  statusLabel: "Missing" | "Loaded, not registered" | "Registered";
}

function pick<T = any>(...vals: T[]): T | undefined {
  return vals.find((v) => v != null);
}

export function resolveDsmStatusFields(grj: any): DsmStatusFields {
  const g: any = grj ?? {};
  const dsmSize: any = pick(
    g.registration?.dsm?.dsm_size_px,
    g.registration?.dsm_size_px,
    g.registration?.transform_package?.dsm_size_px,
    g.dsm_split_status?.dsm_size_px,
    g.registration_gate?.dsm_size_px,
    g.dsm_size_px,
    g.dsm_size,
    g.dsm?.size,
  );
  const dsmW = (dsmSize?.width ?? dsmSize?.w ?? null) as number | null;
  const dsmH = (dsmSize?.height ?? dsmSize?.h ?? null) as number | null;
  const dsmBoundsFailure = (pick(
    g.registration?.dsm_tile_bounds_failure_reason,
    g.dsm_bounds_failure,
    g.dsm?.bounds_failure,
  ) ?? null) as string | null;
  const dsmTransformSource = (pick(
    g.registration?.dsm_to_raster_transform_source,
    g.dsm_to_raster_transform_source,
    g.dsm?.to_raster_transform_source,
  ) ?? null) as string | null;
  const dsmLoaded = dsmW != null || dsmH != null;
  const dsmRegistered = pick(
    g.registration?.dsm_pixel_transform_valid,
    g.dsm_pixel_transform_valid,
  ) === true;
  const policy = (pick(
    g.registration?.derived_bounds_policy,
    g.dsm_transform_policy,
  ) ?? "dsm-registration-transform-v1") as string;
  const statusLabel: DsmStatusFields["statusLabel"] = !dsmLoaded
    ? "Missing"
    : dsmRegistered
    ? "Registered"
    : "Loaded, not registered";
  return {
    dsmW,
    dsmH,
    dsmLoaded,
    dsmRegistered,
    dsmBoundsFailure,
    dsmTransformSource,
    policy,
    statusLabel,
  };
}
