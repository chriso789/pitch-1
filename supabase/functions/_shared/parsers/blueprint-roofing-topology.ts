// Complex roofing CAD topology reconstruction + conservative graphic symbol intelligence.
// Pure deterministic helpers. No OCR/AI and no estimate writes.
import type { PdfLayoutPage, PdfVectorSegment, PdfLayoutTextItem } from "./pdf-layout.ts";

export const ROOFING_TOPOLOGY_VERSION = "roofing-topology-v1";

type Pt = { x:number; y:number };
export type RoofSymbolKind = "roof_drain"|"scupper"|"curb"|"penetration";
export interface RoofSymbolCandidate {
  kind: RoofSymbolKind;
  center: Pt;
  bbox: {x:number;y:number;width:number;height:number};
  confidence:number;
  source:"vector_symbol"|"vector_text_fused";
  evidence_count:number;
}

function d(a:Pt,b:Pt){return Math.hypot(a.x-b.x,a.y-b.y);}
function mid(s:PdfVectorSegment):Pt{return{x:(s.x1+s.x2)/2,y:(s.y1+s.y2)/2};}
function angle(s:PdfVectorSegment){return Math.atan2(s.y2-s.y1,s.x2-s.x1);}
function normAngle(a:number){while(a<0)a+=Math.PI;while(a>=Math.PI)a-=Math.PI;return a;}
function nearAngle(a:number,b:number,tol=0.035){const x=Math.abs(normAngle(a)-normAngle(b));return Math.min(x,Math.PI-x)<=tol;}
function pointLineDistance(p:Pt,s:PdfVectorSegment){const vx=s.x2-s.x1,vy=s.y2-s.y1,wx=p.x-s.x1,wy=p.y-s.y1;const vv=vx*vx+vy*vy;if(vv===0)return d(p,{x:s.x1,y:s.y1});const t=Math.max(0,Math.min(1,(wx*vx+wy*vy)/vv));return d(p,{x:s.x1+t*vx,y:s.y1+t*vy});}

export function dedupeAndMergeSegments(raw:PdfVectorSegment[], snap=1.5, gap=3):PdfVectorSegment[]{
  const canonical=(s:PdfVectorSegment)=>{
    const a={x:Math.round(s.x1/snap)*snap,y:Math.round(s.y1/snap)*snap};
    const b={x:Math.round(s.x2/snap)*snap,y:Math.round(s.y2/snap)*snap};
    return (a.x<b.x||(a.x===b.x&&a.y<=b.y))?{a,b}:{a:b,b:a};
  };
  const seen=new Set<string>();const segs:PdfVectorSegment[]=[];
  for(const s of raw){if(s.length_points<2)continue;const c=canonical(s);const k=`${c.a.x},${c.a.y}|${c.b.x},${c.b.y}`;if(seen.has(k))continue;seen.add(k);segs.push({...s,x1:c.a.x,y1:c.a.y,x2:c.b.x,y2:c.b.y,length_points:d(c.a,c.b)});}
  let changed=true;let work=segs;
  while(changed){changed=false;const used=new Set<number>();const next:PdfVectorSegment[]=[];
    for(let i=0;i<work.length;i++){if(used.has(i))continue;let base=work[i];
      for(let j=i+1;j<work.length;j++){if(used.has(j))continue;const o=work[j];if(!nearAngle(angle(base),angle(o)))continue;
        const ends:[Pt,Pt]=[{x:base.x1,y:base.y1},{x:base.x2,y:base.y2}],oe:[Pt,Pt]=[{x:o.x1,y:o.y1},{x:o.x2,y:o.y2}];
        const minGap=Math.min(...ends.flatMap(a=>oe.map(b=>d(a,b))));if(minGap>gap)continue;
        if(Math.min(pointLineDistance(oe[0],base),pointLineDistance(oe[1],base),pointLineDistance(ends[0],o),pointLineDistance(ends[1],o))>2.2)continue;
        const pts=[...ends,...oe];const ax=Math.cos(angle(base)),ay=Math.sin(angle(base));pts.sort((p,q)=>(p.x*ax+p.y*ay)-(q.x*ax+q.y*ay));
        base={...base,x1:pts[0].x,y1:pts[0].y,x2:pts[3].x,y2:pts[3].y,length_points:d(pts[0],pts[3])};used.add(j);changed=true;
      } used.add(i);next.push(base);
    } work=next;
  } return work;
}

