// Converts raw PDF vector segments into conservative roofing geometry evidence.
// Scale ownership is viewport-specific. Closed-loop extraction is intentionally
// conservative: only simple large closed components become roof outlines.

import type { PdfLayoutPage, PdfVectorSegment } from "./pdf-layout.ts";
import type { DrawingViewport } from "./blueprint-viewports.ts";
import type { DimensionCandidate } from "./blueprint-dimensions.ts";
import { calibrateBlueprintScale, type ScaleDimensionAnchor, type ScaleCalibrationResult } from "./blueprint-scale-calibration.ts";
import type { RoofingGeometryEvidence } from "./blueprint-roofing-takeoff.ts";

export const ROOFING_VECTOR_GEOMETRY_VERSION = "roofing-vector-geometry-v2";

export interface RoofingVectorGeometryResult {
  evidence: RoofingGeometryEvidence[];
  calibrations: Array<{ page_number: number; viewport_key: string; calibration: ScaleCalibrationResult }>;
  review_flags: Array<{ flag_code: string; severity: "info" | "warning" | "error" | "blocker"; blocking: boolean; message: string; metadata?: Record<string, unknown> }>;
  summary: { vector_segments: number; roof_viewports: number; closed_components: number; roof_outlines: number; validated_scales: number };
}

const ROOF_RE = /\b(ROOF|ROOFING|TPO|EPDM|PVC|SHINGLE|STANDING\s+SEAM)\b/i;
type Pt = { x: number; y: number };

function viewportAnchor(v: DrawingViewport): Pt { return { x: v.bbox.x + v.bbox.width / 2, y: v.bbox.y + v.bbox.height / 2 }; }
function midpoint(s: PdfVectorSegment): Pt { return { x: (s.x1+s.x2)/2, y:(s.y1+s.y2)/2 }; }
function dist(a: Pt,b: Pt) { return Math.hypot(a.x-b.x,a.y-b.y); }
function nearestViewport(point: Pt, viewports: DrawingViewport[]): DrawingViewport | null {
  return viewports.map(v=>({v,d:dist(point,viewportAnchor(v))})).sort((a,b)=>a.d-b.d)[0]?.v ?? null;
}

function dimensionAnchors(
  viewport: DrawingViewport,
  allViewports: DrawingViewport[],
  dimensions: DimensionCandidate[],
  segments: PdfVectorSegment[],
): ScaleDimensionAnchor[] {
  const out: ScaleDimensionAnchor[] = [];
  for (const dim of dimensions) {
    if (dim.page_number !== viewport.page_number) continue;
    const dc = { x: dim.bbox.x + dim.bbox.width/2, y: dim.bbox.y + dim.bbox.height/2 };
    if (nearestViewport(dc, allViewports)?.viewport_key !== viewport.viewport_key) continue;
    const nearby = segments
      .map(s=>({s,d:dist(dc,midpoint(s))}))
      .filter(x=>x.d <= Math.max(36, dim.bbox.height*5) && x.s.length_points >= Math.max(8,dim.bbox.width*1.2))
      .sort((a,b)=>a.d-b.d);
    const chosen = nearby[0]?.s;
    if (!chosen) continue;
    out.push({ known_feet: dim.normalized_feet, pdf_distance_points: chosen.length_points, source_text: dim.label_text, confidence: Math.min(0.72, dim.confidence*0.78) });
  }
  return out.slice(0,8);
}

function snapKey(p: Pt, tolerance=1.5): string { return `${Math.round(p.x/tolerance)}:${Math.round(p.y/tolerance)}`; }
function closedComponents(segments: PdfVectorSegment[]): Pt[][] {
  const nodes = new Map<string,{sumX:number;sumY:number;n:number;edges:number[]}>();
  const edges = segments.map((s,i)=>({i,a:snapKey({x:s.x1,y:s.y1}),b:snapKey({x:s.x2,y:s.y2})}));
  const addNode=(k:string,p:Pt,e:number)=>{ const n=nodes.get(k)??{sumX:0,sumY:0,n:0,edges:[]}; n.sumX+=p.x;n.sumY+=p.y;n.n++;n.edges.push(e);nodes.set(k,n); };
  edges.forEach((e,i)=>{const s=segments[i];addNode(e.a,{x:s.x1,y:s.y1},i);addNode(e.b,{x:s.x2,y:s.y2},i);});
  const visited=new Set<number>(); const loops:Pt[][]=[];
  for(let seed=0;seed<edges.length;seed++){
    if(visited.has(seed)) continue;
    const compEdges:number[]=[]; const queue=[seed]; const compNodes=new Set<string>();
    while(queue.length){const ei=queue.pop()!;if(visited.has(ei))continue;visited.add(ei);compEdges.push(ei);const e=edges[ei];compNodes.add(e.a);compNodes.add(e.b);for(const k of [e.a,e.b]) for(const next of nodes.get(k)?.edges??[]) if(!visited.has(next))queue.push(next);}
    if(compEdges.length<3 || [...compNodes].some(k=>(nodes.get(k)?.edges.length??0)!==2)) continue;
    const first=edges[compEdges[0]]; let current=first.a; let prevEdge=-1; const ordered:Pt[]=[]; const max=compEdges.length+2;
    for(let step=0;step<max;step++){
      const n=nodes.get(current)!; ordered.push({x:n.sumX/n.n,y:n.sumY/n.n});
      const nextEdge=n.edges.find(e=>e!==prevEdge); if(nextEdge==null)break;
      const edge=edges[nextEdge]; const next=edge.a===current?edge.b:edge.a; prevEdge=nextEdge; current=next;
      if(current===first.a)break;
    }
    if(current===first.a && ordered.length>=3) loops.push(ordered);
  }
  return loops;
}
function polygonArea(points:Pt[]):number { let a=0;for(let i=0;i<points.length;i++){const p=points[i],q=points[(i+1)%points.length];a+=p.x*q.y-q.x*p.y;}return Math.abs(a)/2; }
function bbox(points:Pt[]){const xs=points.map(p=>p.x),ys=points.map(p=>p.y);return {width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};}

