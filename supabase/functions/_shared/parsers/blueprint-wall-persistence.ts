import type { WallVectorGeometryResult } from "./blueprint-wall-vector-geometry.ts";

type QueryError={message?:string}|null;
type QueryResult<T>=PromiseLike<{data:T|null;error:QueryError}>;
type DbLike={from:(table:string)=>{upsert:(...args:unknown[])=>unknown}};

export async function persistWallVectorGeometry(svc:DbLike,tenantId:string,input:{import_session_id:string;source_document_id:string;file_name?:string|null;result:WallVectorGeometryResult}){
  const pathRows=input.result.evidence.map((e,i)=>({
    tenant_id:tenantId,import_session_id:input.import_session_id,source_document_id:input.source_document_id,
    deterministic_key:`wall-vector-v1|p${e.page_number}|${e.viewport_key}|gross-${i+1}`,
    path_type:"blueprint_sheet",file_name:input.file_name??null,document_type:"blueprint_set",provider:"user_uploaded_blueprint",
    page_number:e.page_number,diagram_label:e.direction?`${e.direction} exterior elevation`:"exterior elevation",source_text_excerpt:null,
    source_coordinates:{points:e.points},confidence:e.confidence,
  }));
  if(!pathRows.length)return{plan_paths:0,measurements:0};
  const pathBuilder=svc.from("blueprint_plan_paths").upsert(pathRows,{onConflict:"import_session_id,deterministic_key"}) as {select:(columns:string)=>QueryResult<Array<{id:string;deterministic_key:string}>>};
  const{data:paths,error:pathError}=await pathBuilder.select("id,deterministic_key");
  if(pathError)throw new Error(`wall_plan_path_upsert_failed:${pathError.message??"unknown"}`);
  const byKey=new Map((paths??[]).map(p=>[p.deterministic_key,p.id]));
  const measurements=input.result.evidence.map((e,i)=>{
    const deterministicKey=`wall-vector-v1|p${e.page_number}|${e.viewport_key}|gross-${i+1}`;
    return{tenant_id:tenantId,import_session_id:input.import_session_id,source_document_id:input.source_document_id,trade_id:"exterior_walls_siding",measurement_key:"wall_area_with_windows_doors_sqft",measurement_group:"wall_area",quantity:e.gross_area_sqft,unit:"sqft",precision:2,confidence:e.confidence,source_value_raw:`${e.gross_area_sqft.toFixed(2)} SF gross elevation area`,normalized_value:{gross_area_sqft:e.gross_area_sqft,direction:e.direction,openings_subtracted:false},plan_path_id:byKey.get(deterministicKey)??null,page_number:e.page_number,deterministic_key:`wall-vector-v1|measurement|p${e.page_number}|${e.viewport_key}|gross-${i+1}`,metadata:{...e.metadata,measurement_source:"f1_calibrated_geometry",plan_path_key:deterministicKey}};
  });
  const measurementBuilder=svc.from("blueprint_measurement_objects").upsert(measurements,{onConflict:"import_session_id,deterministic_key"}) as {select:(columns:string)=>QueryResult<Array<{id:string}>>};
  const{error:measurementError}=await measurementBuilder.select("id");
  if(measurementError)throw new Error(`wall_measurement_upsert_failed:${measurementError.message??"unknown"}`);
  return{plan_paths:pathRows.length,measurements:measurements.length};
}
