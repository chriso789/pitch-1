// Converts raw PDF vector segments into conservative roofing geometry evidence.
// Scale ownership is viewport-specific; fragmented CAD and facet reconstruction are review-gated.
import type { PdfLayoutPage, PdfVectorSegment, PdfLayoutTextItem } from "./pdf-layout.ts";
import type { DrawingViewport } from "./blueprint-viewports.ts";
import type { DimensionCandidate } from "./blueprint-dimensions.ts";
import { calibrateBlueprintScale, type ScaleDimensionAnchor, type ScaleCalibrationResult } from "./blueprint-scale-calibration.ts";
import type { RoofingGeometryEvidence, RoofingGeometryClass } from "./blueprint-roofing-takeoff.ts";
import { reconstructClosedLoops, detectRoofGraphicSymbols, type RoofSymbolCandidate } from "./blueprint-roofing-topology.ts";
import { buildBlueprintRoofFacetTopology } from "./blueprint-roof-facet-topology.ts";
import { classifyRoofEdgesFromPlanLabels } from "./blueprint-roof-edge-evidence.ts";

export const ROOFING_VECTOR_GEOMETRY_VERSION = "roofing-vector-geometry-v7-trusted-scale";
export const MIN_TRUSTED_SCALE_CONFIDENCE = 0.85;

export interface RoofingVectorGeometryResult {
  evidence: RoofingGeometryEvidence[];
  symbol_candidates: Array<RoofSymbolCandidate & { page_number:number; viewport_key:string }>;
  calibrations: Array<{ page_number: number; viewport_key: string; calibration: ScaleCalibrationResult }>;
  review_flags: Array<{ flag_code: string; severity: "info" | "warning" | "error" | "blocker"; blocking: boolean; message: string; metadata?: Record<string, unknown> }>;
  summary: { vector_segments:number; roof_viewports:number; reconstructed_components:number; roof_outlines:number; facet_count:number; pitched_facets:number; topology_perimeter_edges:number; topology_interior_edges:number; labeled_linear_items:number; edge_topology_conflicts:number; symbol_candidates:number; validated_scales:number; blocked_untrusted_scales:number };
}

const ROOF_RE = /\b(ROOF|ROOFING|TPO|EPDM|PVC|SHINGLE|STANDING\s+SEAM)\b/i;
const LINE_LABELS: Array<{ re: RegExp; type: RoofingGeometryClass }> = [
  { re: /\bRIDGE\b/i, type: "ridge" }, { re: /\bHIP\b/i, type: "hip" }, { re: /\bVALLEY\b/i, type: "valley" },
  { re: /\bEAVE\b/i, type: "eave" }, { re: /\bRAKE\b/i, type: "rake" }, { re: /\bPARAPET\b/i, type: "parapet" },
  { re: /\bROOF\s*(?:TO|-)?\s*WALL\b/i, type: "roof_to_wall" }, { re: /\bSTEP\s+FLASH(?:ING)?\b/i, type: "step_flashing" },
  { re: /\bFLASH(?:ING)?\b/i, type: "flashing" },
];
type Pt = { x: number; y: number };

