import io
import json
import math
import os
from dataclasses import dataclass, asdict
from typing import Dict, List, Optional, Tuple

import requests
import numpy as np
from PIL import Image

# =====================================================
# ENV
# =====================================================

GOOGLE_SOLAR_API_KEY = os.environ["GOOGLE_SOLAR_API_KEY"]
MAPBOX_ACCESS_TOKEN = os.environ["MAPBOX_ACCESS_TOKEN"]

MAPBOX_STYLE = os.environ.get("MAPBOX_STYLE", "mapbox/satellite-v9")
MAPBOX_IMAGE_SIZE = int(os.environ.get("MAPBOX_IMAGE_SIZE", "1024"))
MAPBOX_ZOOM = float(os.environ.get("MAPBOX_ZOOM", "20"))
USER_AGENT = os.environ.get("USER_AGENT", "pitch-roof-ai/1.0")

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": USER_AGENT})

# =====================================================
# DATA MODELS
# =====================================================

@dataclass
class SolarBuildingInsights:
    center_lat: float
    center_lng: float
    imagery_date: Optional[str]
    imagery_processed_date: Optional[str]
    postal_code: Optional[str]
    administrative_area: Optional[str]
    region_code: Optional[str]
    bounding_box: Optional[Dict]
    roof_segment_stats: List[Dict]
    solar_potential: Dict

@dataclass
class SolarDataLayers:
    imagery_quality: Optional[str]
    imagery_date: Optional[str]
    imagery_processed_date: Optional[str]
    dsm_url: Optional[str]
    rgb_url: Optional[str]
    mask_url: Optional[str]
    annual_flux_url: Optional[str]
    monthly_flux_url: Optional[str]
    hourly_shade_urls: List[str]

@dataclass
class MapboxStaticImageResult:
    image: Image.Image
    width: int
    height: int
    center_lat: float
    center_lng: float
    zoom: float
    meters_per_pixel: float

@dataclass
class FusionResult:
    lat: float
    lng: float
    building_insights: Dict
    data_layers: Dict
    footprint_geojson: Optional[Dict]
    mapbox_image_metadata: Dict
    terrain_samples_m: List[Dict]

# =====================================================
# GEOMETRY / MAP MATH
# =====================================================

def meters_per_pixel(lat: float, zoom: float) -> float:
    return 156543.03392 * math.cos(math.radians(lat)) / (2 ** zoom)

