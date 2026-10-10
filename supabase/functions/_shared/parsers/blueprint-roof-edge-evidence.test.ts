import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyRoofEdgesFromPlanLabels } from "./blueprint-roof-edge-evidence.ts";
import type { BlueprintRoofTopologyEdge } from "./blueprint-roof-facet-topology.ts";
import type { PdfLayoutPage } from "./pdf-layout.ts";

const interior:BlueprintRoofTopologyEdge={edge_key:"ridge-edge",start:{x:200,y:20},end:{x:200,y:200},adjacent_facet_keys:["f1","f2"],topology_class:"interior",confidence:.95};
const perimeter:BlueprintRoofTopologyEdge={edge_key:"eave-edge",start:{x:20,y:200},end:{x:200,y:200},adjacent_facet_keys:["f1"],topology_class:"perimeter",confidence:.95};
function page(label:string,x:number,y:number):PdfLayoutPage{return{page_number:1,width_points:500,height_points:500,rotation_deg:0,text_items:[{text:label,x,y,width:50,height:10,rotation_deg:0,font_name:"Test"}],vector_segments:[],text:label,has_selectable_text:true,vector_extraction_status:"completed"};}

Deno.test("ridge label emits LF only on an interior facet edge",()=>{
  const result=classifyRoofEdgesFromPlanLabels({page:page("RIDGE",175,100),page_number:1,viewport_key:"v1",edges:[interior,perimeter],feet_per_pdf_point:4/72});
  assertEquals(result.evidence.length,1);
  assertEquals(result.evidence[0].geometry_class,"ridge");
  assertEquals(result.evidence[0].length_ft,10);
  assertEquals(result.summary.topology_conflicts,0);
});

Deno.test("eave label nearest an interior edge is rejected as topology conflict",()=>{
  const result=classifyRoofEdgesFromPlanLabels({page:page("EAVE",175,100),page_number:1,viewport_key:"v1",edges:[interior,perimeter],feet_per_pdf_point:4/72});
  assertEquals(result.evidence.length,0);
  assertEquals(result.summary.topology_conflicts,1);
  assert(result.review_flags.some(f=>f.flag_code==="ROOF_EDGE_LABEL_TOPOLOGY_CONFLICT"));
});
