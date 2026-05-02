/**
 * Proposal Template Style types.
 * Each tenant selects a style; the PDF engine renders matching variants.
 */

export type ProposalTemplateStyle =
  | 'bold-editorial'       // Current: magazine-style, oversized type, dark/primary
  | 'classic-professional'  // Traditional: clean lines, serif accents, navy/gold
  | 'modern-minimal'        // Whitespace-heavy, thin fonts, accent line only
  | 'warm-craftsman'        // Earthy tones, textured feel, handcraft vibe
  | 'premium-dark'          // Full dark theme, luxury feel, metallic accents

export interface TemplatePageProps {
  companyInfo?: {
    name: string;
    logo_url?: string | null;
    phone?: string | null;
    email?: string | null;
    address_street?: string | null;
    address_city?: string | null;
    address_state?: string | null;
    address_zip?: string | null;
    license_number?: string | null;
    established_year?: number | null;
    brand_story?: string | null;
    brand_mission?: string | null;
    brand_certifications?: string | null;
    primary_color?: string | null;
    secondary_color?: string | null;
  };
  companyLogo?: string;
  companyName: string;
}

export interface CoverPageProps extends TemplatePageProps {
  customerName: string;
  customerAddress: string;
  estimateNumber: string;
  createdAt?: string;
  propertyPhoto?: string;
  estimateName?: string;
}

export interface WhyChooseUsProps extends TemplatePageProps {
  licenseNumber?: string | null;
  establishedYear?: number | null;
  brandStory?: string | null;
  brandMission?: string | null;
  brandCertifications?: string | null;
}

export const TEMPLATE_META: Record<ProposalTemplateStyle, { label: string; description: string }> = {
  'bold-editorial': {
    label: 'Bold Editorial',
    description: 'Magazine-style cover with oversized typography and full-bleed photos',
  },
  'classic-professional': {
    label: 'Classic Professional',
    description: 'Traditional layout with clean lines, navy tones, and gold accents',
  },
  'modern-minimal': {
    label: 'Modern Minimal',
    description: 'Whitespace-heavy design with thin fonts and subtle accent lines',
  },
  'warm-craftsman': {
    label: 'Warm Craftsman',
    description: 'Earthy tones with a textured, handcraft feel',
  },
  'premium-dark': {
    label: 'Premium Dark',
    description: 'Full dark theme with a luxury feel and metallic accents',
  },
};
