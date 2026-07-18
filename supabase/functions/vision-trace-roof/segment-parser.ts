export type VisionTraceSegment = {
  type: "eave" | "rake" | "ridge" | "hip" | "valley";
  points: Array<[number, number]>;
  confidence?: number;
};

const ALLOWED_SEGMENT_TYPES = new Set(["eave", "rake", "ridge", "hip", "valley"]);

function normalizeSegment(s: any): VisionTraceSegment | null {
  if (!ALLOWED_SEGMENT_TYPES.has(s?.type)) return null;
  const pts = Array.isArray(s?.points) ? s.points : [];
  const norm: Array<[number, number]> = [];
  for (const p of pts) {
    if (Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]))) {
      norm.push([Number(p[0]), Number(p[1])]);
    }
  }
  if (norm.length < 2) return null;
  return {
    type: s.type,
    points: norm,
    confidence: Number.isFinite(Number(s?.confidence)) ? Number(s.confidence) : undefined,
  };
}

function stripMarkdownAndDiagnostics(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .replace(/\n?\[[a-z0-9_:-]+\].*$/is, "")
    .trim();
}

function parseCompleteJsonObject(raw: string): VisionTraceSegment[] {
  let parsed: any;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return [];
    try { parsed = JSON.parse(m[0]); } catch { return []; }
  }
  const segs = Array.isArray(parsed?.segments) ? parsed.segments : [];
  return segs.map(normalizeSegment).filter(Boolean) as VisionTraceSegment[];
}

function salvageSegmentObjects(raw: string): VisionTraceSegment[] {
  const out: VisionTraceSegment[] = [];
  const seen = new Set<string>();
  const segmentObjectPattern = /\{\s*"type"\s*:\s*"(?:eave|rake|ridge|hip|valley)"[\s\S]*?\}/g;
  for (const match of raw.matchAll(segmentObjectPattern)) {
    try {
      const normalized = normalizeSegment(JSON.parse(match[0]));
      if (!normalized) continue;
      const key = `${normalized.type}:${JSON.stringify(normalized.points)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(normalized);
    } catch {
      // ignore malformed trailing segment object
    }
  }
  return out;
}

export function parseSegments(text: string): VisionTraceSegment[] {
  const raw = stripMarkdownAndDiagnostics(text);
  const parsed = parseCompleteJsonObject(raw);
  if (parsed.length > 0) return parsed;
  return salvageSegmentObjects(raw);
}