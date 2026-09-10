import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { reconstructClosedLoops, detectRoofGraphicSymbols } from "./blueprint-roofing-topology.ts";
import type { PdfLayoutPage, PdfVectorSegment } from "./pdf-layout.ts";
const seg=(x1:number,y1:number,x2:number,y2:number):PdfVectorSegment=>({x1,y1,x2,y2,length_points:Math.hypot(x2-x1,y2-y1),stroke_rgb:[0,0,0],line_width:1,source:"pdf_operator_list"});
Deno.test("reconstructs a roof loop across small CAD drafting gaps",()=>{const loops=reconstructClosedLoops([seg(0,0,49,0),seg(51,0,100,0),seg(100,0,100,100),seg(100,100,0,100),seg(0,100,0,0)]);assert(loops.length>=1);assertEquals(loops[0].length>=4,true);});
Deno.test("detects a compact roof curb symbol from orthogonal vector box",()=>{const page:PdfLayoutPage={page_number:1,width_points:500,height_points:500,rotation_deg:0,text_items:[],vector_segments:[],text:"ROOF PLAN",has_selectable_text:true,vector_extraction_status:"completed"};const symbols=detectRoofGraphicSymbols(page,[seg(100,100,130,100),seg(130,100,130,130),seg(130,130,100,130),seg(100,130,100,100)]);assert(symbols.some(s=>s.kind==="curb"));});
