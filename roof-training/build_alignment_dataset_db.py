#!/usr/bin/env python3

import io
import json
import math
import os
import re
import uuid
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import requests
from PIL import Image, ImageDraw

# =========================
# CONFIG
# =========================

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
MAPBOX_ACCESS_TOKEN = os.environ.get("MAPBOX_ACCESS_TOKEN", "")
MAPBOX_STYLE = os.environ.get("MAPBOX_STYLE", "mapbox/satellite-v9")
MAPBOX_ZOOM = float(os.environ.get("MAPBOX_ZOOM", "20"))
MAPBOX_SIZE = int(os.environ.get("MAPBOX_SIZE", "1024"))
OUT_DIR = Path(os.environ.get("ROOF_TRAINING_DIR", "./roof-training"))

SESSION = requests.Session()
SESSION.headers.update({"apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"})

IMAGES_DIR = OUT_DIR / "images"
LABELS_DIR = OUT_DIR / "labels"
META_DIR = OUT_DIR / "metadata"
METRICS_DIR = OUT_DIR / "exports" / "metrics"
PREVIEWS_DIR = OUT_DIR / "exports" / "previews" / "alignment"

for p in [
    IMAGES_DIR,
    LABELS_DIR,
    META_DIR,
    METRICS_DIR,
    PREVIEWS_DIR,
    OUT_DIR / "masks" / "footprint",
    OUT_DIR / "masks" / "ridge",
    OUT_DIR / "masks" / "hip",
    OUT_DIR / "masks" / "valley",
    OUT_DIR / "masks" / "eave",
    OUT_DIR / "masks" / "rake",
]:
    p.mkdir(parents=True, exist_ok=True)


@dataclass
class SampleRecord:
    sample_id: str
    vendor_report_id: str
    training_session_id: Optional[str]
    provider: str
    address: Optional[str]
    lat: Optional[float]
    lng: Optional[float]
    total_area_sqft: Optional[float]
    ridge_ft: Optional[float]
    hip_ft: Optional[float]
    valley_ft: Optional[float]
    eave_ft: Optional[float]
    rake_ft: Optional[float]
    predominant_pitch: Optional[float]
    image_path: Optional[str]
    accepted: bool
    rejection_reason: Optional[str]
    alignment_quality: Optional[float]


def supabase_select(table: str, select: str, filters: Optional[Dict[str, str]] = None) -> List[Dict]:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing")

    url = f"{SUPABASE_URL}/rest/v1/{table}"
    params = {"select": select}
    if filters:
        params.update(filters)

    resp = SESSION.get(url, params=params, timeout=60)
    resp.raise_for_status()
    return resp.json()


def mapbox_image(lat: float, lng: float) -> Image.Image:
    if not MAPBOX_ACCESS_TOKEN:
        raise RuntimeError("MAPBOX_ACCESS_TOKEN missing")
    url = f"https://api.mapbox.com/styles/v1/{MAPBOX_STYLE}/static/{lng},{lat},{MAPBOX_ZOOM},0,0/{MAPBOX_SIZE}x{MAPBOX_SIZE}@2x"
    r = requests.get(url, params={"access_token": MAPBOX_ACCESS_TOKEN}, timeout=60)
    r.raise_for_status()
    return Image.open(io.BytesIO(r.content)).convert("RGB")


def meters_per_pixel(lat: float, zoom: float) -> float:
    return 156543.03392 * math.cos(math.radians(lat)) / (2 ** zoom) / 2.0


def normalize_pitch(p: Optional[str]) -> Optional[float]:
    if p is None:
        return None
    if isinstance(p, (int, float)):
        return float(p)
    m = re.search(r"(\d+(?:\.\d+)?)\s*/\s*12", str(p))
    if m:
        return float(m.group(1))
    return None


def save_blank_mask(path: Path, size: Tuple[int, int], polygon: Optional[List[List[int]]] = None) -> None:
    img = Image.new("L", size, 0)
    if polygon:
        draw = ImageDraw.Draw(img)
        draw.polygon([tuple(p) for p in polygon], fill=255)
    img.save(path)


def fetch_vendor_reports() -> List[Dict]:
    return supabase_select(
        "roof_vendor_reports",
        select="id,provider,address,latitude,longitude,total_area_sqft,area_sqft,predominant_pitch,pitch,total_ridge_length,total_hip_length,total_valley_length,total_eave_length,total_rake_length,diagram_image_url,diagram_geometry,tenant_id",
    )


