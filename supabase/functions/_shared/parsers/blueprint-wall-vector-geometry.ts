import type { PdfLayoutPage, PdfVectorSegment } from "./pdf-layout.ts";
import type { DrawingViewport } from "./blueprint-viewports.ts";
import type { DimensionCandidate } from "./blueprint-dimensions.ts";
import { calibrateBlueprintScale, type ScaleDimensionAnchor, type ScaleCalibrationResult } from "./blueprint-scale-calibration.ts";
import { reconstructClosedLoops } from "./blueprint-roofing-topology.ts";

export const BLUEPRINT_WALL_VECTOR_GEOMETRY_VERSION = "wall-vector-geometry-v1";
const TRUSTED_SCALE_CONFIDENCE = 0.85;
const ELEVATION_RE=/\b(?:EXTERIOR\s+ELEVATION|BUILDING\s+ELEVATION|NORTH\s+ELEVATION|SOUTH\s+ELEVATION|EAST\s+ELEVATION|WEST\s+ELEVATION)\b/i;

type Pt={x:number;y:number};
export interface WallElevationEvidence {page_number:number;viewport_key:string;points:Pt[];gross_area_sqft:number;confidence:number;direction:string|null;metadata:Record<string,unknown>}
export interface WallVectorGeometryResult {
  evidence:WallElevationEvidence[];
  calibrations:Array<{page_number:number;viewport_key:string;calibration:ScaleCalibrationResult}>;
  review_flags:Array<{flag_code:string;severity:"info"|"warning"|"error"|"blocker";blocking:boolean;message:string;metadata?:Record<string,unknown>}>;
  summary:{elevation_viewports:number;validated_scales:number;blocked_untrusted_scales:number;gross_wall_elevations:number;gross_wall_area_sqft:number};
}

function center(v:DrawingViewport):Pt{return{x:v.bbox.x+v.bbox.width/2,y:v.bbox.y+v.bbox.height/2}}
function midpoint(s:PdfVectorSegment):Pt{return{x:(s.x1+s.x2)/2,y:(s.y1+s.y2)/2}}
function dist(a:Pt,b:Pt){return Math.hypot(a.x-b.x,a.y-b.y)}
function nearestViewport(p:Pt,viewports:DrawingViewport[]){return viewports.map(v=>({v,d:dist(p,center(v))})).sort((a,b)=>a.d-b.d)[0]?.v??null}
function polygonArea(points:Pt[]){let a=0;for(let i=0;i<points.length;i++){const p=points[i],q=points[(i+1)%points.length];a+=p.x*q.y-q.x*p.y}return Math.abs(a)/2}
function box(points:Pt[]){const xs=points.map(p=>p.x),ys=points.map(p=>p.y);return{w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)}}
function directionFromTitle(title:string|null){const m=(title??"").match(/\b(NORTH|SOUTH|EAST|WEST)\b/i);return m?m[1].toLowerCase():null}
function anchorsFor(viewport:DrawingViewport,all:DrawingViewport[],dimensions:DimensionCandidate[],segments:PdfVectorSegment[]):ScaleDimensionAnchor[]{
  const out:ScaleDimensionAnchor[]=[];
  for(const dim of dimensions){
    if(dim.page_number!==viewport.page_number)continue;
    const dc={x:dim.bbox.x+dim.bbox.width/2,y:dim.bbox.y+dim.bbox.height/2};
    if(nearestViewport(dc,all)?.viewport_key!==viewport.viewport_key)continue;
    const chosen=segments.map(s=>({s,d:dist(dc,midpoint(s))})).filter(x=>x.d<=Math.max(36,dim.bbox.height*5)&&x.s.length_points>=Math.max(8,dim.bbox.width*1.2)).sort((a,b)=>a.d-b.d)[0]?.s;
    if(chosen)out.push({known_feet:dim.normalized_feet,pdf_distance_points:chosen.length_points,source_text:dim.label_text,confidence:Math.min(.72,dim.confidence*.78)});
  }
  return out.slice(0,8);
}

