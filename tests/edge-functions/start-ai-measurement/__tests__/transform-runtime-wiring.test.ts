// Transform Runtime Wiring v1 — regression tests proving that the persisted
// registration block carries real Web-Mercator math (not nulls) when the
// builder is called, and that the gate consumes those values directly.
//
// These tests target the pure pieces (buildRegistrationTransformPackage +
// evaluateRegistrationGate) wired exactly the way start-ai-measurement wires
// them at the candidate_final site. If either contract drifts, the persisted
// Fonsica row will go back to all-null transforms and these tests fail.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildRegistrationTransformPackage,
  SOURCE_REGISTRATION_TRANSFORM_VERSION,
} from "../../_shared/source-registration-transform.ts";
import { evaluateRegistrationGate } from "../../_shared/registration-gate.ts";
import {
  fetchRoofMaskFromGoogleSolar,
  getLastDSMDiagnostics,
  resetDSMDiagnostics,
} from "../../_shared/dsm-analyzer.ts";

const FONSICA = { lat: 27.9506, lng: -82.4572 };

Deno.test("happy path: confirmed center projects to raster centre and gate fields are non-null", () => {
  const pkg = buildRegistrationTransformPackage({
    confirmed_roof_center_lat_lng: FONSICA,
    static_map_center_lat_lng: FONSICA,
    zoom: 20,
    size: { width: 640, height: 640 },
    scale: 2,
    dsm_tile_bounds_lat_lng: {
      sw: { lat: FONSICA.lat - 0.001, lng: FONSICA.lng - 0.001 },
      ne: { lat: FONSICA.lat + 0.001, lng: FONSICA.lng + 0.001 },
    },
    dsm_size_px: { width: 256, height: 256 },
    dsm_meters_per_pixel: 0.5,
  });
  assertEquals(pkg.version, SOURCE_REGISTRATION_TRANSFORM_VERSION);
  assert(
    pkg.confirmed_roof_center_px,
    "confirmed_roof_center_px must be populated",
  );
  assert(
    pkg.geo_to_raster_transform,
    "geo_to_raster_transform must be populated",
  );
  assert(pkg.raster_bounds_lat_lng, "raster_bounds_lat_lng must be populated");
  assert(pkg.geo_to_dsm_transform, "geo_to_dsm_transform must be populated");
  assert(
    pkg.dsm_to_raster_transform,
    "dsm_to_raster_transform must be populated",
  );
  assert(
    pkg.confirmed_roof_center_dsm_px,
    "confirmed_roof_center_dsm_px must be populated",
  );
  // Centre of 640x640@scale2 raster is (640,640).
  const [x, y] = pkg.confirmed_roof_center_px!;
  assert(Math.abs(x - 640) < 1, `expected x≈640 got ${x}`);
  assert(Math.abs(y - 640) < 1, `expected y≈640 got ${y}`);
  assertEquals(pkg.raster_bounds_contain_confirmed_center, true);
  assertEquals(pkg.geo_to_dsm_px_success, true);
  assertEquals(pkg.dsm_pixel_transform_valid, true);
  assertEquals(pkg.transform_package_valid, true);
  assertEquals(pkg.missing_required_fields.length, 0);
});

