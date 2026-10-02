import type { RoofingTakeoffResult } from "./blueprint-roofing-takeoff.ts";

type QueryError = { message?: string } | null;
type QueryResult<T> = PromiseLike<{ data: T | null; error: QueryError }>;
type DbLike = {
  from: (table: string) => {
    upsert: (...args: unknown[]) => unknown;
  };
};

export interface RoofingPersistenceSummary {
  plan_paths: number;
  measurements: number;
  specifications: number;
}

export async function persistRoofingTakeoff(
  svc: DbLike,
  tenantId: string,
  result: RoofingTakeoffResult,
): Promise<RoofingPersistenceSummary> {
  const uniquePaths = new Map(result.plan_paths.map((path) => [path._key, path]));
  const pathRows = [...uniquePaths.values()].map(({ _key, ...path }) => ({
    tenant_id: tenantId,
    deterministic_key: _key,
    ...path,
  }));

  const pathBuilder = svc.from("blueprint_plan_paths").upsert(pathRows, {
    onConflict: "import_session_id,deterministic_key",
  }) as {
    select: (columns: string) => QueryResult<Array<{ id: string; deterministic_key: string }>>;
  };
  const { data: persistedPaths, error: pathError } = await pathBuilder.select("id,deterministic_key");
  if (pathError) throw new Error(`roofing_plan_path_upsert_failed: ${pathError.message ?? "unknown"}`);
  const pathIdByKey = new Map((persistedPaths ?? []).map((row) => [row.deterministic_key, row.id]));

  const measurementRows = result.measurements.map((measurement) => {
    const key = String(measurement.metadata?.plan_path_key ?? measurement.measurement_key);
    return {
      tenant_id: tenantId,
      deterministic_key: `${result.version}|measurement|${measurement.measurement_key}|${key}`,
      ...measurement,
      plan_path_id: pathIdByKey.get(String(measurement.metadata?.plan_path_key ?? "")) ?? null,
    };
  });
  if (measurementRows.length) {
    const builder = svc.from("blueprint_measurement_objects").upsert(measurementRows, {
      onConflict: "import_session_id,deterministic_key",
    }) as { select: (columns: string) => QueryResult<Array<{ id: string }>> };
    const { error } = await builder.select("id");
    if (error) throw new Error(`roofing_measurement_upsert_failed: ${error.message ?? "unknown"}`);
  }

  const specRows = result.specifications.map((specification) => {
    const key = String(specification.metadata?.plan_path_key ?? specification.spec_key);
    return {
      tenant_id: tenantId,
      deterministic_key: `${result.version}|spec|${specification.spec_key}|${key}`,
      ...specification,
      plan_path_id: pathIdByKey.get(String(specification.metadata?.plan_path_key ?? "")) ?? null,
    };
  });
  if (specRows.length) {
    const builder = svc.from("blueprint_trade_specifications").upsert(specRows, {
      onConflict: "import_session_id,deterministic_key",
    }) as { select: (columns: string) => QueryResult<Array<{ id: string }>> };
    const { error } = await builder.select("id");
    if (error) throw new Error(`roofing_specification_upsert_failed: ${error.message ?? "unknown"}`);
  }

  return {
    plan_paths: pathRows.length,
    measurements: measurementRows.length,
    specifications: specRows.length,
  };
}
