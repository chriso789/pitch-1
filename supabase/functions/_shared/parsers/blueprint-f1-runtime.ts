// Blueprint F1 runtime payload builder.
// Converts a PDF into coordinate-aware sheet intelligence plus reviewable
// specifications/dimensions. Pure with respect to storage/DB.

import { extractPdfLayout, PDF_LAYOUT_VERSION, type PdfLayoutPage } from "./pdf-layout.ts";
import { analyzeBlueprintSheet, findMissingIndexedSheets, SHEET_INTELLIGENCE_VERSION, type SheetIndexEntry, type SheetIntelligence } from "./blueprint-sheet-intelligence.ts";
import { detectDrawingReferences, detectDrawingViewports, BLUEPRINT_REFERENCE_VERSION, BLUEPRINT_VIEWPORT_VERSION, type DrawingReference, type DrawingViewport } from "./blueprint-viewports.ts";
import { extractBlueprintSpecifications, type BlueprintSpecCandidate } from "./blueprint-spec-intelligence.ts";
import { extractDimensionCandidates, type DimensionCandidate } from "./blueprint-dimensions.ts";

export const BLUEPRINT_F1_RUNTIME_VERSION = "blueprint-f1-runtime-v4-vector";

export interface BlueprintF1PagePersistenceRow {
  page_number:number; raw_text:string; page_type:string; page_subtype:string|null; page_type_confidence:number;
  sheet_name:string|null; sheet_number:string|null; scale_text:string|null; scale_source:"pdf_layout"|null;
  width_points:number; height_points:number; layout_version:string; layout_extraction_status:"completed";
  layout_json:{
    rotation_deg:number; text_items:PdfLayoutPage["text_items"]; vector_extraction_status:PdfLayoutPage["vector_extraction_status"];
    vector_segment_count:number; title_block_bbox:SheetIntelligence["title_block_bbox"]; discipline:SheetIntelligence["discipline"];
    normalized_scale:SheetIntelligence["scale"]; sheet_intelligence_version:string; viewport_version:string; reference_version:string; requires_review:boolean;
  };
}
export interface BlueprintF1IndexPersistenceRow { source_page_number:number; sheet_number:string; sheet_title:string|null; discipline:SheetIndexEntry["discipline"]; confidence:number; source_text:string; bbox:SheetIndexEntry["bbox"]; status:"detected"|"missing"; metadata:{runtime_version:string;sheet_intelligence_version:string;indexed_from_page:number;present_in_document:boolean}; }
export interface BlueprintF1ViewportPersistenceRow extends DrawingViewport { source_page_number:number; }
export interface BlueprintF1ReferencePersistenceRow extends DrawingReference { source_page_number:number; }
export interface BlueprintF1RuntimeResult {
  runtime_version:string; layout_version:string; sheet_intelligence_version:string; viewport_version:string; reference_version:string; page_count:number;
  pages:BlueprintF1PagePersistenceRow[]; analyzed_sheets:SheetIntelligence[]; sheet_index_entries:BlueprintF1IndexPersistenceRow[]; drawing_viewports:BlueprintF1ViewportPersistenceRow[]; drawing_references:BlueprintF1ReferencePersistenceRow[];
  layout_pages:PdfLayoutPage[]; viewports_by_page:Record<number,DrawingViewport[]>; specifications:BlueprintSpecCandidate[]; dimensions:DimensionCandidate[];
  missing_indexed_sheets:string[]; unresolved_reference_targets:string[]; requires_review:boolean;
  summary:{pages_with_sheet_number:number;pages_with_scale:number;index_entry_count:number;missing_indexed_sheet_count:number;image_only_page_count:number;viewport_count:number;scaled_viewport_count:number;reference_count:number;unresolved_reference_target_count:number;specification_candidate_count:number;dimension_candidate_count:number;vector_segment_count:number;vector_failed_page_count:number;};
}

function pageToPersistenceRow(page:PdfLayoutPage,intelligence:SheetIntelligence):BlueprintF1PagePersistenceRow{return{
  page_number:page.page_number,raw_text:page.text.slice(0,8000),page_type:intelligence.page_type,page_subtype:intelligence.page_subtype,page_type_confidence:intelligence.classification_confidence,
  sheet_name:intelligence.sheet_title,sheet_number:intelligence.sheet_number,scale_text:intelligence.scale?.raw??null,scale_source:intelligence.scale?"pdf_layout":null,
  width_points:page.width_points,height_points:page.height_points,layout_version:PDF_LAYOUT_VERSION,layout_extraction_status:"completed",
  layout_json:{rotation_deg:page.rotation_deg,text_items:page.text_items,vector_extraction_status:page.vector_extraction_status,vector_segment_count:page.vector_segments.length,title_block_bbox:intelligence.title_block_bbox,discipline:intelligence.discipline,normalized_scale:intelligence.scale,sheet_intelligence_version:SHEET_INTELLIGENCE_VERSION,viewport_version:BLUEPRINT_VIEWPORT_VERSION,reference_version:BLUEPRINT_REFERENCE_VERSION,requires_review:intelligence.requires_review}
};}