Deno.test("missing static-map size leaves transforms null and gate fails coordinate_registration_failed", () => {
  const pkg = buildRegistrationTransformPackage({
    confirmed_roof_center_lat_lng: FONSICA,
    static_map_center_lat_lng: FONSICA,
    zoom: 20,
    // size missing
    scale: 2,
  } as any);
  assertEquals(pkg.transform_package_valid, false);
  assertEquals(pkg.confirmed_roof_center_px, null);
  assertEquals(pkg.geo_to_raster_transform, null);
  assertEquals(pkg.raster_bounds_lat_lng, null);
  assert(pkg.missing_required_fields.includes("raster_bounds_lat_lng"));
  assert(pkg.missing_required_fields.includes("confirmed_roof_center_px"));

  const result = evaluateRegistrationGate({
    evaluation_stage: "candidate_final",
    user_confirmed_roof_target: true,
    original_geocode_lat_lng: FONSICA,
    confirmed_roof_center_lat_lng: FONSICA,
    confirmed_roof_center_px: pkg.confirmed_roof_center_px ?? null,
    geo_to_raster_transform: pkg.geo_to_raster_transform ?? null,
    geo_to_dsm_transform: pkg.geo_to_dsm_transform ?? null,
    dsm_to_raster_transform: pkg.dsm_to_raster_transform ?? null,
    raster_bounds_lat_lng: pkg.raster_bounds_lat_lng ?? null,
    dsm_tile_bounds_lat_lng: pkg.dsm_tile_bounds_lat_lng ?? null,
    geo_to_dsm_px_success: pkg.geo_to_dsm_px_success === true,
    dsm_pixel_transform_valid: pkg.dsm_pixel_transform_valid === true,
    selected_candidate_polygon_px: null,
  });
  assert(result.failure, "gate must fail when transform package is invalid");
  assertEquals(result.coordinate_registration_gate_passed, false);
  assertEquals(result.failure?.result_state, "ai_failed_source_acquisition");
  assertEquals(result.failure?.hard_fail_reason, "dsm_size_missing");
});

Deno.test("gate passes only when candidate polygon contains confirmed centre", () => {
  const pkg = buildRegistrationTransformPackage({
    confirmed_roof_center_lat_lng: FONSICA,
    static_map_center_lat_lng: FONSICA,
    zoom: 20,
    size: { width: 640, height: 640 },
    scale: 2,
    dsm_tile_bounds_lat_lng: {
      sw: { lat: FONSICA.lat - 0.001, lng: FONSICA.lng - 0.001 },
      ne: { lat: FONSICA.lat + 0.001, lng: FONSICA.lng + 0.001 },
    },
    dsm_size_px: { width: 256, height: 256 },
    dsm_meters_per_pixel: 0.5,
  });
  const [cx, cy] = pkg.confirmed_roof_center_px!;
  // Candidate polygon containing the centre.
  const containing: [number, number][] = [
    [cx - 100, cy - 100],
    [cx + 100, cy - 100],
    [cx + 100, cy + 100],
    [cx - 100, cy + 100],
  ];
  const result = evaluateRegistrationGate({
    evaluation_stage: "candidate_final",
    user_confirmed_roof_target: true,
    original_geocode_lat_lng: FONSICA,
    confirmed_roof_center_lat_lng: FONSICA,
    confirmed_roof_center_px: pkg.confirmed_roof_center_px,
    geo_to_raster_transform: pkg.geo_to_raster_transform,
    geo_to_dsm_transform: pkg.geo_to_dsm_transform,
    dsm_to_raster_transform: pkg.dsm_to_raster_transform,
    raster_bounds_lat_lng: pkg.raster_bounds_lat_lng,
    dsm_tile_bounds_lat_lng: pkg.dsm_tile_bounds_lat_lng,
    dsm_size_px: pkg.dsm_size_px,
    geo_to_dsm_px_success: true,
    dsm_pixel_transform_valid: true,
    selected_candidate_polygon_px: containing,
    footprint_bbox_diagonal_px: 283,
  });
  assertEquals(result.confirmed_center_inside_candidate, true);
  assertEquals(result.coordinate_registration_gate_passed, true);
  assertEquals(result.failure, null);
});