export function calibratedViewports(
  viewportsByPage: Record<number,DrawingViewport[]>|Map<number,DrawingViewport[]>,
  calibrations: RoofingVectorGeometryResult["calibrations"],
): Record<number,DrawingViewport[]> {
  const out:Record<number,DrawingViewport[]>={};
  const entries=viewportsByPage instanceof Map?[...viewportsByPage.entries()]:Object.entries(viewportsByPage).map(([k,v])=>[Number(k),v] as [number,DrawingViewport[]]);
  const byKey=new Map(calibrations.map(c=>[c.viewport_key,c.calibration]));
  for(const [page,viewports] of entries){
    out[page]=viewports.map(v=>{
      const c=byKey.get(v.viewport_key); if(!c?.feet_per_pdf_point)return v;
      const feetPerPaperInch=c.feet_per_pdf_point*72;
      return {...v,scale:{raw:v.scale?.raw??`CALIBRATED ${feetPerPaperInch.toFixed(6)} FT/IN`,kind:"architectural",paper_inches:1,real_feet:feetPerPaperInch,ratio:null,feet_per_paper_inch:feetPerPaperInch}};
    });
  }
  return out;
}

export function buildRoofingVectorGeometry(input:{pages:PdfLayoutPage[];viewports_by_page:Map<number,DrawingViewport[]>|Record<number,DrawingViewport[]>;dimensions?:DimensionCandidate[]}):RoofingVectorGeometryResult{
  const evidence:RoofingGeometryEvidence[]=[]; const calibrations:RoofingVectorGeometryResult["calibrations"]=[]; const review_flags:RoofingVectorGeometryResult["review_flags"]=[];
  let vectorSegments=0,roofViewports=0,closedCount=0,validated=0;
  const getV=(n:number)=>input.viewports_by_page instanceof Map?(input.viewports_by_page.get(n)??[]):(input.viewports_by_page[n]??[]);
  for(const page of input.pages){
    vectorSegments+=page.vector_segments.length; const vs=getV(page.page_number); if(!vs.length)continue;
    for(const viewport of vs){
      const roof=ROOF_RE.test(`${viewport.title??""} ${viewport.metadata.title_item_text??""}`)||(vs.length===1&&/\bROOF\s+PLAN\b/i.test(page.text)); if(!roof)continue; roofViewports++;
      const assigned=page.vector_segments.filter(s=>nearestViewport(midpoint(s),vs)?.viewport_key===viewport.viewport_key);
      const anchors=dimensionAnchors(viewport,vs,input.dimensions??[],assigned);
      const calibration=calibrateBlueprintScale(viewport.scale,anchors); calibrations.push({page_number:page.page_number,viewport_key:viewport.viewport_key,calibration}); if(calibration.status==="validated")validated++;
      if(calibration.feet_per_pdf_point==null){review_flags.push({flag_code:"ROOF_VIEWPORT_SCALE_BLOCKED",severity:"blocker",blocking:true,message:`Roof viewport ${viewport.title??viewport.viewport_key} has no trustworthy usable scale: ${calibration.message}`,metadata:{page_number:page.page_number,viewport_key:viewport.viewport_key,status:calibration.status}});continue;}
      if(calibration.review_required) review_flags.push({flag_code:"ROOF_VIEWPORT_SCALE_REVIEW",severity:"warning",blocking:false,message:calibration.message,metadata:{page_number:page.page_number,viewport_key:viewport.viewport_key,status:calibration.status,anchors_used:calibration.anchors_used}});
      const loops=closedComponents(assigned).filter(p=>{const b=bbox(p),a=polygonArea(p);return p.length>=3&&b.width>=24&&b.height>=24&&a>=600&&a<page.width_points*page.height_points*0.65;}); closedCount+=loops.length;
      loops.sort((a,b)=>polygonArea(b)-polygonArea(a)); const outline=loops[0]; if(!outline)continue;
      const areaPts=polygonArea(outline); const areaSqft=areaPts*calibration.feet_per_pdf_point*calibration.feet_per_pdf_point;
      evidence.push({page_number:page.page_number,viewport_key:viewport.viewport_key,geometry_class:"outline",points:outline,confidence:Math.min(viewport.confidence,calibration.confidence,0.9),source:"f1_calibrated_geometry",metadata:{version:ROOFING_VECTOR_GEOMETRY_VERSION,area_points2:areaPts,area_sqft:Number(areaSqft.toFixed(2)),scale_status:calibration.status,scale_raw:viewport.scale?.raw??null,requires_review:calibration.review_required}});
    }
  }
  return {evidence,calibrations,review_flags,summary:{vector_segments:vectorSegments,roof_viewports:roofViewports,closed_components:closedCount,roof_outlines:evidence.filter(e=>e.geometry_class==="outline").length,validated_scales:validated}};
}
