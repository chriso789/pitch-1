// supabase/functions/_shared/intel/damage.ts

export interface DamageConfig {
  hail_points_per_inch?: number;
  hail_cap?: number;
  wind_points_per_3mph?: number;
  wind_cap?: number;
  age_points_per_2yrs?: number;
  age_cap?: number;
}

export function scoreDamage({ storm, prop, config }: { storm: any; prop: any; config?: DamageConfig }) {
  let score = 0;
  const f: Record<string, any> = {};

  const hailPtsPerInch = config?.hail_points_per_inch ?? 18;
  const hailCap = config?.hail_cap ?? 45;
  const windPtsPer3 = config?.wind_points_per_3mph ?? 1;
  const windCap = config?.wind_cap ?? 35;
  const agePtsPer2 = config?.age_points_per_2yrs ?? 1;
  const ageCap = config?.age_cap ?? 20;

  const year = prop.year_built ?? null;
  const age = year ? Math.max(0, new Date().getFullYear() - year) : null;

  // Storm intensity
  const hail = Number(storm.hail_max_in ?? 0);
  const wind = Number(storm.max_wind_mph ?? 0);

  const hailPts = Math.min(hailCap, Math.round(hail * hailPtsPerInch));
  const windPts = Math.min(windCap, Math.round(wind / 3 * windPtsPer3));

  score += hailPts + windPts;
  f.hail = { hail_in: hail, points: hailPts };
  f.wind = { wind_mph: wind, points: windPts };

  // Age vulnerability
  if (age !== null) {
    const agePts = Math.min(ageCap, Math.round(age / 2 * agePtsPer2));
    score += agePts;
    f.age = { roof_age_proxy: age, points: agePts };
  } else {
    f.age = { roof_age_proxy: null, points: 0 };
  }

  score = Math.max(0, Math.min(100, score));
  return { score, factors: f };
}
