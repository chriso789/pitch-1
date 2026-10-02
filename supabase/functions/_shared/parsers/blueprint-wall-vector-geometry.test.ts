import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildWallVectorGeometry } from "./blueprint-wall-vector-geometry.ts";
import type { PdfLayoutPage, PdfVectorSegment } from "./pdf-layout.ts";
import type { DrawingViewport } from "./blueprint-viewports.ts";

const seg=(x1:number,y1:number,x2:number,y2:number):PdfVectorSegment=>({x1,y1,x2,y2,length_points:Math.hypot(x2-x1,y2-y1),stroke_rgb:[0,0,0],line_width:1,source:"pdf_operator_list"});
const viewport:DrawingViewport={viewport_key:"elev-1",page_number:1,title:"NORTH EXTERIOR ELEVATION",scale:{raw:'1/4" = 1\'-0"',kind:"architectural",paper_inches:.25,real_feet:1,ratio:null,feet_per_paper_inch:4},bbox:{x:80,y:80,width:300,height:220},confidence:.95,source:"title_scale_cluster",metadata:{version:"test",title_item_text:"NORTH EXTERIOR ELEVATION",scale_item_text:'1/4" = 1\'-0"'}};
const page:PdfLayoutPage={page_number:1,width_points:612,height_points:792,rotation_deg:0,text_items:[],vector_segments:[seg(100,100,280,100),seg(280,100,280,208),seg(280,208,100,208),seg(100,208,100,100)],text:"NORTH EXTERIOR ELEVATION",has_selectable_text:true,vector_extraction_status:"completed"};

Deno.test("unverified elevation scale blocks wall SF",()=>{
  const out=buildWallVectorGeometry({pages:[page],viewports_by_page:{1:[viewport]},dimensions:[]});
  assertEquals(out.evidence.length,0);
  assertEquals(out.summary.blocked_untrusted_scales,1);
  assert(out.review_flags.some(f=>f.flag_code==="WALL_ELEVATION_SCALE_CONFIRMATION_REQUIRED"));
});

Deno.test("dimension-validated elevation emits gross wall area only",()=>{
  const out=buildWallVectorGeometry({pages:[page],viewports_by_page:{1:[viewport]},dimensions:[{page_number:1,viewport_key:"elev-1",label_text:"10'-0\"",normalized_feet:10,bbox:{x:170,y:90,width:20,height:8},confidence:.95,source:"explicit_dimension_text",metadata:{version:"test",requires_review:true}}]});
  assertEquals(out.evidence.length,1);
  assertEquals(out.evidence[0].gross_area_sqft,60);
  assertEquals(out.evidence[0].metadata.openings_subtracted,false);
  assertEquals(out.summary.validated_scales,1);
});
