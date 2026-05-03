type Point = { x: number; y: number };

type Face = {
  id: number;
  polygon: Point[];
};

function polygonArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return Math.abs(a / 2);
}

function centroid(poly: Point[]): Point {
  let x = 0, y = 0;
  for (const p of poly) { x += p.x; y += p.y; }
  return { x: x / poly.length, y: y / poly.length };
}

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function normalizedFaceKey(poly: Point[]): string {
  const keys = poly.map((p) => `${Math.round(p.x)}:${Math.round(p.y)}`);
  if (keys.length === 0) return "";
  const rotations = keys.map((_, i) => [...keys.slice(i), ...keys.slice(0, i)].join("|"));
  const reversed = [...keys].reverse();
  const reverseRotations = reversed.map((_, i) => [...reversed.slice(i), ...reversed.slice(0, i)].join("|"));
  return [...rotations, ...reverseRotations].sort()[0];
}

function removeOuterFace(faces: Face[]): Face[] {
  if (faces.length <= 1) return faces;
  let maxArea = 0;
  let outerIndex = -1;
  for (let i = 0; i < faces.length; i++) {
    const area = polygonArea(faces[i].polygon);
    if (area > maxArea) { maxArea = area; outerIndex = i; }
  }
  return faces.filter((_, i) => i !== outerIndex);
}

function removeTinyFaces(faces: Face[], footprintArea: number): Face[] {
  // Keep real sub-facets on complex roofs. A 1% footprint threshold can delete
  // legitimate dormer/wing facets before coverage is computed; use a small
  // absolute floor instead and let downstream coverage/plane-fit gates decide.
  const minArea = Math.max(20, footprintArea * 0.0015);
  return faces.filter((f) => polygonArea(f.polygon) > minArea);
}

function removeDuplicateFaces(faces: Face[]): Face[] {
  const seen = new Set<string>();
  return faces.filter((f) => {
    const key = normalizedFaceKey(f.polygon);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function removeOverlaps(faces: Face[]): Face[] {
  const result: Face[] = [];

  for (let i = 0; i < faces.length; i++) {
    let keep = true;
    const ci = centroid(faces[i].polygon);

    for (let j = 0; j < faces.length; j++) {
      if (i === j) continue;

      if (pointInPolygon(ci, faces[j].polygon)) {
        const ai = polygonArea(faces[i].polygon);
        const aj = polygonArea(faces[j].polygon);
        if (ai < aj) {
          // Only remove if normals are similar (< 5 deg) — but we don't have
          // normals at this stage, so use a safe fallback: DO NOT remove if
          // the smaller face is > 30% the size of the larger (likely a real adjacent plane)
          if (ai > aj * 0.3) {
            // Likely a real adjacent plane, not an overlap — keep it
            continue;
          }
          keep = false;
          break;
        }
      }
    }

    if (keep) result.push(faces[i]);
  }

  return result;
}

function filterOutside(faces: Face[], footprint: Point[]): Face[] {
  return faces.filter((f) => pointInPolygon(centroid(f.polygon), footprint));
}

export function filterRoofFaces(faces: Face[], footprint: Point[]): Face[] {
  const footprintArea = polygonArea(footprint);
  const afterOuterRemoved = removeOuterFace(faces);
  const afterTinyRemoved = removeTinyFaces(afterOuterRemoved, footprintArea);
  const afterDuplicatesRemoved = removeDuplicateFaces(afterTinyRemoved);
  const afterOverlapsRemoved = removeOverlaps(afterDuplicatesRemoved);
  const cleaned = filterOutside(afterOverlapsRemoved, footprint);

  console.log("[FACE_FILTER]", JSON.stringify({
    input: faces.length,
    after_outer_removed: afterOuterRemoved.length,
    after_tiny_removed: afterTinyRemoved.length,
    after_duplicates_removed: afterDuplicatesRemoved.length,
    after_overlaps_removed: afterOverlapsRemoved.length,
    output: cleaned.length,
    footprint_area: footprintArea,
  }));

  return cleaned;
}
