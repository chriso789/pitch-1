// Blueprint pitched-roof facet topology from calibrated PDF vectors.
// Deterministic planar-graph extraction only; no OCR/AI or unsupported ridge/hip/valley guessing.
import type { PdfLayoutPage, PdfVectorSegment } from "./pdf-layout.ts";
import { dedupeAndMergeSegments } from "./blueprint-roofing-topology.ts";

export const BLUEPRINT_ROOF_FACET_TOPOLOGY_VERSION = "blueprint-roof-facet-topology-v1";

type Pt = { x:number; y:number };
export interface BlueprintRoofFacet {
  facet_key:string;
  points:Pt[];
  plan_area_points2:number;
  plan_area_sqft:number;
  surface_area_sqft:number | null;
  pitch_rise:number | null;
  pitch_run:number | null;
  pitch_source:"facet_label"|"viewport_single_pitch"|"missing";
  confidence:number;
  edge_keys:string[];
}
export interface BlueprintRoofTopologyEdge {
  edge_key:string;
  start:Pt;
  end:Pt;
  adjacent_facet_keys:string[];
  topology_class:"perimeter"|"interior"|"ambiguous";
  confidence:number;
}
export interface BlueprintRoofFacetTopologyResult {
  facets:BlueprintRoofFacet[];
  edges:BlueprintRoofTopologyEdge[];
  review_flags:Array<{flag_code:string;severity:"info"|"warning"|"error"|"blocker";blocking:boolean;message:string;metadata?:Record<string,unknown>}>;
  summary:{input_segments:number;split_segments:number;facet_count:number;perimeter_edges:number;interior_edges:number;pitched_facets:number};
}