Deno.test("missing selected candidate at final stage hard-fails", () => {
  const pkg = buildRegistrationTransformPackage({
    confirmed_roof_center_lat_lng: FONSICA,
    static_map_center_lat_lng: FONSICA,
    zoom: 20,
    size: { width: 640, height: 640 },
    scale: 2,
    dsm_tile_bounds_lat_lng: {
      sw: { lat: FONSICA.lat - 0.001, lng: FONSICA.lng - 0.001 },
      ne: { lat: FONSICA.lat + 0.001, lng: FONSICA.lng + 0.001 },
    },
    dsm_size_px: { width: 256, height: 256 },
    dsm_meters_per_pixel: 0.5,
  });
  const result = evaluateRegistrationGate({
    evaluation_stage: "candidate_final",
    user_confirmed_roof_target: true,
    original_geocode_lat_lng: FONSICA,
    confirmed_roof_center_lat_lng: FONSICA,
    confirmed_roof_center_px: pkg.confirmed_roof_center_px,
    geo_to_raster_transform: pkg.geo_to_raster_transform,
    geo_to_dsm_transform: pkg.geo_to_dsm_transform,
    dsm_to_raster_transform: pkg.dsm_to_raster_transform,
    raster_bounds_lat_lng: pkg.raster_bounds_lat_lng,
    dsm_tile_bounds_lat_lng: pkg.dsm_tile_bounds_lat_lng,
    dsm_size_px: pkg.dsm_size_px,
    geo_to_dsm_px_success: true,
    dsm_pixel_transform_valid: true,
    selected_candidate_polygon_px: null,
  });
  assertEquals(result.coordinate_registration_gate_passed, false);
  assert(result.failure, "final stage must fail without selected candidate");
  const missing = (result.registration as any)
    .missing_required_fields as string[];
  assert(missing.includes("selected_candidate_polygon_px"));
  assertEquals(
    result.failure?.hard_fail_reason,
    "selected_candidate_polygon_missing",
  );
});

Deno.test("candidate in dsm_px uses confirmed_roof_center_dsm_px", () => {
  const result = evaluateRegistrationGate({
    evaluation_stage: "candidate_final",
    user_confirmed_roof_target: true,
    original_geocode_lat_lng: FONSICA,
    confirmed_roof_center_lat_lng: FONSICA,
    confirmed_roof_center_px: [10, 10],
    confirmed_roof_center_dsm_px: [640, 640],
    geo_to_raster_transform: {},
    geo_to_dsm_transform: {},
    dsm_to_raster_transform: {},
    raster_bounds_lat_lng: {
      sw: { lat: FONSICA.lat - 0.001, lng: FONSICA.lng - 0.001 },
      ne: { lat: FONSICA.lat + 0.001, lng: FONSICA.lng + 0.001 },
    },
    dsm_tile_bounds_lat_lng: {
      sw: { lat: FONSICA.lat - 0.001, lng: FONSICA.lng - 0.001 },
      ne: { lat: FONSICA.lat + 0.001, lng: FONSICA.lng + 0.001 },
    },
    dsm_size_px: { width: 998, height: 998 },
    geo_to_dsm_px_success: true,
    dsm_pixel_transform_valid: true,
    selected_candidate_polygon_px: [[630, 630], [650, 630], [650, 650], [
      630,
      650,
    ]],
    candidate_coordinate_space: "dsm_px",
    footprint_bbox_diagonal_px: 40,
  });
  assertEquals(
    (result.registration as any).center_used_for_candidate_check,
    "dsm_px",
  );
  assertEquals(result.confirmed_center_inside_candidate, true);
  assertEquals(result.failure, null);
});

Deno.test("candidate in raster_px uses confirmed_roof_center_px", () => {
  const result = evaluateRegistrationGate({
    evaluation_stage: "candidate_final",
    user_confirmed_roof_target: true,
    original_geocode_lat_lng: FONSICA,
    confirmed_roof_center_lat_lng: FONSICA,
    confirmed_roof_center_px: [640, 640],
    confirmed_roof_center_dsm_px: [10, 10],
    geo_to_raster_transform: {},
    geo_to_dsm_transform: {},
    dsm_to_raster_transform: {},
    raster_bounds_lat_lng: {
      sw: { lat: FONSICA.lat - 0.001, lng: FONSICA.lng - 0.001 },
      ne: { lat: FONSICA.lat + 0.001, lng: FONSICA.lng + 0.001 },
    },
    dsm_tile_bounds_lat_lng: {
      sw: { lat: FONSICA.lat - 0.001, lng: FONSICA.lng - 0.001 },
      ne: { lat: FONSICA.lat + 0.001, lng: FONSICA.lng + 0.001 },
    },
    dsm_size_px: { width: 998, height: 998 },
    geo_to_dsm_px_success: true,
    dsm_pixel_transform_valid: true,
    selected_candidate_polygon_px: [[630, 630], [650, 630], [650, 650], [
      630,
      650,
    ]],
    candidate_coordinate_space: "raster_px",
    footprint_bbox_diagonal_px: 40,
  });
  assertEquals(
    (result.registration as any).center_used_for_candidate_check,
    "raster_px",
  );
  assertEquals(result.confirmed_center_inside_candidate, true);
  assertEquals(result.failure, null);
});

