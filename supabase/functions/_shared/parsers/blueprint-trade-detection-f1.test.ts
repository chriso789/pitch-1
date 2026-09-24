import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { detectBlueprintTradesF1 } from "./blueprint-trade-detection-f1.ts";
import type { BlueprintF1RuntimeResult } from "./blueprint-f1-runtime.ts";

function fixture(): BlueprintF1RuntimeResult {
  return {
    runtime_version:"test", layout_version:"test", sheet_intelligence_version:"test", viewport_version:"test", reference_version:"test", page_count:3,
    pages:[
      {page_number:1,raw_text:"A201 EXTERIOR ELEVATIONS HARDIE SIDING STUCCO FASCIA SOFFIT WINDOW DOOR",page_type:"unknown",page_subtype:"architectural",page_type_confidence:.9,sheet_name:"EXTERIOR ELEVATIONS",sheet_number:"A201",scale_text:'1/4" = 1\'-0"',scale_source:"pdf_layout",width_points:612,height_points:792,layout_version:"test",layout_extraction_status:"completed",layout_json:{rotation_deg:0,text_items:[],vector_extraction_status:"completed",vector_segment_count:0,title_block_bbox:null,discipline:"architectural",normalized_scale:null,sheet_intelligence_version:"test",viewport_version:"test",reference_version:"test",requires_review:false}},
      {page_number:2,raw_text:"A501 PARTITION TYPES 5/8 GWB METAL STUDS",page_type:"detail_sheet",page_subtype:"drywall",page_type_confidence:.9,sheet_name:"PARTITION TYPES",sheet_number:"A501",scale_text:null,scale_source:null,width_points:612,height_points:792,layout_version:"test",layout_extraction_status:"completed",layout_json:{rotation_deg:0,text_items:[],vector_extraction_status:"completed",vector_segment_count:0,title_block_bbox:null,discipline:"architectural",normalized_scale:null,sheet_intelligence_version:"test",viewport_version:"test",reference_version:"test",requires_review:false}},
      {page_number:3,raw_text:"S101 FLOOR FRAMING PLAN JOIST HEADER",page_type:"framing_plan",page_subtype:"structural_framing",page_type_confidence:.95,sheet_name:"FLOOR FRAMING PLAN",sheet_number:"S101",scale_text:null,scale_source:null,width_points:612,height_points:792,layout_version:"test",layout_extraction_status:"completed",layout_json:{rotation_deg:0,text_items:[],vector_extraction_status:"completed",vector_segment_count:0,title_block_bbox:null,discipline:"structural",normalized_scale:null,sheet_intelligence_version:"test",viewport_version:"test",reference_version:"test",requires_review:false}},
    ],
    analyzed_sheets:[],sheet_index_entries:[],drawing_viewports:[],drawing_references:[],layout_pages:[],viewports_by_page:{},specifications:[],dimensions:[],missing_indexed_sheets:[],unresolved_reference_targets:[],requires_review:false,
    summary:{pages_with_sheet_number:3,pages_with_scale:1,index_entry_count:0,missing_indexed_sheet_count:0,image_only_page_count:0,viewport_count:0,scaled_viewport_count:0,reference_count:0,unresolved_reference_target_count:0,specification_candidate_count:0,dimension_candidate_count:0,vector_segment_count:0,vector_failed_page_count:0},
  };
}

Deno.test("detects exterior and future trades from architectural/structural evidence",()=>{
  const trades=detectBlueprintTradesF1(fixture());
  const ids=trades.map(t=>t.trade_id);
  for(const expected of ["exterior_walls_siding","gutters_fascia_trim","windows_doors","drywall","framing"]) assert(ids.includes(expected as any));
  assertEquals(trades.find(t=>t.trade_id==="drywall")?.support_status,"future_supported");
  assertEquals(trades.find(t=>t.trade_id==="drywall")?.review_state,"manual_only");
  assert((trades.find(t=>t.trade_id==="exterior_walls_siding")?.confidence ?? 0) > .6);
});