def fetch_training_sessions() -> List[Dict]:
    return supabase_select(
        "roof_training_sessions",
        select="id,vendor_report_id,address,target_lat,target_lng,provider,tenant_id",
    )


def reconcile_records(vendor_reports: List[Dict], training_sessions: List[Dict]) -> List[Dict]:
    by_vendor = {str(v["id"]): v for v in vendor_reports}
    out = []

    seen_vendor = set()
    for s in training_sessions:
        vendor_id = s.get("vendor_report_id")
        if not vendor_id or str(vendor_id) not in by_vendor:
            continue

        if str(vendor_id) in seen_vendor:
            continue
        seen_vendor.add(str(vendor_id))

        v = by_vendor[str(vendor_id)]
        provider = (v.get("provider") or s.get("provider") or "").lower()

        if provider not in {"eagleview", "roofr"}:
            continue

        out.append({
            "vendor_report": v,
            "training_session": s,
        })

    return out


def build_geometry_stub(vendor_report: Dict) -> Dict:
    raw_geom = vendor_report.get("diagram_geometry")
    if raw_geom:
        try:
            if isinstance(raw_geom, str):
                raw_geom = json.loads(raw_geom)
        except Exception:
            raw_geom = None

    if isinstance(raw_geom, dict) and raw_geom.get("footprint_polygon"):
        return raw_geom

    return {
        "footprint_polygon": [[280, 280], [760, 280], [760, 760], [280, 760]],
        "ridge_lines": [],
        "hip_lines": [],
        "valley_lines": [],
        "eave_lines": [],
        "rake_lines": [],
    }


def draw_lines_mask(size: Tuple[int, int], lines: List[List[int]]) -> Image.Image:
    img = Image.new("L", size, 0)
    draw = ImageDraw.Draw(img)
    for l in lines:
        if len(l) == 4:
            draw.line(tuple(l), fill=255, width=3)
    return img


