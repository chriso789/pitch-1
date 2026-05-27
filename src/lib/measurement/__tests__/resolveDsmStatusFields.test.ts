import { describe, it, expect } from "vitest";
import { resolveDsmStatusFields } from "../resolveDsmStatusFields";

const SIZE = { width: 998, height: 998 };

describe("resolveDsmStatusFields — canonical path fan-out", () => {
  it.each([
    ["registration.dsm.dsm_size_px", { registration: { dsm: { dsm_size_px: SIZE } } }],
    ["registration.dsm_size_px", { registration: { dsm_size_px: SIZE } }],
    ["registration.transform_package.dsm_size_px", { registration: { transform_package: { dsm_size_px: SIZE } } }],
    ["dsm_split_status.dsm_size_px", { dsm_split_status: { dsm_size_px: SIZE } }],
    ["registration_gate.dsm_size_px", { registration_gate: { dsm_size_px: SIZE } }],
    ["legacy dsm_size", { dsm_size: SIZE }],
    ["legacy dsm.size", { dsm: { size: SIZE } }],
  ])("resolves 998×998 from %s", (_label, grj) => {
    const r = resolveDsmStatusFields(grj);
    expect(r.dsmW).toBe(998);
    expect(r.dsmH).toBe(998);
    expect(r.dsmLoaded).toBe(true);
  });

  it("renders 'Loaded, not registered' when DSM size present but transform invalid", () => {
    const r = resolveDsmStatusFields({
      registration: { dsm_size_px: SIZE, dsm_pixel_transform_valid: false },
    });
    expect(r.statusLabel).toBe("Loaded, not registered");
    expect(r.dsmRegistered).toBe(false);
  });

  it("renders 'Registered' when DSM transform valid", () => {
    const r = resolveDsmStatusFields({
      registration: { dsm_size_px: SIZE, dsm_pixel_transform_valid: true },
    });
    expect(r.statusLabel).toBe("Registered");
  });

  it("renders 'Missing' when no DSM size anywhere", () => {
    const r = resolveDsmStatusFields({});
    expect(r.statusLabel).toBe("Missing");
    expect(r.dsmLoaded).toBe(false);
  });

  it("surfaces dsm_bounds_failure and dsm_to_raster_transform_source", () => {
    const r = resolveDsmStatusFields({
      registration: { dsm_size_px: SIZE },
      dsm_bounds_failure: "dsm_tile_bounds_missing_from_google_solar_metadata",
      dsm_to_raster_transform_source: "derived_from_raster_bounds",
    });
    expect(r.dsmBoundsFailure).toBe(
      "dsm_tile_bounds_missing_from_google_solar_metadata",
    );
    expect(r.dsmTransformSource).toBe("derived_from_raster_bounds");
  });
});
