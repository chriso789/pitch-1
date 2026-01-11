/**
 * Slide Visibility Engine
 * Determines which slides/sections should be shown based on job context
 */

export interface VisibilityConditions {
  job_type?: string[];        // ["insurance", "retail"]
  roof_type?: string[];       // ["shingle", "metal", "tile"]
  is_insurance?: boolean;
  min_value?: number;
  max_value?: number;
  has_estimate?: boolean;
  custom?: Record<string, any>;
}

export interface VisibilityContext {
  jobType?: string;
  roofType?: string;
  isInsurance?: boolean;
  estimatedValue?: number;
  hasEstimate?: boolean;
  customFields?: Record<string, any>;
}

/**
 * Check if a slide or section should be visible based on conditions
 */
export function shouldShowSlide(
  conditions: VisibilityConditions | null | undefined,
  context: VisibilityContext
): boolean {
  // No conditions = always show
  if (!conditions || Object.keys(conditions).length === 0) {
    return true;
  }

  // Check job_type condition
  if (conditions.job_type && conditions.job_type.length > 0) {
    if (!context.jobType) return false;
    const normalizedJobType = context.jobType.toLowerCase();
    const matches = conditions.job_type.some(
      (type) => normalizedJobType.includes(type.toLowerCase())
    );
    if (!matches) return false;
  }

  // Check roof_type condition
  if (conditions.roof_type && conditions.roof_type.length > 0) {
    if (!context.roofType) return false;
    const normalizedRoofType = context.roofType.toLowerCase();
    const matches = conditions.roof_type.some(
      (type) => normalizedRoofType.includes(type.toLowerCase())
    );
    if (!matches) return false;
  }

  // Check is_insurance condition
  if (conditions.is_insurance !== undefined) {
    if (context.isInsurance !== conditions.is_insurance) {
      return false;
    }
  }

  // Check min_value condition
  if (conditions.min_value !== undefined) {
    if (
      context.estimatedValue === undefined ||
      context.estimatedValue < conditions.min_value
    ) {
      return false;
    }
  }

  // Check max_value condition
  if (conditions.max_value !== undefined) {
    if (
      context.estimatedValue === undefined ||
      context.estimatedValue > conditions.max_value
    ) {
      return false;
    }
  }

  // Check has_estimate condition
  if (conditions.has_estimate !== undefined) {
    if (context.hasEstimate !== conditions.has_estimate) {
      return false;
    }
  }

  // Check custom conditions
  if (conditions.custom) {
    for (const [key, expectedValue] of Object.entries(conditions.custom)) {
      const actualValue = context.customFields?.[key];
      if (actualValue !== expectedValue) {
        return false;
      }
    }
  }

  // All conditions passed
  return true;
}

/**
 * Filter slides based on visibility conditions
 */
export function filterVisibleSlides<T extends { visibility_conditions?: VisibilityConditions | null; is_enabled?: boolean }>(
  slides: T[],
  context: VisibilityContext
): T[] {
  return slides.filter((slide) => {
    // Check if slide is enabled
    if (slide.is_enabled === false) {
      return false;
    }

    // Check visibility conditions
    return shouldShowSlide(slide.visibility_conditions, context);
  });
}

/**
 * Filter sections based on visibility conditions
 */
export function filterVisibleSections<T extends { visibility_conditions?: VisibilityConditions | null; is_visible?: boolean }>(
  sections: T[],
  context: VisibilityContext
): T[] {
  return sections.filter((section) => {
    // Check if section is visible
    if (section.is_visible === false) {
      return false;
    }

    // Check visibility conditions
    return shouldShowSlide(section.visibility_conditions, context);
  });
}

/**
 * Build visibility context from job/contact data
 */
export function buildVisibilityContext(data: {
  job?: {
    job_type?: string;
    roof_type?: string;
    estimated_value?: number;
    is_insurance?: boolean;
  };
  estimate?: {
    id?: string;
    total?: number;
  };
  customFields?: Record<string, any>;
}): VisibilityContext {
  return {
    jobType: data.job?.job_type,
    roofType: data.job?.roof_type,
    isInsurance: data.job?.is_insurance ?? 
      (data.job?.job_type?.toLowerCase().includes('insurance') ?? false),
    estimatedValue: data.estimate?.total ?? data.job?.estimated_value,
    hasEstimate: !!data.estimate?.id,
    customFields: data.customFields,
  };
}
