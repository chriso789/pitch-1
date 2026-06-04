"""Synthetic LAS fixture generator for clip_point_cloud integration tests.

Generates a tiny LAS file containing:
  * A known grid of points INSIDE a known AOI rectangle.
  * A second cluster of points well OUTSIDE the AOI.
  * EPSG:32633 (a generic UTM CRS) so coordinates are planar metres and
    bounds/intersection math is trivial.

The fixture is generated at test time into a tempdir — we never commit binary
LAS files to git. The function is deterministic given (seed, point counts).
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Tuple

import numpy as np


FIXTURE_CRS_EPSG = 32633
AOI_BOUNDS: Tuple[float, float, float, float] = (500000.0, 5000000.0, 500050.0, 5000050.0)
OUTSIDE_OFFSET = 500.0  # metres away from AOI for the "outside" cluster


@dataclass
class FixtureMeta:
    path: str
    crs_epsg: int
    aoi_bounds: Tuple[float, float, float, float]
    points_inside: int
    points_outside: int
    total_points: int


def aoi_polygon_geojson(shrink: float = 0.0) -> dict:
    """GeoJSON polygon for the fixture AOI (optionally shrunk inward)."""
    minx, miny, maxx, maxy = AOI_BOUNDS
    minx += shrink; miny += shrink; maxx -= shrink; maxy -= shrink
    return {
        "type": "Polygon",
        "coordinates": [[
            [minx, miny], [maxx, miny], [maxx, maxy], [minx, maxy], [minx, miny],
        ]],
    }


def aoi_polygon_outside_geojson() -> dict:
    """AOI polygon shifted entirely OUTSIDE all generated points."""
    minx, miny, _, _ = AOI_BOUNDS
    ox = minx + 10_000.0
    oy = miny + 10_000.0
    return {
        "type": "Polygon",
        "coordinates": [[
            [ox, oy], [ox + 10.0, oy], [ox + 10.0, oy + 10.0], [ox, oy + 10.0], [ox, oy],
        ]],
    }


def generate_fixture_las(
    out_path: str,
    inside_grid: int = 40,
    outside_count: int = 200,
    seed: int = 1337,
) -> FixtureMeta:
    """Write a small LAS fixture to `out_path` and return its metadata."""
    import laspy  # heavy import only when fixture is built

    rng = np.random.default_rng(seed)
    minx, miny, maxx, maxy = AOI_BOUNDS

    xs_in = np.linspace(minx + 1.0, maxx - 1.0, inside_grid)
    ys_in = np.linspace(miny + 1.0, maxy - 1.0, inside_grid)
    xi, yi = np.meshgrid(xs_in, ys_in)
    inside_x = xi.ravel()
    inside_y = yi.ravel()
    inside_z = 100.0 + rng.uniform(-0.5, 0.5, size=inside_x.size)

    out_cx = minx + OUTSIDE_OFFSET
    out_cy = miny + OUTSIDE_OFFSET
    outside_x = rng.uniform(out_cx - 25.0, out_cx + 25.0, size=outside_count)
    outside_y = rng.uniform(out_cy - 25.0, out_cy + 25.0, size=outside_count)
    outside_z = 95.0 + rng.uniform(-0.5, 0.5, size=outside_count)

    xs = np.concatenate([inside_x, outside_x])
    ys = np.concatenate([inside_y, outside_y])
    zs = np.concatenate([inside_z, outside_z])

    header = laspy.LasHeader(point_format=3, version="1.2")
    header.scales = [0.001, 0.001, 0.001]
    header.offsets = [
        float(np.floor(xs.min())),
        float(np.floor(ys.min())),
        float(np.floor(zs.min())),
    ]
    try:
        from pyproj import CRS as _CRS  # type: ignore
        header.add_crs(_CRS.from_epsg(FIXTURE_CRS_EPSG))
    except Exception:
        pass

    las = laspy.LasData(header)
    las.x = xs
    las.y = ys
    las.z = zs

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    las.write(out_path)

    return FixtureMeta(
        path=out_path,
        crs_epsg=FIXTURE_CRS_EPSG,
        aoi_bounds=AOI_BOUNDS,
        points_inside=int(inside_x.size),
        points_outside=int(outside_count),
        total_points=int(xs.size),
    )


if __name__ == "__main__":  # manual smoke
    import tempfile
    p = os.path.join(tempfile.gettempdir(), "pitch_fixture.las")
    meta = generate_fixture_las(p)
    print(meta)
