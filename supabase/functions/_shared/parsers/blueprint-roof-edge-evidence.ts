// Evidence-backed roofing edge classification.
// Uses explicit plan labels only when they agree with facet topology.
// Interior-only: ridge/hip/valley. Perimeter-only: eave/rake.
// Flashing/parapet/roof-to-wall remain label-backed but topology-neutral.

import type { PdfLayoutPage, PdfLayoutTextItem } from "./pdf-layout.ts";
import type { BlueprintRoofTopologyEdge } from "./blueprint-roof-facet-topology.ts";
import type { RoofingGeometryEvidence, RoofingGeometryClass } from "./blueprint-roofing-takeoff.ts";

export const BLUEPRINT_ROOF_EDGE_EVIDENCE_VERSION = "roof-edge-evidence-v1";

type Pt = { x:number; y:number };
export interface RoofEdgeEvidenceResult {
  evidence: RoofingGeometryEvidence[];
  review_flags: Array<{
    flag_code:string;
    severity:"info"|"warning"|"error"|"blocker";
    blocking:boolean;
    message:string;
    metadata?:Record<string,unknown>;
  }>;
  summary:{labels_seen:number;classified_edges:number;topology_conflicts:number};
}

const LABELS:Array<{re:RegExp;type:RoofingGeometryClass;requires:"interior"|"perimeter"|"either"}> = [
  {re:/\bRIDGE\b/i,type:"ridge",requires:"interior"},
  {re:/\bHIP\b/i,type:"hip",requires:"interior"},
  {re:/\bVALLEY\b/i,type:"valley",requires:"interior"},
  {re:/\bEAVE\b/i,type:"eave",requires:"perimeter"},
  {re:/\bRAKE\b/i,type:"rake",requires:"perimeter"},
  {re:/\bPARAPET\b/i,type:"parapet",requires:"either"},
  {re:/\bROOF\s*(?:TO|-)?\s*WALL\b/i,type:"roof_to_wall",requires:"either"},
  {re:/\bSTEP\s+FLASH(?:ING)?\b/i,type:"step_flashing",requires:"either"},
  {re:/\bFLASH(?:ING)?\b/i,type:"flashing",requires:"either"},
];

function center(t:PdfLayoutTextItem):Pt{return{x:t.x+t.width/2,y:t.y+t.height/2};}
function mid(e:BlueprintRoofTopologyEdge):Pt{return{x:(e.start.x+e.end.x)/2,y:(e.start.y+e.end.y)/2};}
function dist(a:Pt,b:Pt){return Math.hypot(a.x-b.x,a.y-b.y);}
function edgeLengthPoints(e:BlueprintRoofTopologyEdge){return Math.hypot(e.end.x-e.start.x,e.end.y-e.start.y);}
function allowed(requirement:"interior"|"perimeter"|"either",topology:BlueprintRoofTopologyEdge["topology_class"]){
  if(requirement==="either")return topology!=="ambiguous";
  return requirement===topology;
}

export function classifyRoofEdgesFromPlanLabels(input:{
  page:PdfLayoutPage;
  page_number:number;
  viewport_key:string;
  edges:BlueprintRoofTopologyEdge[];
  feet_per_pdf_point:number;
}):RoofEdgeEvidenceResult{
  const evidence:RoofingGeometryEvidence[]=[],review_flags:RoofEdgeEvidenceResult["review_flags"]=[];
  let labelsSeen=0,conflicts=0;
  const used=new Set<string>();

  for(const item of input.page.text_items){
    const rule=LABELS.find(r=>r.re.test(item.text));if(!rule)continue;labelsSeen++;
    const c=center(item);
    const candidates=input.edges
      .map(edge=>({edge,d:dist(c,mid(edge))}))
      .filter(x=>!used.has(x.edge.edge_key)&&x.d<=Math.max(48,item.height*7)&&edgeLengthPoints(x.edge)>=8)
      .sort((a,b)=>a.d-b.d);
    const nearest=candidates[0];if(!nearest)continue;

    if(!allowed(rule.requires,nearest.edge.topology_class)){
      conflicts++;
      review_flags.push({
        flag_code:"ROOF_EDGE_LABEL_TOPOLOGY_CONFLICT",
        severity:"warning",
        blocking:false,
        message:`${rule.type.replaceAll("_"," ")} label on page ${input.page_number} is nearest a ${nearest.edge.topology_class} roof edge, so no automatic LF was emitted.`,
        metadata:{viewport_key:input.viewport_key,label_text:item.text,geometry_class:rule.type,required_topology:rule.requires,actual_topology:nearest.edge.topology_class,edge_key:nearest.edge.edge_key,distance_points:Number(nearest.d.toFixed(2))},
      });
      continue;
    }

    used.add(nearest.edge.edge_key);
    const lengthFt=edgeLengthPoints(nearest.edge)*input.feet_per_pdf_point;
    if(!Number.isFinite(lengthFt)||lengthFt<=0)continue;
    evidence.push({
      page_number:input.page_number,
      viewport_key:input.viewport_key,
      geometry_class:rule.type,
      points:[nearest.edge.start,nearest.edge.end],
      length_ft:Number(lengthFt.toFixed(3)),
      confidence:Math.min(.93,Math.max(.72,nearest.edge.confidence*.92)),
      source:"f1_calibrated_geometry",
      metadata:{
        version:BLUEPRINT_ROOF_EDGE_EVIDENCE_VERSION,
        label_text:item.text,
        topology_class:nearest.edge.topology_class,
        edge_key:nearest.edge.edge_key,
        label_distance_points:Number(nearest.d.toFixed(2)),
        evidence_basis:"explicit_label_plus_facet_topology",
        requires_review:true,
      },
    });
  }

  return{evidence,review_flags,summary:{labels_seen:labelsSeen,classified_edges:evidence.length,topology_conflicts:conflicts}};
}
