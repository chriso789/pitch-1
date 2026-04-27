/**
 * Patent-aligned two-layer roof model.
 *
 * Implements the "first layer / second layer with substantially overlapping
 * segments" structure from US 8,515,125 / US 8,938,090 / US 9,329,749 /
 * US 9,244,589 (Pictometry/Thornberry family).
 *
 *   Layer 1 (perimeter) - polylines tracing the OUTLINE of each roof plane.
 *                          Carry the dimensional length attribute and the
 *                          non-dimensional attribute "perimeter".
 *   Layer 2 (structural) - polylines tracing INTERIOR roof structural lines
 *                          (ridge, hip, valley) AND the perimeter-coincident
 *                          eave/rake segments. Carry the SAME geometry as the
 *                          corresponding Layer 1 segment where they overlap,
 *                          but with a DIFFERENT non-dimensional attribute
 *                          (color/type), per the patent claim language.
 *
 * Each Layer 2 line that overlaps a Layer 1 segment records `overlapsLayer1Id`
 * so the renderer and PDF generator can preserve the patent's "two lines on
 * the same geometry, different non-dimensional attribute" requirement.
 */

export type Layer2EdgeType = "ridge" | "hip" | "valley" | "eave" | "rake";

export interface PerimeterPolyline {
  /** Stable id for cross-layer references and user length overrides. */
  id: string;
  /** Plane / facet label this perimeter segment belongs to (e.g. "A", "B"). */
  plane: string;
  /** Polyline vertices in image-pixel coordinates. */
  points: [number, number][];
  /** Computed length in feet (from meters_per_pixel). */
  length_ft: number;
  /**
   * USER OVERRIDE per US9329749: when set, area recomputation MUST use this
   * value instead of the computed `length_ft`. Patent literal: area-only
   * propagation. Does NOT cascade into estimate/material totals.
   */
  user_length_ft_override?: number | null;
  /** Non-dimensional attribute - always "perimeter" for Layer 1. */
  attribute: "perimeter";
}

export interface StructuralLine {
  id: string;
  type: Layer2EdgeType;
  points: [number, number][];
  length_ft: number;
  /**
   * If this Layer 2 line is coincident with a Layer 1 perimeter segment
   * (true for eaves and rakes), this references that segment's id. The two
   * carry the SAME geometry but DIFFERENT non-dimensional attributes, per
   * the patent's "substantially overlapping segments" claim.
   */
  overlapsLayer1Id?: string | null;
  confidence: number;
  source?: "unet" | "rule_engine" | "vendor_override" | "user";
}

export interface RoofPlane {
  /** Plane label (A, B, C, ...) shown on diagrams and area tables. */
  label: string;
  /** Pitch in rise:12 (e.g. 6 = 6/12). May be set via pitch-determination marker. */
  pitch: number;
  /** Plan-view (footprint projection) area in square feet. */
  plan_area_sqft: number;
  /**
   * Sloped roof area = plan_area_sqft * slopeFactor(pitch).
   * Recomputed when pitch or any bounding perimeter length override changes.
   */
  roof_area_sqft: number;
  /** Ids of Layer 1 perimeter segments bounding this plane. */
  perimeter_ids: string[];
}

export interface PatentRoofModel {
  version: "patent-v1";
  /** Image context (matches existing RoofOverlaySchema.image). */
  image: {
    url: string | null;
    width: number;
    height: number;
    center_lat: number;
    center_lng: number;
    zoom: number;
    meters_per_pixel: number;
  };
  layer1_perimeter: PerimeterPolyline[];
  layer2_structural: StructuralLine[];
  planes: RoofPlane[];
  totals: {
    footprint_sqft: number;
    roof_area_sqft: number;
    roofing_squares: number;
    predominant_pitch: number;
    slope_factor: number;
    lengths_ft: Record<Layer2EdgeType | "perimeter", number>;
  };
  imagery_qc: {
    passed: boolean;
    abnormalities: string[];
    reshoot_requested: boolean;
  };
}