export function buildWallVectorGeometry(input:{pages:PdfLayoutPage[];viewports_by_page:Record<number,DrawingViewport[]>|Map<number,DrawingViewport[]>;dimensions?:DimensionCandidate[]}):WallVectorGeometryResult{
  const evidence:WallElevationEvidence[]=[],calibrations:WallVectorGeometryResult["calibrations"]=[],review_flags:WallVectorGeometryResult["review_flags"]=[];
  let elevationViewports=0,validatedScales=0,blockedUntrustedScales=0;
  const getV=(n:number)=>input.viewports_by_page instanceof Map?(input.viewports_by_page.get(n)??[]):(input.viewports_by_page[n]??[]);
  for(const page of input.pages){
    const viewports=getV(page.page_number);if(!viewports.length)continue;
    for(const viewport of viewports){
      const title=`${viewport.title??""} ${viewport.metadata.title_item_text??""}`;
      if(!ELEVATION_RE.test(title)&&!(viewports.length===1&&ELEVATION_RE.test(page.text)))continue;
      elevationViewports++;
      const assigned=page.vector_segments.filter(s=>nearestViewport(midpoint(s),viewports)?.viewport_key===viewport.viewport_key);
      const calibration=calibrateBlueprintScale(viewport.scale,anchorsFor(viewport,viewports,input.dimensions??[],assigned));
      calibrations.push({page_number:page.page_number,viewport_key:viewport.viewport_key,calibration});
      const trusted=calibration.status==="validated"&&calibration.confidence>=TRUSTED_SCALE_CONFIDENCE&&calibration.feet_per_pdf_point!=null;
      if(!trusted){blockedUntrustedScales++;review_flags.push({flag_code:"WALL_ELEVATION_SCALE_CONFIRMATION_REQUIRED",severity:"blocker",blocking:true,message:`Exterior elevation ${viewport.title??viewport.viewport_key} needs a dimension-validated scale before wall SF can be generated.`,metadata:{page_number:page.page_number,viewport_key:viewport.viewport_key,status:calibration.status,confidence:calibration.confidence,threshold:TRUSTED_SCALE_CONFIDENCE}});continue;}
      validatedScales++;
      const loops=reconstructClosedLoops(assigned,3).filter(points=>{const b=box(points),a=polygonArea(points);return points.length>=3&&b.w>=24&&b.h>=18&&a>=500&&a<page.width_points*page.height_points*.7});
      loops.sort((a,b)=>polygonArea(b)-polygonArea(a));const outline=loops[0];
      if(!outline){review_flags.push({flag_code:"WALL_ELEVATION_OUTLINE_NOT_RESOLVED",severity:"warning",blocking:false,message:`No closed exterior elevation outline was resolved for ${viewport.title??viewport.viewport_key}; manual wall measurement remains required.`,metadata:{page_number:page.page_number,viewport_key:viewport.viewport_key}});continue;}
      const gross=polygonArea(outline)*calibration.feet_per_pdf_point!*calibration.feet_per_pdf_point!;
      if(!Number.isFinite(gross)||gross<=0)continue;
      evidence.push({page_number:page.page_number,viewport_key:viewport.viewport_key,points:outline,gross_area_sqft:Number(gross.toFixed(2)),confidence:Math.min(.9,calibration.confidence,viewport.confidence),direction:directionFromTitle(viewport.title),metadata:{version:BLUEPRINT_WALL_VECTOR_GEOMETRY_VERSION,measurement_key:"wall_area_with_windows_doors_sqft",measurement_scope:"gross_exterior_elevation_area_only",openings_subtracted:false,requires_review:true,scale_status:calibration.status}});
    }
  }
  const total=evidence.reduce((s,e)=>s+e.gross_area_sqft,0);
  return{evidence,calibrations,review_flags,summary:{elevation_viewports:elevationViewports,validated_scales:validatedScales,blocked_untrusted_scales:blockedUntrustedScales,gross_wall_elevations:evidence.length,gross_wall_area_sqft:Number(total.toFixed(2))}};
}