function indexRows(analyzed:SheetIntelligence[],missing:Set<string>):BlueprintF1IndexPersistenceRow[]{
  const present=new Set(analyzed.map(s=>s.sheet_number).filter((v):v is string=>Boolean(v)));const map=new Map<string,BlueprintF1IndexPersistenceRow>();
  for(const source of analyzed)for(const entry of source.sheet_index_entries){const row:BlueprintF1IndexPersistenceRow={source_page_number:source.page_number,sheet_number:entry.sheet_number,sheet_title:entry.sheet_title,discipline:entry.discipline,confidence:entry.confidence,source_text:entry.source_text,bbox:entry.bbox,status:missing.has(entry.sheet_number)?"missing":"detected",metadata:{runtime_version:BLUEPRINT_F1_RUNTIME_VERSION,sheet_intelligence_version:SHEET_INTELLIGENCE_VERSION,indexed_from_page:source.page_number,present_in_document:present.has(entry.sheet_number)}};const prior=map.get(entry.sheet_number);if(!prior||row.confidence>prior.confidence)map.set(entry.sheet_number,row);}return[...map.values()].sort((a,b)=>a.sheet_number.localeCompare(b.sheet_number));
}
function viewportRows(pages:PdfLayoutPage[]):BlueprintF1ViewportPersistenceRow[]{return pages.flatMap(p=>detectDrawingViewports(p).map(v=>({...v,source_page_number:p.page_number})));}
function referenceRows(pages:PdfLayoutPage[],viewports:BlueprintF1ViewportPersistenceRow[]):BlueprintF1ReferencePersistenceRow[]{return pages.flatMap(p=>detectDrawingReferences(p,viewports.filter(v=>v.page_number===p.page_number)).map(r=>({...r,source_page_number:p.page_number})));}
function byPage(viewports:BlueprintF1ViewportPersistenceRow[]):Record<number,DrawingViewport[]>{const out:Record<number,DrawingViewport[]>={};for(const v of viewports){out[v.page_number]??=[];const{source_page_number:_ignore,...clean}=v;out[v.page_number].push(clean);}return out;}

export function buildBlueprintF1RuntimeFromLayout(layout:{page_count:number;version:string;pages:PdfLayoutPage[]}):BlueprintF1RuntimeResult{
  const analyzed=layout.pages.map(analyzeBlueprintSheet);const allIndex=analyzed.flatMap(s=>s.sheet_index_entries);const missing=findMissingIndexedSheets(allIndex,analyzed);const missingSet=new Set(missing);
  const pages=layout.pages.map((p,i)=>pageToPersistenceRow(p,analyzed[i]));const sheetIndex=indexRows(analyzed,missingSet);const drawingViewports=viewportRows(layout.pages);const viewportsByPage=byPage(drawingViewports);const refs=referenceRows(layout.pages,drawingViewports);
  const specs=layout.pages.flatMap(p=>extractBlueprintSpecifications(p,viewportsByPage[p.page_number]??[]));const dimensions=layout.pages.flatMap(p=>extractDimensionCandidates(p,viewportsByPage[p.page_number]??[]));const imageOnly=layout.pages.filter(p=>!p.has_selectable_text).length;
  const actual=new Set(analyzed.map(s=>s.sheet_number).filter((v):v is string=>Boolean(v)));const unresolved=[...new Set(refs.map(r=>r.target_sheet_number).filter(t=>!actual.has(t)))].sort();
  const vectorCount=layout.pages.reduce((s,p)=>s+p.vector_segments.length,0);const vectorFailed=layout.pages.filter(p=>p.vector_extraction_status==="failed").length;
  return{runtime_version:BLUEPRINT_F1_RUNTIME_VERSION,layout_version:layout.version,sheet_intelligence_version:SHEET_INTELLIGENCE_VERSION,viewport_version:BLUEPRINT_VIEWPORT_VERSION,reference_version:BLUEPRINT_REFERENCE_VERSION,page_count:layout.page_count,pages,analyzed_sheets:analyzed,sheet_index_entries:sheetIndex,drawing_viewports:drawingViewports,drawing_references:refs,layout_pages:layout.pages,viewports_by_page:viewportsByPage,specifications:specs,dimensions,missing_indexed_sheets:missing,unresolved_reference_targets:unresolved,requires_review:analyzed.some(s=>s.requires_review)||missing.length>0||imageOnly>0||unresolved.length>0||vectorFailed>0,summary:{pages_with_sheet_number:analyzed.filter(s=>Boolean(s.sheet_number)).length,pages_with_scale:analyzed.filter(s=>Boolean(s.scale)).length,index_entry_count:sheetIndex.length,missing_indexed_sheet_count:missing.length,image_only_page_count:imageOnly,viewport_count:drawingViewports.length,scaled_viewport_count:drawingViewports.filter(v=>Boolean(v.scale)).length,reference_count:refs.length,unresolved_reference_target_count:unresolved.length,specification_candidate_count:specs.length,dimension_candidate_count:dimensions.length,vector_segment_count:vectorCount,vector_failed_page_count:vectorFailed}};
}
export async function analyzeBlueprintPdfF1(bytes:Uint8Array):Promise<BlueprintF1RuntimeResult>{return buildBlueprintF1RuntimeFromLayout(await extractPdfLayout(bytes));}
