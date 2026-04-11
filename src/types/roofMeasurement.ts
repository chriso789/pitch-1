export type RoofFeatureType = "ridge" | "hip" | "valley" | "eave" | "rake";

export interface RoofFeatureLine {
  type: RoofFeatureType;
  p1: [number, number];
  p2: [number, number];
  length_px?: number;
  length_ft?: number;
  confidence: number;
  source?: "unet" | "rule_engine" | "vendor_override" | "filled_perimeter";
  meta?: Record<string, any>;
}

export interface RoofOverlaySchema {
  version: "v1";
  image: {
    url: string | null;
    width: number;
    height: number;
    center_lat: number;
    center_lng: number;
    zoom: number;
    meters_per_pixel: number;
  };
  polygon: [number, number][];
  features: RoofFeatureLine[];
}

export interface RoofMeasurementData {
  meta: {
    version: "v1";
    source: "pitch-internal-unet";
    generated_at: string;
    model_version?: string | null;
    rule_engine_version?: string | null;
    fusion_version?: string | null;
  };
  location: {
    address: string | null;
    lat: number;
    lng: number;
  };
  roof: {
    type: "gable" | "hip" | "complex_valley" | "flat_or_low_slope" | "mixed" | "unknown";
    confidence: number;
  };
  measurements: {
    area_sqft: number | null;
    predominant_pitch: number | null;
    facets?: number | null;
    lengths_ft: {
      ridge: number;
      hip: number;
      valley: number;
      eave: number;
      rake: number;
      perimeter?: number;
    };
  };
  geometry: {
    footprint_polygon: [number, number][];
    features: RoofFeatureLine[];
  };
  overlay: RoofOverlaySchema | null;
  vendor_comparison?: {
    vendor_report_id?: string | null;
    area_error_pct?: number | null;
    pitch_error?: number | null;
    ridge_error_pct?: number | null;
    hip_error_pct?: number | null;
    valley_error_pct?: number | null;
    eave_error_pct?: number | null;
    rake_error_pct?: number | null;
    weighted_accuracy_score?: number | null;
    review_required?: boolean;
  } | null;
  debug?: {
    meters_per_pixel?: number | null;
    solar_pitch_used?: boolean;
    alignment_score?: number | null;
    imagery_source?: string | null;
    warnings?: string[];
  };
}