function viewportAnchor(v: DrawingViewport): Pt { return { x: v.bbox.x + v.bbox.width / 2, y: v.bbox.y + v.bbox.height / 2 }; }
function midpoint(s: PdfVectorSegment): Pt { return { x: (s.x1+s.x2)/2, y:(s.y1+s.y2)/2 }; }
function textCenter(t: PdfLayoutTextItem): Pt { return { x:t.x+t.width/2, y:t.y+t.height/2 }; }
function dist(a: Pt,b: Pt) { return Math.hypot(a.x-b.x,a.y-b.y); }
function nearestViewport(point: Pt, viewports: DrawingViewport[]): DrawingViewport | null { return viewports.map(v=>({v,d:dist(point,viewportAnchor(v))})).sort((a,b)=>a.d-b.d)[0]?.v ?? null; }
function dimensionAnchors(viewport:DrawingViewport,allViewports:DrawingViewport[],dimensions:DimensionCandidate[],segments:PdfVectorSegment[]):ScaleDimensionAnchor[]{
  const out:ScaleDimensionAnchor[]=[];for(const dim of dimensions){if(dim.page_number!==viewport.page_number)continue;const dc={x:dim.bbox.x+dim.bbox.width/2,y:dim.bbox.y+dim.bbox.height/2};if(nearestViewport(dc,allViewports)?.viewport_key!==viewport.viewport_key)continue;
    const chosen=segments.map(s=>({s,d:dist(dc,midpoint(s))})).filter(x=>x.d<=Math.max(36,dim.bbox.height*5)&&x.s.length_points>=Math.max(8,dim.bbox.width*1.2)).sort((a,b)=>a.d-b.d)[0]?.s;if(!chosen)continue;
    out.push({known_feet:dim.normalized_feet,pdf_distance_points:chosen.length_points,source_text:dim.label_text,confidence:Math.min(0.72,dim.confidence*0.78)});
  }return out.slice(0,8);
}
function polygonArea(points:Pt[]):number{let a=0;for(let i=0;i<points.length;i++){const p=points[i],q=points[(i+1)%points.length];a+=p.x*q.y-q.x*p.y;}return Math.abs(a)/2;}
function bbox(points:Pt[]){const xs=points.map(p=>p.x),ys=points.map(p=>p.y);return{width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};}

export function isTrustedScaleCalibration(calibration:ScaleCalibrationResult|null|undefined):calibration is ScaleCalibrationResult & {feet_per_pdf_point:number}{
  return Boolean(
    calibration &&
    calibration.feet_per_pdf_point != null &&
    Number.isFinite(calibration.feet_per_pdf_point) &&
    calibration.feet_per_pdf_point > 0 &&
    calibration.confidence >= MIN_TRUSTED_SCALE_CONFIDENCE &&
    calibration.status === "validated"
  );
}

// Fallback used only when no facet graph can be resolved. It stays label-backed and review-required.
function labeledLinearEvidence(page:PdfLayoutPage,viewport:DrawingViewport,allViewports:DrawingViewport[],assigned:PdfVectorSegment[],feetPerPoint:number):RoofingGeometryEvidence[]{
  const labels=page.text_items.flatMap(item=>{const match=LINE_LABELS.find(l=>l.re.test(item.text));return match?[{item,type:match.type}]:[];}).filter(x=>nearestViewport(textCenter(x.item),allViewports)?.viewport_key===viewport.viewport_key);
  const used=new Set<number>();const out:RoofingGeometryEvidence[]=[];
  for(const label of labels){const lc=textCenter(label.item);const nearest=assigned.map((s,i)=>({s,i,d:dist(lc,midpoint(s))})).filter(x=>!used.has(x.i)&&x.d<=Math.max(42,label.item.height*6)&&x.s.length_points>=8).sort((a,b)=>a.d-b.d)[0];if(!nearest)continue;used.add(nearest.i);
    out.push({page_number:page.page_number,viewport_key:viewport.viewport_key,geometry_class:label.type,points:[{x:nearest.s.x1,y:nearest.s.y1},{x:nearest.s.x2,y:nearest.s.y2}],length_ft:Number((nearest.s.length_points*feetPerPoint).toFixed(3)),confidence:0.74,source:"f1_calibrated_geometry",metadata:{version:ROOFING_VECTOR_GEOMETRY_VERSION,label_text:label.item.text,label_distance_points:Number(nearest.d.toFixed(2)),evidence_basis:"explicit_label_without_resolved_facet_topology",requires_review:true}});
  }return out;
}