const PITCH_RE=/\b(?:PITCH|SLOPE)?\s*:?\s*(\d+(?:\.\d+)?|\d+\s*\/\s*\d+)\s*(?:"|IN)?\s*(?:\/|:|IN\s+12|PER)\s*12\b/i;
function dist(a:Pt,b:Pt){return Math.hypot(a.x-b.x,a.y-b.y);}
function frac(v:string):number|null{const m=v.trim().match(/^(\d+)\s*\/\s*(\d+)$/);if(m)return Number(m[2])===0?null:Number(m[1])/Number(m[2]);const n=Number(v);return Number.isFinite(n)?n:null;}
function areaSigned(p:Pt[]){let a=0;for(let i=0;i<p.length;i++){const q=p[(i+1)%p.length];a+=p[i].x*q.y-q.x*p[i].y;}return a/2;}
function area(p:Pt[]){return Math.abs(areaSigned(p));}
function centroid(p:Pt[]):Pt{let sx=0,sy=0;for(const x of p){sx+=x.x;sy+=x.y;}return{x:sx/p.length,y:sy/p.length};}
function pointInPoly(pt:Pt,poly:Pt[]):boolean{let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];const hit=((a.y>pt.y)!==(b.y>pt.y))&&(pt.x<(b.x-a.x)*(pt.y-a.y)/((b.y-a.y)||1e-9)+a.x);if(hit)inside=!inside;}return inside;}
function cross(a:Pt,b:Pt,c:Pt){return(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);}
function segmentIntersection(a:Pt,b:Pt,c:Pt,d:Pt):{p:Pt;ta:number;tb:number}|null{
  const r={x:b.x-a.x,y:b.y-a.y},s={x:d.x-c.x,y:d.y-c.y};const den=r.x*s.y-r.y*s.x;if(Math.abs(den)<1e-8)return null;
  const q={x:c.x-a.x,y:c.y-a.y};const ta=(q.x*s.y-q.y*s.x)/den,tb=(q.x*r.y-q.y*r.x)/den;
  if(ta<=1e-5||ta>=1-1e-5||tb<=1e-5||tb>=1-1e-5)return null;
  return{p:{x:a.x+ta*r.x,y:a.y+ta*r.y},ta,tb};
}
function splitAtIntersections(raw:PdfVectorSegment[],maxSegments=1400):PdfVectorSegment[]{
  const input=dedupeAndMergeSegments(raw,1.25,3.5).filter(s=>s.length_points>=3);
  if(input.length>maxSegments)return input;
  const cuts=input.map(()=>[0,1]);
  for(let i=0;i<input.length;i++)for(let j=i+1;j<input.length;j++){
    const a=input[i],b=input[j];const hit=segmentIntersection({x:a.x1,y:a.y1},{x:a.x2,y:a.y2},{x:b.x1,y:b.y1},{x:b.x2,y:b.y2});if(!hit)continue;cuts[i].push(hit.ta);cuts[j].push(hit.tb);
  }
  const out:PdfVectorSegment[]=[];
  for(let i=0;i<input.length;i++){
    const s=input[i],ts=[...new Set(cuts[i].map(v=>Number(v.toFixed(6))))].sort((a,b)=>a-b);
    for(let k=0;k<ts.length-1;k++){const t1=ts[k],t2=ts[k+1];if(t2-t1<1e-5)continue;const p1={x:s.x1+(s.x2-s.x1)*t1,y:s.y1+(s.y2-s.y1)*t1},p2={x:s.x1+(s.x2-s.x1)*t2,y:s.y1+(s.y2-s.y1)*t2};const len=dist(p1,p2);if(len<2)continue;out.push({...s,x1:p1.x,y1:p1.y,x2:p2.x,y2:p2.y,length_points:len});}
  }
  return out;
}
function snapKey(p:Pt,t=2){return`${Math.round(p.x/t)}:${Math.round(p.y/t)}`;}
function canonicalEdge(a:string,b:string){return a<b?`${a}|${b}`:`${b}|${a}`;}
function planarFaces(segments:PdfVectorSegment[]):Array<{points:Pt[];edgeKeys:string[]}>{
  const nodes=new Map<string,{pt:Pt;sumX:number;sumY:number;n:number;neighbors:Set<string>}>();
  const add=(k:string,p:Pt)=>{const x=nodes.get(k)??{pt:p,sumX:0,sumY:0,n:0,neighbors:new Set<string>()};x.sumX+=p.x;x.sumY+=p.y;x.n++;x.pt={x:x.sumX/x.n,y:x.sumY/x.n};nodes.set(k,x);};
  for(const s of segments){const a=snapKey({x:s.x1,y:s.y1}),b=snapKey({x:s.x2,y:s.y2});if(a===b)continue;add(a,{x:s.x1,y:s.y1});add(b,{x:s.x2,y:s.y2});nodes.get(a)!.neighbors.add(b);nodes.get(b)!.neighbors.add(a);}
  const outgoing=new Map<string,string[]>();for(const[k,n]of nodes){outgoing.set(k,[...n.neighbors].sort((a,b)=>Math.atan2(nodes.get(a)!.pt.y-n.pt.y,nodes.get(a)!.pt.x-n.pt.x)-Math.atan2(nodes.get(b)!.pt.y-n.pt.y,nodes.get(b)!.pt.x-n.pt.x)));}
  const visited=new Set<string>();const faces:Array<{points:Pt[];edgeKeys:string[]}>=[];
  for(const[u,list]of outgoing)for(const v of list){const start=`${u}>${v}`;if(visited.has(start))continue;let a=u,b=v;const pts:Pt[]=[],edges:string[]=[];let guard=0;
    while(guard++<segments.length*3+20){const dk=`${a}>${b}`;if(visited.has(dk)&&dk!==start)break;visited.add(dk);pts.push(nodes.get(a)!.pt);edges.push(canonicalEdge(a,b));const around=outgoing.get(b)??[];const idx=around.indexOf(a);if(idx<0||around.length<2)break;const next=around[(idx-1+around.length)%around.length];a=b;b=next;if(`${a}>${b}`===start){if(pts.length>=3){const signed=areaSigned(pts);if(signed>10)faces.push({points:pts,edgeKeys:edges});}break;}
    }
  }
  const seen=new Set<string>();return faces.filter(f=>{const c=centroid(f.points);const k=`${Math.round(c.x)}:${Math.round(c.y)}:${Math.round(area(f.points))}`;if(seen.has(k))return false;seen.add(k);return true;});
}
function pitchLabels(page:PdfLayoutPage){return page.text_items.flatMap(t=>{const m=t.text.match(PITCH_RE);if(!m)return[];const rise=frac(m[1]);return rise==null?[]:[{rise,run:12,center:{x:t.x+t.width/2,y:t.y+t.height/2},text:t.text}];});}

