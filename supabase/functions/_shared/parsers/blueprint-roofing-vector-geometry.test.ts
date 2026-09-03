import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildRoofingVectorGeometry, calibratedViewports, MIN_TRUSTED_SCALE_CONFIDENCE } from "./blueprint-roofing-vector-geometry.ts";
import { buildSafeRoofingTakeoff } from "./blueprint-roofing-engine.ts";
import type { DrawingViewport } from "./blueprint-viewports.ts";
import type { PdfLayoutPage, PdfVectorSegment } from "./pdf-layout.ts";
import type { DimensionCandidate } from "./blueprint-dimensions.ts";

const seg=(x1:number,y1:number,x2:number,y2:number):PdfVectorSegment=>({x1,y1,x2,y2,length_points:Math.hypot(x2-x1,y2-y1),stroke_rgb:[0,0,0],line_width:1,source:"pdf_operator_list"});
const viewport:DrawingViewport={viewport_key:"roof-v1",page_number:1,title:"ROOF PLAN",scale:{raw:'1/4" = 1\'-0"',kind:"architectural",paper_inches:0.25,real_feet:1,ratio:null,feet_per_paper_inch:4},bbox:{x:200,y:300,width:100,height:40},confidence:0.95,source:"title_scale_cluster",metadata:{version:"test",title_item_text:"ROOF PLAN",scale_item_text:'1/4" = 1\'-0"'}};
const page:PdfLayoutPage={page_number:1,width_points:612,height_points:792,rotation_deg:0,text_items:[{text:"RIDGE",x:185,y:82,width:30,height:10,rotation_deg:0,font_name:"Test"}],vector_segments:[seg(100,100,280,100),seg(280,100,280,280),seg(280,280,100,280),seg(100,280,100,100)],text:"ROOF PLAN RIDGE",has_selectable_text:true,vector_extraction_status:"completed"};

Deno.test("declared but unverified scale below trust threshold cannot emit geometry measurements",()=>{
  const vector=buildRoofingVectorGeometry({pages:[page],viewports_by_page:{1:[viewport]},dimensions:[]});
  assertEquals(vector.evidence.length,0);
  assertEquals(vector.summary.blocked_untrusted_scales,1);
  assert(vector.review_flags.some(f=>f.flag_code==="ROOF_VIEWPORT_SCALE_CONFIRMATION_REQUIRED"&&f.blocking));
  const calibration=vector.calibrations[0].calibration;
  assert(calibration.confidence<MIN_TRUSTED_SCALE_CONFIDENCE);
  const calibrated=calibratedViewports({1:[viewport]},vector.calibrations);
  assertEquals(calibrated[1][0].scale,null);
  const takeoff=buildSafeRoofingTakeoff({import_session_id:"s",source_document_id:"d",pages:[page],viewports_by_page:calibrated,geometry_evidence:vector.evidence});
  assertEquals(takeoff.measurements.find(m=>m.measurement_key==="total_roof_area_sqft"),undefined);
});

Deno.test("dimension-validated scale emits calibrated roof area",()=>{
  const dimensions:DimensionCandidate[]=[{
    page_number:1,
    viewport_key:"roof-v1",
    label_text:"10'-0\"",
    normalized_feet:10,
    bbox:{x:245,y:315,width:10,height:10},
    confidence:0.9,
    source:"explicit_dimension_text",
    metadata:{version:"test",requires_review:true},
  }];
  const vector=buildRoofingVectorGeometry({pages:[page],viewports_by_page:{1:[viewport]},dimensions});
  assertEquals(vector.calibrations[0].calibration.status,"validated");
  assert(vector.calibrations[0].calibration.confidence>=MIN_TRUSTED_SCALE_CONFIDENCE);
  assertEquals(vector.evidence.filter(e=>e.geometry_class==="outline").length,1);
  assertEquals((vector.evidence.find(e=>e.geometry_class==="outline")?.metadata as any).area_sqft,100);
  const calibrated=calibratedViewports({1:[viewport]},vector.calibrations);
  const takeoff=buildSafeRoofingTakeoff({import_session_id:"s",source_document_id:"d",pages:[page],viewports_by_page:calibrated,geometry_evidence:vector.evidence});
  assertEquals(takeoff.measurements.find(m=>m.measurement_key==="total_roof_area_sqft")?.quantity,100);
});