function snapKey(p:Pt,t=3){return`${Math.round(p.x/t)}:${Math.round(p.y/t)}`;}
export function reconstructClosedLoops(raw:PdfVectorSegment[], snap=3):Pt[][]{
  const segs=dedupeAndMergeSegments(raw,1.5,4);const nodes=new Map<string,{pt:Pt;edges:number[]}>();
  const edges=segs.map((s,i)=>({i,a:snapKey({x:s.x1,y:s.y1},snap),b:snapKey({x:s.x2,y:s.y2},snap)}));
  const add=(k:string,p:Pt,e:number)=>{const n=nodes.get(k)??{pt:{x:0,y:0},edges:[]};const count=n.edges.length;n.pt={x:(n.pt.x*count+p.x)/(count+1),y:(n.pt.y*count+p.y)/(count+1)};n.edges.push(e);nodes.set(k,n);};
  edges.forEach((e,i)=>{const s=segs[i];add(e.a,{x:s.x1,y:s.y1},i);add(e.b,{x:s.x2,y:s.y2},i);});
  // Trim obvious drafting spurs: degree-1 chains shorter than 12pt.
  const active=new Set(edges.map((_,i)=>i));let pruned=true;while(pruned){pruned=false;for(const [k,n] of nodes){const ae=n.edges.filter(e=>active.has(e));if(ae.length!==1)continue;const ei=ae[0],s=segs[ei];if(s.length_points<=12){active.delete(ei);pruned=true;}}}
  const loops:Pt[][]=[];const used=new Set<number>();
  for(const seed of active){if(used.has(seed))continue;const e0=edges[seed];let start=e0.a,current=e0.a,prev=-1;const pts:Pt[]=[];let guard=0;
    while(guard++<active.size+5){pts.push(nodes.get(current)!.pt);const choices=(nodes.get(current)?.edges??[]).filter(e=>active.has(e)&&e!==prev);if(!choices.length)break;const next=choices.find(e=>!used.has(e))??choices[0];used.add(next);const e=edges[next];current=e.a===current?e.b:e.a;prev=next;if(current===start)break;}
    if(current===start&&pts.length>=3)loops.push(pts);
  } return loops;
}

function clusterSegments(segments:PdfVectorSegment[], radius=28){const clusters:PdfVectorSegment[][]=[];for(const s of segments){const m=mid(s);let c=clusters.find(c=>c.some(o=>d(mid(o),m)<=radius));if(!c){c=[];clusters.push(c);}c.push(s);}return clusters;}
function bounds(segs:PdfVectorSegment[]){const xs=segs.flatMap(s=>[s.x1,s.x2]),ys=segs.flatMap(s=>[s.y1,s.y2]);return{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};}
function centerBox(b:{x:number;y:number;width:number;height:number}){return{x:b.x+b.width/2,y:b.y+b.height/2};}
function nearbyText(page:PdfLayoutPage,c:Pt,r=45){return page.text_items.filter(t=>d({x:t.x+t.width/2,y:t.y+t.height/2},c)<=r).map(t=>t.text.toUpperCase()).join(" ");}

export function detectRoofGraphicSymbols(page:PdfLayoutPage,segments:PdfVectorSegment[]):RoofSymbolCandidate[]{
  const out:RoofSymbolCandidate[]=[];
  for(const cluster of clusterSegments(segments.filter(s=>s.length_points>=3&&s.length_points<=80))){if(cluster.length<3||cluster.length>20)continue;const b=bounds(cluster);if(b.width<5||b.height<5||b.width>90||b.height>90)continue;const c=centerBox(b);const text=nearbyText(page,c);
    const aspect=Math.min(b.width,b.height)/Math.max(b.width,b.height);const orthogonal=cluster.filter(s=>nearAngle(angle(s),0,0.08)||nearAngle(angle(s),Math.PI/2,0.08)).length/cluster.length;
    let kind:RoofSymbolKind|null=null,confidence=.58,source:RoofSymbolCandidate["source"]="vector_symbol";
    if(/\b(RD|ROOF DRAIN)\b/.test(text)){kind="roof_drain";confidence=.94;source="vector_text_fused";}
    else if(/\bSCUPPER\b/.test(text)){kind="scupper";confidence=.94;source="vector_text_fused";}
    else if(/\b(RTU|AHU|CURB|ROOF CURB)\b/.test(text)){kind="curb";confidence=.93;source="vector_text_fused";}
    else if(/\b(VTR|VENT|PIPE|PENETRATION)\b/.test(text)){kind="penetration";confidence=.9;source="vector_text_fused";}
    else if(aspect>.75&&orthogonal>.65&&b.width>=12&&b.width<=55){kind="curb";confidence=.62;}
    else if(aspect>.8&&cluster.length>=6&&b.width<=35){kind="roof_drain";confidence=.6;}
    if(kind)out.push({kind,center:c,bbox:b,confidence,source,evidence_count:cluster.length});
  }
  // de-dupe candidates by kind + center proximity.
  return out.filter((x,i,a)=>a.findIndex(y=>y.kind===x.kind&&d(y.center,x.center)<8)===i);
}
