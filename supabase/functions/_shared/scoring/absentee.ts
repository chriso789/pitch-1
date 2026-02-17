// supabase/functions/_shared/scoring/absentee.ts
// Absentee / investor likelihood scoring

export interface AbsenteeScoreInput {
  propertyAddress?: string | null;
  mailingAddress?: string | null;
  homestead?: boolean | null;
  ownerName?: string | null;
}

export interface ScoreResult {
  score: number;
  reasons: string[];
}

function norm(s?: string | null): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function absenteeScore(input: AbsenteeScoreInput): ScoreResult {
  let score = 0;
  const reasons: string[] = [];

  const owner = (input.ownerName || "").toUpperCase();
  if (/LLC|INC|CORP|TRUST|HOLDINGS|PROPERTIES|INVEST|LP\b|LTD\b/.test(owner)) {
    score += 35;
    reasons.push("owner_is_entity");
  }

  if (input.homestead === false) {
    score += 15;
    reasons.push("homestead_false");
  }

  const prop = norm(input.propertyAddress);
  const mail = norm(input.mailingAddress);
  if (prop && mail && prop !== mail) {
    score += 40;
    reasons.push("mailing_differs_from_situs");
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}
