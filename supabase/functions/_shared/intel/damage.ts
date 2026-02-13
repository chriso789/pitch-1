// supabase/functions/_shared/intel/damage.ts

export function scoreDamage({ storm, prop }: { storm: any; prop: any }) {
  let score = 0;
  const f: Record<string, any> = {};

  const year = prop.year_built ?? null;
  const age = year ? Math.max(0, new Date().getFullYear() - year) : null;

  // Storm intensity
  const hail = Number(storm.hail_max_in ?? 0);
  const wind = Number(storm.max_wind_mph ?? 0);

  const hailPts = Math.min(45, Math.round(hail * 18)); // 1" ≈ 18pts
  const windPts = Math.min(35, Math.round(wind / 3));   // 105mph ≈ 35pts

  score += hailPts + windPts;
  f.hail = { hail_in: hail, points: hailPts };
  f.wind = { wind_mph: wind, points: windPts };

  // Age vulnerability
  if (age !== null) {
    const agePts = Math.min(20, Math.round(age / 2)); // 40yrs => 20
    score += agePts;
    f.age = { roof_age_proxy: age, points: agePts };
  } else {
    f.age = { roof_age_proxy: null, points: 0 };
  }

  score = Math.max(0, Math.min(100, score));
  return { score, factors: f };
}