Deno.test("candidate offset above target threshold hard-fails specifically", () => {
  const result = evaluateRegistrationGate({
    evaluation_stage: "candidate_final",
    user_confirmed_roof_target: true,
    original_geocode_lat_lng: FONSICA,
    confirmed_roof_center_lat_lng: FONSICA,
    confirmed_roof_center_px: [640, 640],
    confirmed_roof_center_dsm_px: [640, 640],
    geo_to_raster_transform: {},
    geo_to_dsm_transform: {},
    dsm_to_raster_transform: {},
    raster_bounds_lat_lng: {
      sw: { lat: FONSICA.lat - 0.001, lng: FONSICA.lng - 0.001 },
      ne: { lat: FONSICA.lat + 0.001, lng: FONSICA.lng + 0.001 },
    },
    dsm_tile_bounds_lat_lng: {
      sw: { lat: FONSICA.lat - 0.001, lng: FONSICA.lng - 0.001 },
      ne: { lat: FONSICA.lat + 0.001, lng: FONSICA.lng + 0.001 },
    },
    dsm_size_px: { width: 998, height: 998 },
    geo_to_dsm_px_success: true,
    dsm_pixel_transform_valid: true,
    selected_candidate_polygon_px: [[100, 100], [120, 100], [120, 120], [
      100,
      120,
    ]],
    candidate_coordinate_space: "raster_px",
    footprint_bbox_diagonal_px: 40,
  });
  assertEquals(
    result.failure?.hard_fail_reason,
    "candidate_centroid_offset_exceeds_target",
  );
  assertEquals(
    (result.registration as any).candidate_rejection_reason,
    "centroid_offset_exceeds_target",
  );
});

Deno.test("runtime path reruns gate after DSM/candidate hoist", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(
    source.includes(
      "registrationBlock = applyLiveRuntimeHoistToRegistration(",
    ),
  );
  assert(
    source.includes("const refreshedGateInput = registrationInputFromBlock("),
  );
  assert(
    source.includes("result = evaluateRegistrationGate(refreshedGateInput);"),
  );
  assert(source.includes('reg.dsm_hoist_callsite = "start-ai-measurement";'));
  assert(source.includes('reg.candidate_source_status = "stale_debug_only";'));
});

Deno.test("Google Solar roof mask stage has bounded timeout diagnostics", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(source.includes("const GOOGLE_SOLAR_STAGE_TIMEOUT_MS = 60_000;"));
  assert(source.includes("const GOOGLE_SOLAR_FETCH_TIMEOUT_MS = 20_000;"));
  assert(source.includes("const GOOGLE_SOLAR_DSM_TIMEOUT_MS = 20_000;"));
  assert(source.includes("const GOOGLE_SOLAR_FOOTPRINT_TIMEOUT_MS = 20_000;"));
  assert(source.includes("google_solar_stage_duration_ms"));
  assert(source.includes("google_solar_fetch_started_at"));
  assert(source.includes("google_solar_fetch_duration_ms"));
  assert(source.includes("footprint_extraction_duration_ms"));
  assert(
    source.includes(
      'googleSolarMaskHardFailReason = "google_solar_mask_timeout";',
    ),
  );
  assert(
    source.includes(
      'googleSolarMaskHardFailReason = "google_solar_roof_mask_missing";',
    ),
  );
  assert(source.includes('"roof_mask_footprint_extraction_failed"'));
  assert(source.includes('"roof_mask_points_missing"'));
  assert(source.includes('diagram_render_intent: "debug_only"'));
  assert(source.includes("roof_lines_count: 0"));
});

