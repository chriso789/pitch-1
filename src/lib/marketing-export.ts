import Papa from 'papaparse';
import { BRAND } from '@/lib/branding/legal';

const SITE_URL = 'https://pitch-1.lovable.app';
const LOGO_URL = `${SITE_URL}/og-image.png`;

/**
 * Facebook Product Catalog spec fields
 */
interface CatalogItem {
  id: string;
  title: string;
  description: string;
  availability: string;
  condition: string;
  price: string;
  link: string;
  image_link: string;
  brand: string;
}

const CATALOG_ITEMS: CatalogItem[] = [
  {
    id: 'pitch-power-dialer',
    title: 'AI Power Dialer — 300 Calls/Hour',
    description: 'Triple-line power dialer with voicemail drop, call recording, AI transcription & coaching. Replaces Mojo Dialer and saves $1,788/yr.',
    availability: 'in stock',
    condition: 'new',
    price: '0 USD',
    link: `${SITE_URL}/#features`,
    image_link: LOGO_URL,
    brand: BRAND.namePlain,
  },
  {
    id: 'pitch-ai-measurements',
    title: 'AI Roof Measurements — 98%+ Accuracy',
    description: 'Satellite-powered roof measurements with facet detection, pitch analysis, and material takeoff. Replaces EagleView at a fraction of the cost.',
    availability: 'in stock',
    condition: 'new',
    price: '0 USD',
    link: `${SITE_URL}/#features`,
    image_link: LOGO_URL,
    brand: BRAND.namePlain,
  },
  {
    id: 'pitch-estimates-proposals',
    title: 'Instant Estimates & E-Sign Proposals',
    description: 'Generate Good/Better/Best proposals with e-signature in seconds. Replaces Roofr + DocuSign and saves $1,668/yr.',
    availability: 'in stock',
    condition: 'new',
    price: '0 USD',
    link: `${SITE_URL}/#features`,
    image_link: LOGO_URL,
    brand: BRAND.namePlain,
  },
  {
    id: 'pitch-crm-pipeline',
    title: 'Construction CRM & Pipeline',
    description: 'Drag-and-drop pipeline, contact management, lead scoring, and automated follow-ups built for roofers. Replaces AccuLynx + JobNimbus.',
    availability: 'in stock',
    condition: 'new',
    price: '0 USD',
    link: `${SITE_URL}/#features`,
    image_link: LOGO_URL,
    brand: BRAND.namePlain,
  },
  {
    id: 'pitch-territory-canvassing',
    title: 'Territory Mapping & Storm Canvassing',
    description: 'GPS-tracked door knocking, territory assignment, live leaderboards, and route optimization. Replaces Spotio and saves $1,500/yr.',
    availability: 'in stock',
    condition: 'new',
    price: '0 USD',
    link: `${SITE_URL}/#features`,
    image_link: LOGO_URL,
    brand: BRAND.namePlain,
  },
  {
    id: 'pitch-photo-management',
    title: 'Job Site Photo Documentation',
    description: 'GPS-stamped photos, AI categorization, annotations, before/after timelines, and PDF report generation. Replaces CompanyCam.',
    availability: 'in stock',
    condition: 'new',
    price: '0 USD',
    link: `${SITE_URL}/#features`,
    image_link: LOGO_URL,
    brand: BRAND.namePlain,
  },
  {
    id: 'pitch-scheduling-dispatch',
    title: 'Scheduling & Crew Dispatch',
    description: 'AI-powered appointment booking, crew dispatch board, calendar sync, and automated reminders for your entire team.',
    availability: 'in stock',
    condition: 'new',
    price: '0 USD',
    link: `${SITE_URL}/#features`,
    image_link: LOGO_URL,
    brand: BRAND.namePlain,
  },
  {
    id: 'pitch-financing',
    title: 'Built-In Financing Calculator',
    description: 'Present monthly payment options to homeowners instantly. Integrated financing that closes more deals on the spot.',
    availability: 'in stock',
    condition: 'new',
    price: '0 USD',
    link: `${SITE_URL}/#features`,
    image_link: LOGO_URL,
    brand: BRAND.namePlain,
  },
];

/**
 * Generate and download Facebook Product Catalog CSV
 */
export function downloadFacebookCatalogCSV(): void {
  const csv = Papa.unparse(CATALOG_ITEMS);
  downloadFile(csv, 'pitch-crm-facebook-catalog.csv', 'text/csv;charset=utf-8;');
}

/**
 * Ad copy templates for Facebook campaigns
 */