export function calibratedViewports(viewportsByPage:Record<number,DrawingViewport[]>|Map<number,DrawingViewport[]>,calibrations:RoofingVectorGeometryResult["calibrations"]):Record<number,DrawingViewport[]>{
  const out:Record<number,DrawingViewport[]>={};const entries=viewportsByPage instanceof Map?[...viewportsByPage.entries()]:Object.entries(viewportsByPage).map(([k,v])=>[Number(k),v] as[number,DrawingViewport[]]);const byKey=new Map(calibrations.map(c=>[c.viewport_key,c.calibration]));
  for(const[page,viewports]of entries)out[page]=viewports.map(v=>{const c=byKey.get(v.viewport_key);if(!isTrustedScaleCalibration(c))return{...v,scale:null};const f=c.feet_per_pdf_point*72;return{...v,scale:{raw:v.scale?.raw??`CALIBRATED ${f.toFixed(6)} FT/IN`,kind:"architectural",paper_inches:1,real_feet:f,ratio:null,feet_per_paper_inch:f}};});return out;
}

export function buildRoofingVectorGeometry(input:{pages:PdfLayoutPage[];viewports_by_page:Map<number,DrawingViewport[]>|Record<number,DrawingViewport[]>;dimensions?:DimensionCandidate[]}):RoofingVectorGeometryResult{
  const evidence:RoofingGeometryEvidence[]=[],symbol_candidates:RoofingVectorGeometryResult["symbol_candidates"]=[],calibrations:RoofingVectorGeometryResult["calibrations"]=[],review_flags:RoofingVectorGeometryResult["review_flags"]=[];
  let vectorSegments=0,roofViewports=0,reconstructed=0,validated=0,blockedUntrusted=0,labeledLinear=0,edgeTopologyConflicts=0,facetCount=0,pitchedFacets=0,perimeterEdges=0,interiorEdges=0;
  const getV=(n:number)=>input.viewports_by_page instanceof Map?(input.viewports_by_page.get(n)??[]):(input.viewports_by_page[n]??[]);
  for(const page of input.pages){vectorSegments+=page.vector_segments.length;const vs=getV(page.page_number);if(!vs.length)continue;
    for(const viewport of vs){const roof=ROOF_RE.test(`${viewport.title??""} ${viewport.metadata.title_item_text??""}`)||(vs.length===1&&/\bROOF\s+PLAN\b/i.test(page.text));if(!roof)continue;roofViewports++;
      const assigned=page.vector_segments.filter(s=>nearestViewport(midpoint(s),vs)?.viewport_key===viewport.viewport_key);
      const anchors=dimensionAnchors(viewport,vs,input.dimensions??[],assigned);const calibration=calibrateBlueprintScale(viewport.scale,anchors);calibrations.push({page_number:page.page_number,viewport_key:viewport.viewport_key,calibration});if(calibration.status==="validated")validated++;
      if(!isTrustedScaleCalibration(calibration)){
        blockedUntrusted++;
        const lowConfidence=calibration.feet_per_pdf_point!=null&&calibration.confidence<MIN_TRUSTED_SCALE_CONFIDENCE;
        review_flags.push({
          flag_code:lowConfidence?"ROOF_VIEWPORT_SCALE_CONFIRMATION_REQUIRED":"ROOF_VIEWPORT_SCALE_BLOCKED",
          severity:"blocker",
          blocking:true,
          message:lowConfidence
            ? `Roof viewport ${viewport.title??viewport.viewport_key} scale confidence is ${calibration.confidence.toFixed(2)}; manual scale confirmation is required below ${MIN_TRUSTED_SCALE_CONFIDENCE.toFixed(2)} before geometry can become a measurement.`
            : `Roof viewport ${viewport.title??viewport.viewport_key} has no trustworthy usable scale: ${calibration.message}`,
          metadata:{page_number:page.page_number,viewport_key:viewport.viewport_key,status:calibration.status,confidence:calibration.confidence,minimum_confidence:MIN_TRUSTED_SCALE_CONFIDENCE,anchors_used:calibration.anchors_used},
        });
        continue;
      }

      const loops=reconstructClosedLoops(assigned,3).filter(p=>{const b=bbox(p),a=polygonArea(p);return p.length>=3&&b.width>=24&&b.height>=24&&a>=600&&a<page.width_points*page.height_points*0.65;});
      reconstructed+=loops.length;loops.sort((a,b)=>polygonArea(b)-polygonArea(a));const outline=loops[0]??null;
      if(outline){const areaPts=polygonArea(outline);const areaSqft=areaPts*calibration.feet_per_pdf_point*calibration.feet_per_pdf_point;evidence.push({page_number:page.page_number,viewport_key:viewport.viewport_key,geometry_class:"outline",points:outline,confidence:Math.min(viewport.confidence,calibration.confidence,0.86),source:"f1_calibrated_geometry",metadata:{version:ROOFING_VECTOR_GEOMETRY_VERSION,reconstructed:true,area_points2:areaPts,area_sqft:Number(areaSqft.toFixed(2)),plan_area_sqft:Number(areaSqft.toFixed(2)),scale_status:calibration.status,scale_raw:viewport.scale?.raw??null,requires_review:true}});}

      const facets=buildBlueprintRoofFacetTopology({page,segments:assigned,feet_per_pdf_point:calibration.feet_per_pdf_point,roof_outline:outline});
      facetCount+=facets.summary.facet_count;pitchedFacets+=facets.summary.pitched_facets;perimeterEdges+=facets.summary.perimeter_edges;interiorEdges+=facets.summary.interior_edges;review_flags.push(...facets.review_flags.map(f=>({...f,metadata:{...(f.metadata??{}),page_number:page.page_number,viewport_key:viewport.viewport_key}})));
      for(const facet of facets.facets){evidence.push({page_number:page.page_number,viewport_key:viewport.viewport_key,geometry_class:"facet",points:facet.points,confidence:Math.min(facet.confidence,calibration.confidence),source:"f1_calibrated_geometry",metadata:{version:ROOFING_VECTOR_GEOMETRY_VERSION,facet_key:facet.facet_key,plan_area_sqft:facet.plan_area_sqft,surface_area_sqft:facet.surface_area_sqft,pitch_rise:facet.pitch_rise,pitch_run:facet.pitch_run,pitch_source:facet.pitch_source,edge_keys:facet.edge_keys,requires_review:true}});}

      if(facets.edges.length){
        const edgeEvidence=classifyRoofEdgesFromPlanLabels({page,page_number:page.page_number,viewport_key:viewport.viewport_key,edges:facets.edges,feet_per_pdf_point:calibration.feet_per_pdf_point});
        evidence.push(...edgeEvidence.evidence);review_flags.push(...edgeEvidence.review_flags);labeledLinear+=edgeEvidence.summary.classified_edges;edgeTopologyConflicts+=edgeEvidence.summary.topology_conflicts;
      }else{
        const linear=labeledLinearEvidence(page,viewport,vs,assigned,calibration.feet_per_pdf_point);evidence.push(...linear);labeledLinear+=linear.length;
      }

      const symbols=detectRoofGraphicSymbols(page,assigned).filter(s=>nearestViewport(s.center,vs)?.viewport_key===viewport.viewport_key).map(s=>({...s,page_number:page.page_number,viewport_key:viewport.viewport_key}));symbol_candidates.push(...symbols);
      for(const symbol of symbols)review_flags.push({flag_code:"ROOF_GRAPHIC_SYMBOL_CANDIDATE",severity:symbol.confidence>=0.9?"info":"warning",blocking:false,message:`${symbol.kind.replaceAll("_"," ")} graphic candidate detected on page ${page.page_number}.`,metadata:{viewport_key:viewport.viewport_key,kind:symbol.kind,confidence:symbol.confidence,bbox:symbol.bbox,source:symbol.source,evidence_count:symbol.evidence_count}});
    }}
  return{evidence,symbol_candidates,calibrations,review_flags,summary:{vector_segments:vectorSegments,roof_viewports:roofViewports,reconstructed_components:reconstructed,roof_outlines:evidence.filter(e=>e.geometry_class==="outline").length,facet_count:facetCount,pitched_facets:pitchedFacets,topology_perimeter_edges:perimeterEdges,topology_interior_edges:interiorEdges,labeled_linear_items:labeledLinear,edge_topology_conflicts:edgeTopologyConflicts,symbol_candidates:symbol_candidates.length,validated_scales:validated,blocked_untrusted_scales:blockedUntrusted}};
}