Deno.test("Google Solar helpers pass AbortSignal into real fetch calls", async () => {
  const originalFetch = globalThis.fetch;
  let observedSignal: AbortSignal | null = null;
  resetDSMDiagnostics();
  try {
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      observedSignal = init?.signal ?? null;
      return new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener("abort", () => {
          reject(new DOMException("aborted by test", "AbortError"));
        }, { once: true });
      });
    }) as typeof fetch;

    const result = await fetchRoofMaskFromGoogleSolar(
      27.950601,
      -82.457201,
      "test-key",
      {
        timeoutMs: 1,
      },
    );

    assertEquals(result, null);
    assert(observedSignal, "fetch must receive an AbortSignal");
    const signal = observedSignal as AbortSignal;
    assertEquals(signal.aborted, true);
    assertEquals(
      getLastDSMDiagnostics().failure_code,
      "google_solar_datalayers_timeout",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("runtime has terminal-write guard and stale-job watchdog", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(source.includes("let terminalStatusWritten = false;"));
  assert(
    source.includes("ensureTerminalStatusWritten(") &&
      source.includes("AI_RUNTIME_UNHANDLED_FAILURE_REASON"),
  );
  assert(
    source.includes("AI_RUNTIME_UNHANDLED_FAILURE_REASON") &&
      source.includes('"ai_measurement_runtime_killed_or_unhandled"'),
  );
  assert(
    source.includes(
      'const AI_RUNTIME_TIMEOUT_FAILURE_REASON = "ai_measurement_runtime_timeout";',
    ),
  );
  assert(source.includes("async function runAiMeasurementWatchdog()"));
  assert(
    source.includes("AI_MEASUREMENT_STALE_RUNNING_MS") &&
      source.includes("120_000"),
  );
  assert(source.includes('.eq("status", "running")'));
  assert(source.includes("report_blocked: true"));
  assert(source.includes("needs_review: true"));
});

Deno.test("runtime CPU budget guard preempts Phase 3A.5/topology before stuck running state", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(
    source.includes(
      'const AI_MEASUREMENT_CPU_TIMEOUT_REASON = "ai_measurement_cpu_timeout";',
    ),
  );
  assert(source.includes("const AI_MEASUREMENT_CPU_TIMEOUT_STAGE ="));
  assert(source.includes("shouldPreemptForCpuBudget("));
  assert(source.includes("persistCpuBudgetTerminalFailure("));
  assert(source.includes('stage: "phase3_5_perimeter_refinement"'));
  assert(source.includes('stage: "autonomous_topology_solver"'));
  assert(source.includes("Running perimeter refinement"));
  assert(source.includes("Running perimeter topology validation"));
  assert(source.includes('result_state: "ai_failed_runtime"'));
  assert(source.includes("AI_MEASUREMENT_TOPOLOGY_PIXEL_LIMIT"));
});

Deno.test("Phase 3A.5 aerial tracing is not blocked by topology workload cutoff", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(source.includes("const phase3A5WorkUnits = dsmW * dsmH;"));
  assert(
    source.includes("const phase3A5Budget = shouldPreemptForCpuBudget(input, 0);"),
    "Phase 3A.5 should use wall-clock-only preempt so Fonsica-class 998×998 DSM can still complete aerial tracing",
  );
  assert(
    source.includes("const ckpt = shouldPreemptForCpuBudget(input, 0);"),
    "pre-refinement call checkpoint should not pass phase3A5WorkUnits into the topology workload cutoff",
  );
});

Deno.test("diagnostic state precedence keeps CPU timeout above stale registration fields", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  const migration = await Deno.readTextFile(
    new URL(
      "../../../migrations/20260525093000_add_roof_measurement_failure_stage.sql",
      import.meta.url,
    ),
  );
  assert(source.includes("resolveMeasurementDiagnosticState"));
  assert(source.includes('"runtime_cpu_budget_guard"'));
  assert(source.includes("runtimeStateWins"));
  assert(source.includes("registration_precedence_reason: runtimeStateWins"));
  assert(migration.includes("ADD COLUMN IF NOT EXISTS failure_stage text"));
});