export function buildBlueprintRoofFacetTopology(input:{page:PdfLayoutPage;segments:PdfVectorSegment[];feet_per_pdf_point:number;roof_outline?:Pt[]|null}):BlueprintRoofFacetTopologyResult{
  const review_flags:BlueprintRoofFacetTopologyResult["review_flags"]=[];const split=splitAtIntersections(input.segments);let faces=planarFaces(split);
  if(input.roof_outline?.length)faces=faces.filter(f=>pointInPoly(centroid(f.points),input.roof_outline!));
  faces=faces.filter(f=>{const a=area(f.points);return a>=120&&a<input.page.width_points*input.page.height_points*.5;});
  const labels=pitchLabels(input.page);const uniquePitches=[...new Set(labels.map(x=>x.rise.toFixed(5)))].map(Number);
  const facets:BlueprintRoofFacet[]=faces.map((f,i)=>{
    const inside=labels.filter(l=>pointInPoly(l.center,f.points));let pitchRise:number|null=null,pitchSource:BlueprintRoofFacet["pitch_source"]="missing",confidence=.72;
    if(inside.length){pitchRise=inside[0].rise;pitchSource="facet_label";confidence=.9;}else if(uniquePitches.length===1){pitchRise=uniquePitches[0];pitchSource="viewport_single_pitch";confidence=.78;}
    const planPts=area(f.points),planSqft=planPts*input.feet_per_pdf_point*input.feet_per_pdf_point;const factor=pitchRise==null?null:Math.sqrt(1+(pitchRise/12)*(pitchRise/12));const surface=factor==null?null:planSqft*factor;
    return{facet_key:`facet-${i+1}`,points:f.points,plan_area_points2:Number(planPts.toFixed(3)),plan_area_sqft:Number(planSqft.toFixed(2)),surface_area_sqft:surface==null?null:Number(surface.toFixed(2)),pitch_rise:pitchRise,pitch_run:pitchRise==null?null:12,pitch_source:pitchSource,confidence,edge_keys:f.edgeKeys};
  });
  const edgeMap=new Map<string,{start:Pt;end:Pt;facets:string[]}>();
  for(const facet of facets)for(let i=0;i<facet.points.length;i++){const a=facet.points[i],b=facet.points[(i+1)%facet.points.length],ak=snapKey(a),bk=snapKey(b),key=canonicalEdge(ak,bk);const e=edgeMap.get(key)??{start:a,end:b,facets:[]};e.facets.push(facet.facet_key);edgeMap.set(key,e);}
  const edges:BlueprintRoofTopologyEdge[]=[...edgeMap].map(([edge_key,e])=>({edge_key,start:e.start,end:e.end,adjacent_facet_keys:[...new Set(e.facets)],topology_class:e.facets.length===1?"perimeter":e.facets.length===2?"interior":"ambiguous",confidence:e.facets.length<=2?.9:.55}));
  const missing=facets.filter(f=>f.surface_area_sqft==null).length;if(missing)review_flags.push({flag_code:"ROOF_FACET_PITCH_MISSING",severity:"warning",blocking:false,message:`${missing} roof facet(s) have plan area but no defensible pitch label; surface area remains review-required.`,metadata:{missing_pitch_facets:missing}});
  if(!facets.length)review_flags.push({flag_code:"ROOF_FACETS_NOT_RESOLVED",severity:"warning",blocking:false,message:"No bounded roof facets could be resolved from the vector graph; outline-based takeoff remains available when present."});
  return{facets,edges,review_flags,summary:{input_segments:input.segments.length,split_segments:split.length,facet_count:facets.length,perimeter_edges:edges.filter(e=>e.topology_class==="perimeter").length,interior_edges:edges.filter(e=>e.topology_class==="interior").length,pitched_facets:facets.filter(f=>f.surface_area_sqft!=null).length}};
}
