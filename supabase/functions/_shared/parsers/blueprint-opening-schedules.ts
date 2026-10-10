import type { PdfLayoutPage, PdfLayoutTextItem } from "./pdf-layout.ts";

export const BLUEPRINT_OPENING_SCHEDULE_VERSION = "opening-schedule-v1";

export type OpeningKind = "window" | "door";
export interface BlueprintOpeningScheduleItem {
  page_number:number;
  kind:OpeningKind;
  mark:string|null;
  width_ft:number;
  height_ft:number;
  quantity:number;
  area_sqft:number;
  perimeter_lf:number;
  confidence:number;
  source_text:string;
  bbox:{x:number;y:number;width:number;height:number};
  metadata:{version:string;explicit_dimensions:true;explicit_quantity:boolean;exterior_assignment:"unresolved"};
}
export interface BlueprintOpeningScheduleResult {
  items:BlueprintOpeningScheduleItem[];
  review_flags:Array<{flag_code:string;severity:"info"|"warning"|"error"|"blocker";blocking:boolean;message:string;metadata?:Record<string,unknown>}>;
  summary:{window_count:number;door_count:number;total_count:number;opening_area_sqft:number;opening_perimeter_lf:number;rows_rejected:number;net_wall_area_ready:false};
}

const SCHEDULE_RE=/\b(?:WINDOW|DOOR)\s+SCHEDULE\b/i;
const DIM_RE=/(\d+)\s*['’]\s*(?:-\s*)?(\d+(?:\.\d+)?|\d+\s*\/\s*\d+)?\s*["”]?\s*[xX×]\s*(\d+)\s*['’]\s*(?:-\s*)?(\d+(?:\.\d+)?|\d+\s*\/\s*\d+)?\s*["”]?/;
const DIM_INCH_RE=/(\d+(?:\.\d+)?)\s*["”]\s*[xX×]\s*(\d+(?:\.\d+)?)\s*["”]/;
const QTY_RE=/\b(?:QTY|QUANTITY)\s*[:#-]?\s*(\d+)\b/i;
const TYPE_RE=/\b(WINDOW|DOOR)\b/i;
const MARK_RE=/\b(?:MARK|TYPE)\s*[:#-]?\s*([A-Z0-9.-]{1,12})\b/i;

function fraction(raw:string|undefined):number{if(!raw)return 0;const m=raw.trim().match(/^(\d+)\s*\/\s*(\d+)$/);if(m){const d=Number(m[2]);return d?Number(m[1])/d:0;}const n=Number(raw);return Number.isFinite(n)?n:0;}
function dims(text:string):{w:number;h:number}|null{
  const f=text.match(DIM_RE);if(f)return{w:Number(f[1])+fraction(f[2])/12,h:Number(f[3])+fraction(f[4])/12};
  const i=text.match(DIM_INCH_RE);if(i)return{w:Number(i[1])/12,h:Number(i[2])/12};
  return null;
}
function bbox(items:PdfLayoutTextItem[]){const x=Math.min(...items.map(i=>i.x)),y=Math.min(...items.map(i=>i.y));const r=Math.max(...items.map(i=>i.x+i.width)),b=Math.max(...items.map(i=>i.y+i.height));return{x,y,width:r-x,height:b-y};}
function rows(page:PdfLayoutPage):PdfLayoutTextItem[][]{
  const tol=Math.max(3,page.height_points*.004);const map=new Map<number,PdfLayoutTextItem[]>();
  for(const item of page.text_items){const k=Math.round(item.y/tol);const row=map.get(k)??[];row.push(item);map.set(k,row);}return[...map.values()].map(r=>r.sort((a,b)=>a.x-b.x));
}

export function extractOpeningSchedules(pages:PdfLayoutPage[]):BlueprintOpeningScheduleResult{
  const items:BlueprintOpeningScheduleItem[]=[],review_flags:BlueprintOpeningScheduleResult["review_flags"]=[];let rejected=0;
  for(const page of pages){if(!SCHEDULE_RE.test(page.text))continue;
    for(const row of rows(page)){
      const text=row.map(i=>i.text).join(" ").replace(/\s+/g," ").trim();
      const type=text.match(TYPE_RE)?.[1]?.toLowerCase() as OpeningKind|undefined; if(!type)continue;
      const d=dims(text);if(!d||d.w<=0||d.h<=0){if(/\bWINDOW|DOOR\b/i.test(text)&&/\b(?:MARK|TYPE|QTY|QUANTITY)\b/i.test(text))rejected++;continue;}
      const qm=text.match(QTY_RE);const quantity=qm?Number(qm[1]):1;if(!Number.isInteger(quantity)||quantity<=0){rejected++;continue;}
      const area=d.w*d.h*quantity;const per=2*(d.w+d.h)*quantity;const mark=text.match(MARK_RE)?.[1]??null;
      items.push({page_number:page.page_number,kind:type,mark,width_ft:Number(d.w.toFixed(4)),height_ft:Number(d.h.toFixed(4)),quantity,area_sqft:Number(area.toFixed(2)),perimeter_lf:Number(per.toFixed(2)),confidence:qm?.[1]?0.95:0.86,source_text:text,bbox:bbox(row),metadata:{version:BLUEPRINT_OPENING_SCHEDULE_VERSION,explicit_dimensions:true,explicit_quantity:Boolean(qm?.[1]),exterior_assignment:"unresolved"}});
    }
  }
  if(items.length)review_flags.push({flag_code:"OPENING_EXTERIOR_ASSIGNMENT_REQUIRED",severity:"blocker",blocking:true,message:"Window/door schedule quantities were extracted, but they are not yet proven to be exterior-elevation openings. Net siding/paint wall area remains blocked until elevation marks are reconciled.",metadata:{opening_rows:items.length,version:BLUEPRINT_OPENING_SCHEDULE_VERSION}});
  const windowCount=items.filter(i=>i.kind==="window").reduce((s,i)=>s+i.quantity,0),doorCount=items.filter(i=>i.kind==="door").reduce((s,i)=>s+i.quantity,0);
  return{items,review_flags,summary:{window_count:windowCount,door_count:doorCount,total_count:windowCount+doorCount,opening_area_sqft:Number(items.reduce((s,i)=>s+i.area_sqft,0).toFixed(2)),opening_perimeter_lf:Number(items.reduce((s,i)=>s+i.perimeter_lf,0).toFixed(2)),rows_rejected:rejected,net_wall_area_ready:false}};
}
