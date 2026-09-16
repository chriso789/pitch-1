import { describe, expect, it } from "vitest";
import { parseRoofrRoofReport } from "../../supabase/functions/_shared/parsers/roofr-roof.ts";
import { parseEagleViewRoofReport } from "../../supabase/functions/_shared/parsers/eagleview-roof.ts";
import { parseEagleViewWallReport } from "../../supabase/functions/_shared/blueprint-importer/parsers/eagleview-wall.ts";

// Known-answer excerpts taken from real uploaded reports used to validate the importer.
// Keep vendor wording/punctuation intact so these regressions catch layout drift.
const FONSICA_ROOFR = `
Roof Report Prepared by Roofr
4063 Fonsica Avenue, North Port, FL 34286
Total roof area: 3077 sqft
Pitched roof area: 3077 sqft
Flat roof area: 0 sqft
Total roof facets           14 facets
Predominant pitch 6/12
Total eaves                 258ft 9in
Total valleys               64ft 3in
Total hips                  201ft 10in
Total ridges                30ft 2in
Total rakes                 5ft 3in
Total wall flashing         0ft 0in
Total step flashing 11ft 7in
Hips + ridges               232ft 0in
Eaves + rakes               264ft 0in
`;

const EAGLEVIEW_ROOF_26970976 = `
Eagle View
371 Capistrano Ct, Marco Island, FL 34145-3513 Report: 26970976
Total Roof Area =3,783 sq ft
Total Roof Facets =23
Predominant Pitch =6/12
Total Line Lengths:
Ridges = 60 ft
Hips = 287 ft
Valleys = 139 ft
Rakes = 11 ft
Eaves = 305 ft
Flashing = 6 ft
Step flashing = 38 ft
Parapets = 0 ft
Longitude = -81.7229920
Latitude = 25.9463835
`;

const EAGLEVIEW_WALL_62860135 = `
Eagle View Technologies
Walls Only Report
5100 Jessie Harbor Dr, Osprey, FL 34229
Report:62860135
Total Wall Area = 28071.9 sq ft
Total Wall Facets = 64
Total Window & Door Area = 5175 sq ft
Total Windows & Doors = 255
Total Wall Area with Windows and Doors = 33,247 sq ft
Total Window and Door Perimeter = 4540 ft
Wall Area = 28071.9 sq ft
Top of Walls = 760 ft
Bottom of Walls = 760 ft
Inside Corners = 529 ft
Outside Corners = 412 ft
Inside Corners > 90° = 584 ft
Outside Corners > 90° = 1,364 ft
Window and Door Area = 5175 sq ft
Window and Door Perimeter = 4,540 ft
Fascia (Eaves + Rake) = 710 ft
Total Wall Facets = 64
Total Windows and Doors = 255
Due to obstructions in available images of this property, please verify measurements on portion of structure highlighted in yellow.
Wall measurements should be field verified to confirm accuracy. Wall areas assume that flat soffits exist at the eaves.
`;

describe("real uploaded report regressions", () => {
  it("parses Fonsica Roofr report including inches", () => {
    const r = parseRoofrRoofReport(FONSICA_ROOFR);
    expect(r.matched_signal).toBe(true);
    expect(r.data.total_roof_area_sqft).toBe(3077);
    expect(r.data.pitched_roof_area_sqft).toBe(3077);
    expect(r.data.flat_roof_area_sqft).toBe(0);
    expect(r.data.roof_facets).toBe(14);
    expect(r.data.predominant_pitch).toBe("6/12");
    expect(r.data.eaves_ft).toBeCloseTo(258.75, 3);
    expect(r.data.valleys_ft).toBeCloseTo(64.25, 3);
    expect(r.data.hips_ft).toBeCloseTo(201 + 10 / 12, 3);
    expect(r.data.ridges_ft).toBeCloseTo(30 + 2 / 12, 3);
    expect(r.data.rakes_ft).toBeCloseTo(5.25, 3);
    expect(r.data.step_flashing_ft).toBeCloseTo(11 + 7 / 12, 3);
  });

  it("parses legacy EagleView roof equals-sign layout", () => {
    const r = parseEagleViewRoofReport(EAGLEVIEW_ROOF_26970976);
    expect(r.matched_signal).toBe(true);
    expect(r.data.report_number).toBe("26970976");
    expect(r.data.total_roof_area_sqft).toBe(3783);
    expect(r.data.total_roof_facets).toBe(23);
    expect(r.data.predominant_pitch).toBe("6/12");
    expect(r.data.ridges_ft).toBe(60);
    expect(r.data.hips_ft).toBe(287);
    expect(r.data.valleys_ft).toBe(139);
    expect(r.data.rakes_ft).toBe(11);
    expect(r.data.eaves_ft).toBe(305);
    expect(r.data.flashing_ft).toBe(6);
    expect(r.data.step_flashing_ft).toBe(38);
    expect(r.data.longitude).toBeCloseTo(-81.722992, 6);
    expect(r.data.latitude).toBeCloseTo(25.9463835, 6);
    expect(r.missing_fields).toEqual([]);
  });

  it("parses real EagleView wall summary and warnings", () => {
    const r = parseEagleViewWallReport(EAGLEVIEW_WALL_62860135);
    expect(r.matched_signal).toBe(true);
    expect(r.data.report_number).toBe("62860135");
    expect(r.data.wall_area_sqft).toBeCloseTo(28071.9, 1);
    expect(r.data.wall_area_with_windows_doors_sqft).toBe(33247);
    expect(r.data.wall_facets_count).toBe(64);
    expect(r.data.top_of_walls_lf).toBe(760);
    expect(r.data.bottom_of_walls_lf).toBe(760);
    expect(r.data.inside_corners_lf).toBe(529);
    expect(r.data.outside_corners_lf).toBe(412);
    expect(r.data.inside_corners_gt_90_lf).toBe(584);
    expect(r.data.outside_corners_gt_90_lf).toBe(1364);
    expect(r.data.fascia_eaves_rake_lf).toBe(710);
    expect(r.data.window_door_area_sqft).toBe(5175);
    expect(r.data.window_door_count).toBe(255);
    expect(r.data.window_door_perimeter_lf).toBe(4540);
    expect(r.data.has_image_obstruction_warning).toBe(true);
    expect(r.data.has_field_verification_warning).toBe(true);
    expect(r.data.has_soffit_assumption_warning).toBe(true);
    expect(r.missing_fields).toEqual([]);
  });
});
