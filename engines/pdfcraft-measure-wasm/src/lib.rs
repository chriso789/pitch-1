//! PITCH browser bindings for pdfcraft-measure (storytold/pdfcraft @ 0a0986483378b57d62103a36490bd66166d32c8f).
//! JSON in / JSON out. Every error is returned as {"error": "..."}; nothing is guessed.
use pdfcraft_measure::{self as m, Kind, Point, Scale};
use pdfcraft_cos::Document;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
struct ScaleIn { x: f64, y: f64, unit: String, area_unit: String, precision: u8, ratio: String }
fn scale_from(s: ScaleIn) -> Result<Scale, String> {
    let sc = Scale { x: s.x, y: s.y, unit: s.unit, distance_factor: 1.0, area_factor: 1.0, area_unit: s.area_unit, precision: s.precision, ratio: s.ratio };
    sc.validate().map_err(|e| e.to_string())?;
    Ok(sc)
}
fn err(e: impl ToString) -> String { json!({"error": e.to_string()}).to_string() }
fn kind(k: &str) -> Result<Kind, String> { Kind::from_name(k).ok_or_else(|| format!("unknown kind {k}")) }
fn open(bytes: &[u8]) -> Result<Document, String> { Document::open(Arc::new(bytes.to_vec())).map_err(|e| e.to_string()) }

#[wasm_bindgen]
pub fn engine_version() -> String { "pdfcraft-measure@0a0986483378b57d62103a36490bd66166d32c8f".into() }

#[wasm_bindgen]
pub fn calibrate(ax: f64, ay: f64, bx: f64, by: f64, real: f64, unit: &str, precision: u8) -> String {
    match Scale::calibrate([ax, ay], [bx, by], real, unit, precision) {
        Ok(s) => serde_json::to_string(&s).unwrap_or_else(err), Err(e) => err(e) }
}

#[wasm_bindgen]
pub fn reading(kind_name: &str, points_json: &str, scale_json: &str) -> String {
    let r = (|| -> Result<String, String> {
        let pts: Vec<Point> = serde_json::from_str(points_json).map_err(|e| e.to_string())?;
        let sc = scale_from(serde_json::from_str(scale_json).map_err(|e| e.to_string())?)?;
        let rd = m::reading(kind(kind_name)?, &pts, &sc).map_err(|e| e.to_string())?;
        serde_json::to_string(&rd).map_err(|e| e.to_string())
    })();
    r.unwrap_or_else(err)
}

/// Converts a point between view space (rotation/crop applied, origin top-left of crop box) and PDF user space.
#[wasm_bindgen]
pub fn view_to_user(pdf: &[u8], page: usize, x: f64, y: f64) -> String {
    (|| -> Result<String, String> { let d = open(pdf)?; let p = m::view_to_user(&d, page, [x, y]).map_err(|e| e.to_string())?; Ok(json!(p).to_string()) })().unwrap_or_else(err)
}
#[wasm_bindgen]
pub fn user_to_view(pdf: &[u8], page: usize, x: f64, y: f64) -> String {
    (|| -> Result<String, String> { let d = open(pdf)?; let p = m::user_to_view(&d, page, [x, y]).map_err(|e| e.to_string())?; Ok(json!(p).to_string()) })().unwrap_or_else(err)
}

/// Vector geometry snapshot for a page (segments/endpoints/midpoints in user space).
#[wasm_bindgen]
pub fn page_geometry(pdf: &[u8], page: usize) -> String {
    (|| -> Result<String, String> {
        let d = open(pdf)?; let g = m::snap::geometry(&d, page).map_err(|e| e.to_string())?;
        Ok(json!({"segments": g.segments, "endpoints": g.endpoints, "midpoints": g.midpoints, "truncated": g.truncated, "unreadable": g.unreadable}).to_string())
    })().unwrap_or_else(err)
}

#[wasm_bindgen]
pub fn snap(pdf: &[u8], page: usize, x: f64, y: f64, tolerance: f64) -> String {
    (|| -> Result<String, String> {
        let d = open(pdf)?; let g = m::snap::geometry(&d, page).map_err(|e| e.to_string())?;
        let s = g.snap([x, y], tolerance, m::snap::SnapOptions::default()).map_err(|e| e.to_string())?;
        Ok(json!(s).to_string())
    })().unwrap_or_else(err)
}

/// Measurement annotations already saved inside the PDF.
#[wasm_bindgen]
pub fn list(pdf: &[u8]) -> String {
    (|| -> Result<String, String> {
        let d = open(pdf)?; let l = m::list(&d);
        let ms: Vec<Value> = l.measurements.iter().map(|x| json!({"page": x.page, "index": x.index, "id": x.id, "label": x.label, "points": x.points, "scale": x.scale, "reading": x.reading})).collect();
        Ok(json!({"measurements": ms, "unsupported": l.unsupported, "truncated": l.truncated}).to_string())
    })().unwrap_or_else(err)
}

#[derive(Deserialize)]
struct AddIn { page: usize, kind: String, points: Vec<Point>, scale: ScaleIn, label: String, author: String, id: String, color: [f64; 3] }

/// Writes a standard ISO 32000 measurement annotation (incremental save). Returns new PDF bytes;
/// throws a JS error with the engine message on invalid geometry/scale.
#[wasm_bindgen]
pub fn add_measurement(pdf: &[u8], json_in: &str) -> Result<Vec<u8>, JsValue> {
    let a: AddIn = serde_json::from_str(json_in).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let mut d = open(pdf).map_err(|e| JsValue::from_str(&e))?;
    let new = m::NewMeasurement { page: a.page, kind: kind(&a.kind).map_err(|e| JsValue::from_str(&e))?, points: a.points,
        scale: scale_from(a.scale).map_err(|e| JsValue::from_str(&e))?,
        style: pdfcraft_annot::Style { color: a.color, opacity: 1.0, width: 1.5, fill: None }, label: a.label, author: a.author };
    m::add(&mut d, &new, &pdfcraft_annot::Meta { date: None, id: a.id }).map_err(|e| JsValue::from_str(&e.to_string()))?;
    pdfcraft_cos::write_incremental(&d, &Default::default()).map_err(|e| JsValue::from_str(&e.to_string()))
}
