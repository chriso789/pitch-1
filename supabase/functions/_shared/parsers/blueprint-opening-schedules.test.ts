import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractOpeningSchedules } from "./blueprint-opening-schedules.ts";
import type { PdfLayoutPage } from "./pdf-layout.ts";
const page=(textItems:any[]):PdfLayoutPage=>({page_number:1,width_points:612,height_points:792,rotation_deg:0,text_items:textItems,vector_segments:[],text:textItems.map(i=>i.text).join(" "),has_selectable_text:true,vector_extraction_status:"completed"});
Deno.test("extracts explicit window and door schedule dimensions and quantities",()=>{
 const p=page([
  {text:"WINDOW SCHEDULE",x:10,y:10,width:90,height:10,rotation_deg:0,font_name:null},
  {text:"WINDOW MARK W1 3'-0\" x 5'-0\" QTY 2",x:10,y:40,width:240,height:10,rotation_deg:0,font_name:null},
  {text:"DOOR MARK D1 3'-0\" x 7'-0\" QUANTITY 1",x:10,y:60,width:250,height:10,rotation_deg:0,font_name:null},
 ]);
 const r=extractOpeningSchedules([p]);
 assertEquals(r.summary.window_count,2);assertEquals(r.summary.door_count,1);assertEquals(r.summary.opening_area_sqft,51);assertEquals(r.summary.net_wall_area_ready,false);assertEquals(r.review_flags[0].blocking,true);
});
Deno.test("does not invent dimensions from schedule rows",()=>{
 const p=page([{text:"DOOR SCHEDULE",x:10,y:10,width:90,height:10,rotation_deg:0,font_name:null},{text:"DOOR TYPE D2 QTY 4",x:10,y:40,width:150,height:10,rotation_deg:0,font_name:null}]);
 const r=extractOpeningSchedules([p]);assertEquals(r.items.length,0);
});
