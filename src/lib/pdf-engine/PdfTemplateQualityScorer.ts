/**
 * PITCH PDF Template Quality Scorer
 * Scores templates 0–100 based on field mappings, layout risks, and completeness.
 */

export type QualityBadge = 'Ready' | 'Needs Review' | 'Unsafe';

export interface QualityScoreResult {
  score: number;
  badge: QualityBadge;
  breakdown: {
    smartFieldCoverage: number;    // 0-25
    requiredMappings: number;      // 0-20
    placeholderResolution: number; // 0-15
    textOverflowRisk: number;     // 0-15
    fontFallbackRisk: number;     // 0-10
    redactionRisk: number;        // 0-10
    ocrConfidence: number;        // 0-5
  };
  issues: string[];
}

export interface TemplateQualityInput {
  smartFieldCount: number;
  totalTextObjects: number;
  unresolvedPlaceholders: string[];
  missingRequiredFields: string[];
  textOverflowWarnings: number;
  fontFallbackCount: number;
  hasRedactions: boolean;
  redactionVerified: boolean;
  ocrPageCount: number;
  totalPageCount: number;
  averageOcrConfidence: number;
}

export class PdfTemplateQualityScorer {
  static score(input: TemplateQualityInput): QualityScoreResult {
    const issues: string[] = [];
    const breakdown = {
      smartFieldCoverage: 0,
      requiredMappings: 0,
      placeholderResolution: 0,
      textOverflowRisk: 0,
      fontFallbackRisk: 0,
      redactionRisk: 0,
      ocrConfidence: 0,
    };

    // Smart field coverage (0-25)
    if (input.totalTextObjects > 0) {
      const ratio = input.smartFieldCount / Math.max(input.totalTextObjects, 1);
      breakdown.smartFieldCoverage = Math.min(25, Math.round(ratio * 100));
      if (input.smartFieldCount === 0) {
        issues.push('No smart fields detected — template cannot auto-fill');
      }
    } else {
      breakdown.smartFieldCoverage = 25; // No text = no fields needed
    }

    // Required mappings (0-20)
    if (input.missingRequiredFields.length === 0) {
      breakdown.requiredMappings = 20;
    } else {
      const penalty = Math.min(20, input.missingRequiredFields.length * 5);
      breakdown.requiredMappings = 20 - penalty;
      issues.push(`${input.missingRequiredFields.length} required field(s) unmapped: ${input.missingRequiredFields.slice(0, 3).join(', ')}`);
    }

    // Placeholder resolution (0-15)
    if (input.unresolvedPlaceholders.length === 0) {
      breakdown.placeholderResolution = 15;
    } else {
      const penalty = Math.min(15, input.unresolvedPlaceholders.length * 3);
      breakdown.placeholderResolution = 15 - penalty;
      issues.push(`${input.unresolvedPlaceholders.length} unresolved placeholder(s)`);
    }

    // Text overflow risk (0-15)
    if (input.textOverflowWarnings === 0) {
      breakdown.textOverflowRisk = 15;
    } else {
      const penalty = Math.min(15, input.textOverflowWarnings * 5);
      breakdown.textOverflowRisk = 15 - penalty;
      issues.push(`${input.textOverflowWarnings} text overflow warning(s)`);
    }

    // Font fallback risk (0-10)
    if (input.fontFallbackCount === 0) {
      breakdown.fontFallbackRisk = 10;
    } else {
      const penalty = Math.min(10, input.fontFallbackCount * 2);
      breakdown.fontFallbackRisk = 10 - penalty;
      issues.push(`${input.fontFallbackCount} font(s) using fallback`);
    }

    // Redaction risk (0-10)
    if (!input.hasRedactions) {
      breakdown.redactionRisk = 10;
    } else if (input.redactionVerified) {
      breakdown.redactionRisk = 10;
    } else {
      breakdown.redactionRisk = 0;
      issues.push('Redactions present but not verified');
    }

    // OCR confidence (0-5)
    if (input.ocrPageCount === 0) {
      breakdown.ocrConfidence = 5;
    } else {
      breakdown.ocrConfidence = Math.round((input.averageOcrConfidence / 100) * 5);
      if (input.averageOcrConfidence < 70) {
        issues.push(`Low OCR confidence: ${Math.round(input.averageOcrConfidence)}%`);
      }
    }

    const score = Object.values(breakdown).reduce((a, b) => a + b, 0);

    let badge: QualityBadge;
    if (score >= 80) badge = 'Ready';
    else if (score >= 50) badge = 'Needs Review';
    else badge = 'Unsafe';

    return { score, badge, breakdown, issues };
  }

  static getBadgeColor(badge: QualityBadge): string {
    switch (badge) {
      case 'Ready': return 'bg-green-500/10 text-green-600 border-green-500/30';
      case 'Needs Review': return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30';
      case 'Unsafe': return 'bg-red-500/10 text-red-600 border-red-500/30';
    }
  }
}
