// supabase/functions/_shared/routing/routePlanner.ts

import { haversineMeters } from "./haversine.ts";

type Stop = { key: string; lat: number; lng: number; priority: number; address?: string };

export function planRoute(input: { start: { lat: number; lng: number }; stops: Stop[] }) {
  // 1) Grid cluster (~1km cells) to reduce zig-zag
  const clusters = gridCluster(input.stops, 0.01);

  // 2) Order clusters by distance from start (greedy)
  const orderedClusters = orderClusters(input.start, clusters);

  // 3) Within each cluster: nearest neighbor (priority-weighted)
  let route: Stop[] = [];
  let cursor = input.start;

  for (const cluster of orderedClusters) {
    const ordered = nearestNeighbor(cursor, cluster);
    route = route.concat(ordered);
    const last = route[route.length - 1];
    cursor = { lat: last.lat, lng: last.lng };
  }

  // 4) 2-opt improvement pass
  route = twoOpt(route, input.start, 80);

  return {
    orderedStops: route,
    meta: { method: "grid_cluster+nn+2opt", clusters: orderedClusters.length },
  };
}

function gridCluster(stops: Stop[], cell: number) {
  const map = new Map<string, Stop[]>();
  for (const s of stops) {
    const k = `${Math.floor(s.lat / cell)}_${Math.floor(s.lng / cell)}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(s);
  }
  return Array.from(map.values()).map((list) => list.sort((a, b) => b.priority - a.priority));
}

function orderClusters(start: { lat: number; lng: number }, clusters: Stop[][]) {
  const remaining = clusters.slice();
  const ordered: Stop[][] = [];
  let cursor = start;

  while (remaining.length) {
    let bestIdx = 0;
    let bestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const centroid = clusterCentroid(remaining[i]);
      const d = haversineMeters(cursor.lat, cursor.lng, centroid.lat, centroid.lng);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    const picked = remaining.splice(bestIdx, 1)[0];
    ordered.push(picked);
    cursor = clusterCentroid(picked);
  }

  return ordered;
}

function clusterCentroid(cluster: Stop[]) {
  let lat = 0, lng = 0;
  for (const s of cluster) { lat += s.lat; lng += s.lng; }
  return { lat: lat / cluster.length, lng: lng / cluster.length };
}

function nearestNeighbor(start: { lat: number; lng: number }, stops: Stop[]) {
  const remaining = stops.slice();
  const ordered: Stop[] = [];
  let cursor = start;

  while (remaining.length) {
    let bestIdx = 0;
    let bestScore = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const d = haversineMeters(cursor.lat, cursor.lng, remaining[i].lat, remaining[i].lng);
      const weighted = d / (1 + remaining[i].priority / 200);
      if (weighted < bestScore) {
        bestScore = weighted;
        bestIdx = i;
      }
    }

    const picked = remaining.splice(bestIdx, 1)[0];
    ordered.push(picked);
    cursor = { lat: picked.lat, lng: picked.lng };
  }

  return ordered;
}

function routeDistance(route: Stop[], start: { lat: number; lng: number }) {
  let d = 0;
  let prev = start;
  for (const s of route) {
    d += haversineMeters(prev.lat, prev.lng, s.lat, s.lng);
    prev = { lat: s.lat, lng: s.lng };
  }
  return d;
}

function twoOpt(route: Stop[], start: { lat: number; lng: number }, iters: number) {
  let best = route.slice();
  let bestDist = routeDistance(best, start);

  for (let k = 0; k < iters; k++) {
    let improved = false;

    for (let i = 0; i < best.length - 2; i++) {
      for (let j = i + 1; j < best.length - 1; j++) {
        const candidate = best.slice();
        const seg = candidate.slice(i, j + 1).reverse();
        candidate.splice(i, j - i + 1, ...seg);

        const d = routeDistance(candidate, start);
        if (d < bestDist) {
          best = candidate;
          bestDist = d;
          improved = true;
        }
      }
    }

    if (!improved) break;
  }

  return best;
}
