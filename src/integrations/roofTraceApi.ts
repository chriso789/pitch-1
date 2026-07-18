// RoofTrace AI client — calls measurement-api routes via edgeApi.
import { edgeApi } from "@/lib/edgeApi";

export type RoofTraceSession = {
  id: string;
  tenant_id: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  perimeter_status: "pending" | "proposed" | "needs_review" | "accepted" | "rejected";
  result_state: string;
  current_revision: number;
  approved_revision: number | null;
  job_id: string | null;
  created_at: string;
};

export type RoofTraceRevision = {
  id: string;
  session_id: string;
  revision: number;
  state: "draft" | "approved" | "superseded";
  geometry: {
    coordinate_space: string;
    image_width: number;
    image_height: number;
    outer_perimeter: [number, number][];
    segments: any[];
    image_url: string | null;
    image_bounds?: any;
    zoom?: number | null;
  };
  perimeter_gate_metrics: {
    closed: boolean;
    self_intersects: boolean;
    area_px: number;
    perimeter_px: number;
    coverage_pct: number;
    passes: boolean;
  };
  warnings: any[];
  approved_at: string | null;
  approved_by: string | null;
};

export type RoofTraceJob = {
  id: string;
  session_id: string;
  type: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

export async function createRoofTraceSession(input: {
  address: string;
  lat: number;
  lng: number;
  job_id?: string | null;
}) {
  const { data, error } = await edgeApi<{ session: RoofTraceSession }>(
    "measurement-api",
    "/roof-trace/sessions",
    input as unknown as Record<string, unknown>,
  );
  if (error) throw new Error(error);
  return data!.session;
}

export async function runRoofTracePerimeter(session_id: string) {
  const { data, error } = await edgeApi<{
    session_id: string;
    revision: RoofTraceRevision;
    gate_metrics: RoofTraceRevision["perimeter_gate_metrics"];
  }>("measurement-api", "/roof-trace/sessions/run", { session_id });
  if (error) throw new Error(error);
  return data!;
}

export async function getRoofTraceSession(session_id: string) {
  const { data, error } = await edgeApi<{
    session: RoofTraceSession;
    revisions: RoofTraceRevision[];
    jobs: RoofTraceJob[];
  }>("measurement-api", "/roof-trace/sessions/get", { session_id });
  if (error) throw new Error(error);
  return data!;
}

export async function approveRoofTraceSession(session_id: string) {
  const { data, error } = await edgeApi<{
    revision: RoofTraceRevision;
    measurement_draft: { id: string; status: string };
  }>("measurement-api", "/roof-trace/sessions/approve", { session_id });
  if (error) throw new Error(error);
  return data!;
}