def lonlat_to_tile(lon: float, lat: float, z: int) -> Tuple[int, int]:
    lat_rad = math.radians(lat)
    n = 2.0 ** z
    xtile = int((lon + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return xtile, ytile

def decode_terrain_rgb(r: int, g: int, b: int) -> float:
    # Mapbox Terrain-RGB standard decode
    return -10000.0 + ((r * 256 * 256 + g * 256 + b) * 0.1)

# =====================================================
# GOOGLE SOLAR
# =====================================================

def get_google_building_insights(lat: float, lng: float) -> SolarBuildingInsights:
    url = "https://solar.googleapis.com/v1/buildingInsights:findClosest"
    params = {
        "location.latitude": lat,
        "location.longitude": lng,
        "requiredQuality": "HIGH",
        "key": GOOGLE_SOLAR_API_KEY,
    }
    r = SESSION.get(url, params=params, timeout=30)
    r.raise_for_status()
    data = r.json()

    center = data.get("center", {})
    return SolarBuildingInsights(
        center_lat=center.get("latitude", lat),
        center_lng=center.get("longitude", lng),
        imagery_date=_date_obj_to_str(data.get("imageryDate")),
        imagery_processed_date=_date_obj_to_str(data.get("imageryProcessedDate")),
        postal_code=data.get("postalCode"),
        administrative_area=data.get("administrativeArea"),
        region_code=data.get("regionCode"),
        bounding_box=data.get("boundingBox"),
        roof_segment_stats=data.get("solarPotential", {}).get("roofSegmentStats", []),
        solar_potential=data.get("solarPotential", {}),
    )

def get_google_data_layers(lat: float, lng: float, radius_meters: int = 35) -> SolarDataLayers:
    url = "https://solar.googleapis.com/v1/dataLayers:get"
    params = {
        "location.latitude": lat,
        "location.longitude": lng,
        "radiusMeters": radius_meters,
        "view": "FULL_LAYERS",
        "requiredQuality": "HIGH",
        "pixelSizeMeters": 0.1,
        "exactQualityRequired": "false",
        "key": GOOGLE_SOLAR_API_KEY,
    }
    r = SESSION.get(url, params=params, timeout=30)
    r.raise_for_status()
    data = r.json()

    return SolarDataLayers(
        imagery_quality=data.get("imageryQuality"),
        imagery_date=_date_obj_to_str(data.get("imageryDate")),
        imagery_processed_date=_date_obj_to_str(data.get("imageryProcessedDate")),
        dsm_url=data.get("dsmUrl"),
        rgb_url=data.get("rgbUrl"),
        mask_url=data.get("maskUrl"),
        annual_flux_url=data.get("annualFluxUrl"),
        monthly_flux_url=data.get("monthlyFluxUrl"),
        hourly_shade_urls=data.get("hourlyShadeUrls", []),
    )

def _date_obj_to_str(obj: Optional[Dict]) -> Optional[str]:
    if not obj:
        return None
    year = obj.get("year")
    month = obj.get("month")
    day = obj.get("day")
    if year and month and day:
        return f"{year:04d}-{month:02d}-{day:02d}"
    return None

# =====================================================
# MAPBOX
# =====================================================

def get_mapbox_static_image(lat: float, lng: float, zoom: float = MAPBOX_ZOOM, size: int = MAPBOX_IMAGE_SIZE) -> MapboxStaticImageResult:
    url = f"https://api.mapbox.com/styles/v1/{MAPBOX_STYLE}/static/{lng},{lat},{zoom},0,0/{size}x{size}@2x"
    params = {"access_token": MAPBOX_ACCESS_TOKEN}
    r = SESSION.get(url, params=params, timeout=60)
    r.raise_for_status()

    img = Image.open(io.BytesIO(r.content)).convert("RGB")
    mpp = meters_per_pixel(lat, zoom) / 2.0  # @2x doubles effective pixel density
    return MapboxStaticImageResult(
        image=img,
        width=img.width,
        height=img.height,
        center_lat=lat,
        center_lng=lng,
        zoom=zoom,
        meters_per_pixel=mpp,
    )

def get_mapbox_building_footprint(lat: float, lng: float, radius: int = 5) -> Optional[Dict]:
    tileset_id = "mapbox.mapbox-streets-v8"
    url = f"https://api.mapbox.com/v4/{tileset_id}/tilequery/{lng},{lat}.json"
    params = {
        "radius": radius,
        "limit": 10,
        "geometry": "polygon",
        "access_token": MAPBOX_ACCESS_TOKEN,
    }
    r = SESSION.get(url, params=params, timeout=30)
    r.raise_for_status()
    data = r.json()

    features = data.get("features", [])
    if not features:
        return None

    for feat in features:
        geom = feat.get("geometry", {})
        if geom.get("type") in ("Polygon", "MultiPolygon"):
            return feat
    return None

def get_mapbox_terrain_sample(lat: float, lng: float, z: int = 15) -> Dict:
    xtile, ytile = lonlat_to_tile(lng, lat, z)
    url = f"https://api.mapbox.com/v4/mapbox.terrain-rgb/{z}/{xtile}/{ytile}.pngraw"
    params = {"access_token": MAPBOX_ACCESS_TOKEN}
    r = SESSION.get(url, params=params, timeout=60)
    r.raise_for_status()

    img = Image.open(io.BytesIO(r.content)).convert("RGB")
    arr = np.array(img)

    n = 2 ** z
    x = ((lng + 180.0) / 360.0 * n - xtile) * arr.shape[1]
    lat_rad = math.radians(lat)
    y = ((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n - ytile) * arr.shape[0]

    px = min(max(int(round(x)), 0), arr.shape[1] - 1)
    py = min(max(int(round(y)), 0), arr.shape[0] - 1)
    r_, g_, b_ = arr[py, px]
    elevation_m = decode_terrain_rgb(int(r_), int(g_), int(b_))

    return {
        "lat": lat,
        "lng": lng,
        "z": z,
        "x_tile": xtile,
        "y_tile": ytile,
        "tile_pixel_x": px,
        "tile_pixel_y": py,
        "elevation_m": elevation_m,
    }

# =====================================================
# FUSION
# =====================================================

def run_fusion(lat: float, lng: float) -> FusionResult:
    building = get_google_building_insights(lat, lng)

    use_lat = building.center_lat
    use_lng = building.center_lng

    data_layers = get_google_data_layers(use_lat, use_lng, radius_meters=35)
    static_img = get_mapbox_static_image(use_lat, use_lng, zoom=MAPBOX_ZOOM, size=MAPBOX_IMAGE_SIZE)
    footprint = get_mapbox_building_footprint(use_lat, use_lng, radius=6)
    terrain_center = get_mapbox_terrain_sample(use_lat, use_lng, z=15)

    terrain_samples = [terrain_center]

    if building.bounding_box:
        sw = building.bounding_box.get("sw")
        ne = building.bounding_box.get("ne")
        if sw and ne:
            corners = [
                (sw["latitude"], sw["longitude"]),
                (sw["latitude"], ne["longitude"]),
                (ne["latitude"], sw["longitude"]),
                (ne["latitude"], ne["longitude"]),
            ]
            for c_lat, c_lng in corners:
                try:
                    terrain_samples.append(get_mapbox_terrain_sample(c_lat, c_lng, z=15))
                except Exception:
                    pass

    return FusionResult(
        lat=use_lat,
        lng=use_lng,
        building_insights=asdict(building),
        data_layers=asdict(data_layers),
        footprint_geojson=footprint,
        mapbox_image_metadata={
            "width": static_img.width,
            "height": static_img.height,
            "center_lat": static_img.center_lat,
            "center_lng": static_img.center_lng,
            "zoom": static_img.zoom,
            "meters_per_pixel": static_img.meters_per_pixel,
        },
        terrain_samples_m=terrain_samples,
    )

def save_fusion_package(result: FusionResult, output_dir: str):
    os.makedirs(output_dir, exist_ok=True)
    with open(os.path.join(output_dir, "fusion.json"), "w", encoding="utf-8") as f:
        json.dump(asdict(result), f, indent=2)

def fetch_and_save(lat: float, lng: float, output_dir: str):
    result = run_fusion(lat, lng)
    save_fusion_package(result, output_dir)

    static_img = get_mapbox_static_image(result.lat, result.lng, zoom=MAPBOX_ZOOM, size=MAPBOX_IMAGE_SIZE)
    static_img.image.save(os.path.join(output_dir, "mapbox_satellite.png"))

    print(json.dumps(asdict(result), indent=2))
    print(f"Saved to {output_dir}")

# =====================================================
# CLI
# =====================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--lat", type=float, required=True)
    parser.add_argument("--lng", type=float, required=True)
    parser.add_argument("--out", type=str, required=True)
    args = parser.parse_args()

    fetch_and_save(args.lat, args.lng, args.out)