def export_sample(vendor_report: Dict, training_session: Dict) -> SampleRecord:
    sample_id = str(uuid.uuid4())
    provider = (vendor_report.get("provider") or "").lower()

    lat = vendor_report.get("latitude") or training_session.get("target_lat")
    lng = vendor_report.get("longitude") or training_session.get("target_lng")

    if lat is None or lng is None:
        return SampleRecord(
            sample_id=sample_id,
            vendor_report_id=str(vendor_report["id"]),
            training_session_id=str(training_session["id"]),
            provider=provider,
            address=vendor_report.get("address") or training_session.get("address"),
            lat=None,
            lng=None,
            total_area_sqft=None,
            ridge_ft=None,
            hip_ft=None,
            valley_ft=None,
            eave_ft=None,
            rake_ft=None,
            predominant_pitch=None,
            image_path=None,
            accepted=False,
            rejection_reason="missing_geocode",
            alignment_quality=None,
        )

    img = mapbox_image(float(lat), float(lng))
    image_path = IMAGES_DIR / f"{sample_id}.png"
    img.save(image_path)

    geometry = build_geometry_stub(vendor_report)
    footprint_polygon = geometry.get("footprint_polygon")

    size = img.size
    save_blank_mask(OUT_DIR / "masks" / "footprint" / f"{sample_id}.png", size, footprint_polygon)
    draw_lines_mask(size, geometry.get("ridge_lines", [])).save(OUT_DIR / "masks" / "ridge" / f"{sample_id}.png")
    draw_lines_mask(size, geometry.get("hip_lines", [])).save(OUT_DIR / "masks" / "hip" / f"{sample_id}.png")
    draw_lines_mask(size, geometry.get("valley_lines", [])).save(OUT_DIR / "masks" / "valley" / f"{sample_id}.png")
    draw_lines_mask(size, geometry.get("eave_lines", [])).save(OUT_DIR / "masks" / "eave" / f"{sample_id}.png")
    draw_lines_mask(size, geometry.get("rake_lines", [])).save(OUT_DIR / "masks" / "rake" / f"{sample_id}.png")

    total_area = vendor_report.get("total_area_sqft") or vendor_report.get("area_sqft")
    ridge = vendor_report.get("total_ridge_length")
    hip = vendor_report.get("total_hip_length")
    valley = vendor_report.get("total_valley_length")
    eave = vendor_report.get("total_eave_length")
    rake = vendor_report.get("total_rake_length")
    pitch = normalize_pitch(vendor_report.get("predominant_pitch") or vendor_report.get("pitch"))

    accepted = all(v is not None for v in [total_area, ridge, hip, valley, eave, rake, pitch])

    labels = {
        "sample_id": sample_id,
        "vendor_report_id": str(vendor_report["id"]),
        "training_session_id": str(training_session["id"]),
        "vendor_source": provider,
        "address": vendor_report.get("address") or training_session.get("address"),
        "lat": float(lat),
        "lng": float(lng),
        "total_area_sqft": total_area,
        "ridge_ft": ridge,
        "hip_ft": hip,
        "valley_ft": valley,
        "eave_ft": eave,
        "rake_ft": rake,
        "predominant_pitch": pitch,
        "alignment_quality": 0.75 if accepted else 0.0,
        "accepted_for_training": bool(accepted),
        "rejection_reason": None if accepted else "missing_targets",
    }
    with open(LABELS_DIR / f"{sample_id}.json", "w") as f:
        json.dump(labels, f, indent=2)

    meta = {
        "sample_id": sample_id,
        "vendor_report_id": str(vendor_report["id"]),
        "training_session_id": str(training_session["id"]),
        "provider": provider,
        "address": vendor_report.get("address") or training_session.get("address"),
        "lat": float(lat),
        "lng": float(lng),
        "mapbox": {
            "style": MAPBOX_STYLE,
            "zoom": MAPBOX_ZOOM,
            "size": MAPBOX_SIZE,
            "provider": "mapbox",
            "meters_per_pixel": meters_per_pixel(float(lat), MAPBOX_ZOOM),
        },
        "geometry_source": "diagram_geometry_or_stub",
        "footprint_source": "vendor_or_stub",
        "accepted": bool(accepted),
    }
    with open(META_DIR / f"{sample_id}.json", "w") as f:
        json.dump(meta, f, indent=2)

    preview = img.copy().convert("RGBA")
    ov = Image.new("RGBA", preview.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(ov)
    if footprint_polygon:
        draw.polygon([tuple(p) for p in footprint_polygon], outline=(0, 0, 0, 255), fill=(0, 0, 0, 50))
    merged = Image.alpha_composite(preview, ov).convert("RGB")
    merged.save(PREVIEWS_DIR / f"{sample_id}_overlay.png")

    return SampleRecord(
        sample_id=sample_id,
        vendor_report_id=str(vendor_report["id"]),
        training_session_id=str(training_session["id"]),
        provider=provider,
        address=vendor_report.get("address") or training_session.get("address"),
        lat=float(lat),
        lng=float(lng),
        total_area_sqft=float(total_area) if total_area is not None else None,
        ridge_ft=float(ridge) if ridge is not None else None,
        hip_ft=float(hip) if hip is not None else None,
        valley_ft=float(valley) if valley is not None else None,
        eave_ft=float(eave) if eave is not None else None,
        rake_ft=float(rake) if rake is not None else None,
        predominant_pitch=float(pitch) if pitch is not None else None,
        image_path=str(image_path),
        accepted=bool(accepted),
        rejection_reason=None if accepted else "missing_targets",
        alignment_quality=0.75 if accepted else 0.0,
    )


def main():
    vendor_reports = fetch_vendor_reports()
    training_sessions = fetch_training_sessions()
    reconciled = reconcile_records(vendor_reports, training_sessions)

    usable: List[Dict] = []
    rejected: List[Dict] = []

    for rec in reconciled:
        sr = export_sample(rec["vendor_report"], rec["training_session"])
        if sr.accepted:
            usable.append(asdict(sr))
        else:
            rejected.append(asdict(sr))

    summary = {
        "total_vendor_reports": len(vendor_reports),
        "total_training_sessions": len(training_sessions),
        "reconciled_candidates": len(reconciled),
        "accepted": len(usable),
        "rejected": len(rejected),
        "output_dir": str(OUT_DIR),
    }

    with open(METRICS_DIR / "alignment_dataset_summary.json", "w") as f:
        json.dump(summary, f, indent=2)
    with open(METRICS_DIR / "alignment_usable_samples.json", "w") as f:
        json.dump(usable, f, indent=2)
    with open(METRICS_DIR / "alignment_rejected_samples.json", "w") as f:
        json.dump(rejected, f, indent=2)

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
