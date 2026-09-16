import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildBlueprintRoofFacetTopology } from "./blueprint-roof-facet-topology.ts";
import { buildSafeRoofingTakeoff } from "./blueprint-roofing-engine.ts";
import type { PdfLayoutPage, PdfVectorSegment } from "./pdf-layout.ts";
import type { DrawingViewport } from "./blueprint-viewports.ts";

const seg=(x1:number,y1:number,x2:number,y2:number):PdfVectorSegment=>({x1,y1,x2,y2,length_points:Math.hypot(x2-x1,y2-y1),stroke_rgb:[0,0,0],line_width:1,source:"pdf_operator_list"});
const page:PdfLayoutPage={
  page_number:1,width_points:500,height_points:500,rotation_deg:0,
  text_items:[
    {text:"ROOF PLAN",x:200,y:430,width:80,height:12,rotation_deg:0,font_name:"Test"},
    {text:"6/12",x:95,y:95,width:25,height:10,rotation_deg:0,font_name:"Test"},
    {text:"6/12",x:275,y:95,width:25,height:10,rotation_deg:0,font_name:"Test"},
  ],
  vector_segments:[],text:"ROOF PLAN 6/12 6/12",has_selectable_text:true,vector_extraction_status:"completed",
};
const viewport:DrawingViewport={viewport_key:"roof-v1",page_number:1,title:"ROOF PLAN",scale:{raw:'1/4" = 1\'-0"',kind:"architectural",paper_inches:.25,real_feet:1,ratio:null,feet_per_paper_inch:4},bbox:{x:180,y:410,width:120,height:40},confidence:.95,source:"title_scale_cluster",metadata:{version:"test",title_item_text:"ROOF PLAN",scale_item_text:'1/4" = 1\'-0"'}};

Deno.test("planar roof graph resolves two pitched facets and slope-adjusts area",()=>{
  // 360pt x 180pt rectangle split by a center ridge. At 1/4" scale, 72pt = 4ft.
  // Each facet plan area: 180*180 points² => 100 SF. 6/12 factor = sqrt(1.25).
  const segments=[
    seg(20,20,380,20),seg(380,20,380,200),seg(380,200,20,200),seg(20,200,20,20),
    seg(200,20,200,200),
  ];
  const topology=buildBlueprintRoofFacetTopology({page:{...page,vector_segments:segments},segments,feet_per_pdf_point:4/72,roof_outline:[{x:20,y:20},{x:380,y:20},{x:380,y:200},{x:20,y:200}]});
  assertEquals(topology.facets.length,2);
  assertEquals(topology.summary.interior_edges,1);
  assertEquals(topology.summary.perimeter_edges,6);
  assert(topology.facets.every(f=>f.pitch_rise===6));
  assert(topology.facets.every(f=>Math.abs((f.surface_area_sqft??0)-111.8)<0.2));
});

Deno.test("safe roofing takeoff uses facet surface area instead of flat plan area",()=>{
  const left=[{x:20,y:20},{x:200,y:20},{x:200,y:200},{x:20,y:200}];
  const right=[{x:200,y:20},{x:380,y:20},{x:380,y:200},{x:200,y:200}];
  const result=buildSafeRoofingTakeoff({
    import_session_id:"s",source_document_id:"d",pages:[page],viewports_by_page:{1:[viewport]},
    geometry_evidence:[
      {page_number:1,viewport_key:"roof-v1",geometry_class:"facet",points:left,confidence:.9,source:"f1_calibrated_geometry",metadata:{plan_area_sqft:100,surface_area_sqft:111.8,pitch_rise:6,pitch_run:12}},
      {page_number:1,viewport_key:"roof-v1",geometry_class:"facet",points:right,confidence:.9,source:"f1_calibrated_geometry",metadata:{plan_area_sqft:100,surface_area_sqft:111.8,pitch_rise:6,pitch_run:12}},
    ],
  });
  assertEquals(result.measurements.find(m=>m.measurement_key==="total_roof_area_sqft")?.quantity,223.6);
  assertEquals(result.summary.roof_area_sqft,223.6);
  assert(result.review_flags.some(f=>f.flag_code==="ROOF_AREA_SLOPE_ADJUSTED_FROM_FACETS"));
});
