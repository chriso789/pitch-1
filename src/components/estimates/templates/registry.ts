/**
 * Template Registry — maps ProposalTemplateStyle to concrete page components.
 */
import React from 'react';
import { type ProposalTemplateStyle, type CoverPageProps, type WhyChooseUsProps, type ProcessTimelineProps } from './types';

// Bold Editorial (current/default)
import { EstimateCoverPage } from '../EstimateCoverPage';
import { WhyChooseUsPage } from '../WhyChooseUsPage';
import { ProcessTimelinePage } from '../ProcessTimelinePage';

// Classic Professional
import { ClassicCoverPage } from './ClassicCoverPage';
import { ClassicWhyChooseUs } from './ClassicWhyChooseUs';
import { ClassicProcessTimeline } from './ClassicProcessTimeline';

// Modern Minimal
import { ModernMinimalCoverPage } from './ModernMinimalCoverPage';
import { ModernMinimalWhyChooseUs } from './ModernMinimalWhyChooseUs';
import { ModernMinimalProcessTimeline } from './ModernMinimalProcessTimeline';

// Warm Craftsman
import { WarmCraftsmanCoverPage } from './WarmCraftsmanCoverPage';
import { WarmCraftsmanWhyChooseUs } from './WarmCraftsmanWhyChooseUs';
import { WarmCraftsmanProcessTimeline } from './WarmCraftsmanProcessTimeline';

// Premium Dark
import { PremiumDarkCoverPage } from './PremiumDarkCoverPage';
import { PremiumDarkWhyChooseUs } from './PremiumDarkWhyChooseUs';
import { PremiumDarkProcessTimeline } from './PremiumDarkProcessTimeline';

export interface TemplateComponents {
  CoverPage: React.FC<CoverPageProps>;
  WhyChooseUs: React.FC<WhyChooseUsProps>;
  ProcessTimeline: React.FC<ProcessTimelineProps>;
}

const REGISTRY: Record<ProposalTemplateStyle, TemplateComponents> = {
  'bold-editorial': {
    CoverPage: EstimateCoverPage,
    WhyChooseUs: WhyChooseUsPage,
    ProcessTimeline: ProcessTimelinePage as React.FC<ProcessTimelineProps>,
  },
  'classic-professional': {
    CoverPage: ClassicCoverPage,
    WhyChooseUs: ClassicWhyChooseUs,
    ProcessTimeline: ClassicProcessTimeline,
  },
  'modern-minimal': {
    CoverPage: ModernMinimalCoverPage,
    WhyChooseUs: ModernMinimalWhyChooseUs,
    ProcessTimeline: ModernMinimalProcessTimeline,
  },
  'warm-craftsman': {
    CoverPage: WarmCraftsmanCoverPage,
    WhyChooseUs: WarmCraftsmanWhyChooseUs,
    ProcessTimeline: WarmCraftsmanProcessTimeline,
  },
  'premium-dark': {
    CoverPage: PremiumDarkCoverPage,
    WhyChooseUs: PremiumDarkWhyChooseUs,
    ProcessTimeline: PremiumDarkProcessTimeline,
  },
};

export function getTemplateComponents(style?: string | null): TemplateComponents {
  const key = (style || 'bold-editorial') as ProposalTemplateStyle;
  return REGISTRY[key] || REGISTRY['bold-editorial'];
}