const AD_COPY_TEMPLATES = `
=============================================
  PITCH CRM — Facebook Ad Copy Templates
  Generated: ${new Date().toLocaleDateString()}
=============================================

----------------------------------------------
CAMPAIGN 1: AWARENESS — Brand Introduction
----------------------------------------------
Headline: Stop Overpaying for Roofing Software
Primary Text: PITCH CRM replaces 10+ expensive tools — AccuLynx, Mojo Dialer, CompanyCam, Spotio & more — in one AI-powered platform. Save $46,000+/year per user.
Description: The all-in-one CRM built for construction. AI measurements, power dialer, proposals, e-sign, and territory mapping.
CTA: Learn More → ${SITE_URL}

----------------------------------------------
CAMPAIGN 2: FEATURE DEMO — AI Measurements
----------------------------------------------
Headline: 98% Accurate Roof Measurements in Seconds
Primary Text: Ditch expensive EagleView reports. PITCH CRM uses satellite AI to measure any roof instantly — facets, pitch, ridges, valleys, and full material takeoff.
Description: AI-powered measurements that rival EagleView at a fraction of the cost. Try it free.
CTA: Get Started → ${SITE_URL}

----------------------------------------------
CAMPAIGN 3: TESTIMONIAL / SOCIAL PROOF
----------------------------------------------
Headline: Roofers Are Saving $3,900/Month
Primary Text: "We cancelled AccuLynx, Mojo, CompanyCam, and Spotio — PITCH CRM does it all." Join hundreds of contractors who switched to the smarter CRM.
Description: One platform. Every tool you need. No more juggling 10 subscriptions.
CTA: See Why They Switched → ${SITE_URL}

----------------------------------------------
CAMPAIGN 4: COST SAVINGS — ROI Focus
----------------------------------------------
Headline: Save $46,000/Year on Software
Primary Text: You're paying $3,900/mo for tools that PITCH CRM replaces for a fraction of the price. Power dialer, estimates, proposals, e-sign, photos, territories — all included.
Description: Calculate your savings. Most contractors save 85-90% vs. their current stack.
CTA: Calculate Savings → ${SITE_URL}/pricing

----------------------------------------------
CAMPAIGN 5: FREE TRIAL / LEAD GEN
----------------------------------------------
Headline: Try the #1 AI Roofing CRM Free
Primary Text: Get instant roof measurements, power dialer, proposals with e-sign, and territory mapping — no credit card required. Set up in 15 minutes.
Description: Free trial includes all features. Built for roofers, by roofers.
CTA: Start Free Trial → ${SITE_URL}

=============================================
  ${BRAND.copyright}
  ${BRAND.trademarkShort}
=============================================
`.trim();

/**
 * Download ad copy text file
 */
export function downloadAdCopyPack(): void {
  downloadFile(AD_COPY_TEMPLATES, 'pitch-crm-facebook-ad-copy.txt', 'text/plain;charset=utf-8;');
}

/**
 * Brand guidelines summary as downloadable text
 */
const BRAND_GUIDELINES = `
=============================================
  ${BRAND.namePlain} — Brand Guidelines
=============================================

BRAND NAME
  Full: ${BRAND.name}
  Short: ${BRAND.shortName}
  Legal entity: ${BRAND.company}

TAGLINE
  Primary: ${BRAND.tagline}
  Short: ${BRAND.taglineShort}

COLORS (HSL)
  Primary Blue: hsl(217, 91%, 60%)
  Primary Dark: hsl(217, 91%, 45%)
  Accent Orange: hsl(25, 95%, 53%)
  Background: hsl(222, 47%, 11%)
  Surface: hsl(217, 33%, 17%)
  Text Primary: hsl(210, 40%, 98%)
  Text Muted: hsl(215, 20%, 65%)

TYPOGRAPHY
  Display / Headlines: Inter (700, 800)
  Body: Inter (400, 500)
  Monospace: JetBrains Mono

LOGO USAGE
  • Always use the full "PITCH CRM" logotype on dark backgrounds
  • Maintain clear space equal to the height of the "P" around the logo
  • Do not stretch, rotate, or alter the logo colors
  • Minimum size: 120px wide for digital, 1" for print

TONE OF VOICE
  • Professional but approachable
  • Data-driven — always cite savings and accuracy numbers
  • Construction-industry aware — use familiar terminology
  • Confident, not aggressive

WEBSITE
  ${BRAND.website}

LEGAL
  ${BRAND.trademarkNotice}
  ${BRAND.copyright}
`.trim();

export function downloadBrandGuidelines(): void {
  downloadFile(BRAND_GUIDELINES, 'pitch-crm-brand-guidelines.txt', 'text/plain;charset=utf-8;');
}

/**
 * Helper to trigger browser download
 */
function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