Deno.test("Phase 3A.5 failures preserve perimeter result state and aerial overlay", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(source.includes("phase3A5RanWithSources"));
  assert(source.includes('return "ai_failed_perimeter";'));
  assert(source.includes("coordinate_space_solver: phase3A5ScorerSpace"));
  assert(source.includes("block_customer_report_reason: failReason"));
  assert(source.includes("buildPhase3A5AerialOverlayDataUrl"));
  assert(source.includes("satellite_overlay_url: phase3A5AerialOverlayUrl"));
  assert(
    source.includes("satellite_overlay_url: debug?.satellite_overlay_url"),
  );
});

Deno.test("must-run preflight: target unconfirmed still builds static transform proof", () => {
  const pkg = buildRegistrationTransformPackage({
    confirmed_roof_center_lat_lng: FONSICA,
    static_map_center_lat_lng: FONSICA,
    zoom: 19,
    size: { width: 640, height: 640 },
    scale: 2,
  });
  const result = evaluateRegistrationGate({
    evaluation_stage: "target_preflight",
    user_confirmed_roof_target: false,
    roof_target_admin_override: false,
    original_geocode_lat_lng: FONSICA,
    confirmed_roof_center_lat_lng: FONSICA,
    confirmed_roof_center_px: pkg.confirmed_roof_center_px,
    geo_to_raster_transform: pkg.geo_to_raster_transform,
    raster_bounds_lat_lng: pkg.raster_bounds_lat_lng,
    raster_size_px: pkg.raster_size_px,
    static_map_center_lat_lng: pkg.static_map_center_lat_lng,
    geo_to_dsm_px_success: false,
    dsm_pixel_transform_valid: false,
    dsm_to_raster_transform: null,
  });
  assert(
    result.failure,
    "target-unconfirmed preflight may fail, but not with null static transform evidence",
  );
  assert(
    pkg.confirmed_roof_center_px,
    "confirmed_roof_center_px must be populated before target failure write",
  );
  assert(
    pkg.raster_bounds_lat_lng,
    "raster_bounds_lat_lng must be populated before target failure write",
  );
  assert(
    pkg.geo_to_raster_transform,
    "geo_to_raster_transform must be populated before target failure write",
  );
  assertEquals(result.failure?.result_state, "ai_failed_target_unconfirmed");
});

Deno.test("must-run preflight: source acquisition failure before DSM only misses DSM fields", () => {
  const pkg = buildRegistrationTransformPackage({
    confirmed_roof_center_lat_lng: FONSICA,
    static_map_center_lat_lng: FONSICA,
    zoom: 19,
    size: { width: 640, height: 640 },
    scale: 2,
  });
  assert(
    pkg.confirmed_roof_center_px,
    "static confirmed center px must be populated",
  );
  assert(
    pkg.geo_to_raster_transform,
    "static geo→raster transform must be populated",
  );
  assert(pkg.raster_bounds_lat_lng, "static raster bounds must be populated");
  assertEquals(pkg.dsm_tile_bounds_lat_lng, null);
  assertEquals(pkg.geo_to_dsm_transform, null);
  assertEquals(pkg.dsm_to_raster_transform, null);
  const missing = pkg.missing_required_fields;
  assert(!missing.includes("confirmed_roof_center_px"));
  assert(!missing.includes("geo_to_raster_transform"));
  assert(!missing.includes("raster_bounds_lat_lng"));
  assert(missing.includes("dsm_tile_bounds_lat_lng"));
  assert(missing.includes("geo_to_dsm_transform"));
});

Deno.test("must-run preflight: write chokepoint has fallback proof for missing transform builder", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(source.includes("function ensureRegistrationProofBeforeWrite"));
  assert(source.includes("transform_builder_not_called_before_write"));
  assert(source.includes("transform_builder_called: false"));
  assert(
    source.includes("let safePayload = ensureRegistrationProofBeforeWrite(") &&
      source.includes("prepareRoofMeasurementPayload(payload)"),
  );
});
