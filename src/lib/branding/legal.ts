/**
 * PITCH CRM™ Branding and Legal Constants
 * 
 * Centralized file for consistent trademark notation and legal information
 * throughout the application.
 */

export const BRAND = {
  // Trademark names
  name: 'PITCH CRM™',
  shortName: 'PITCH™',
  namePlain: 'PITCH CRM',
  
  // Legal entity
  company: 'PITCH CRM, Inc.',
  
  // Copyright
  copyrightYear: new Date().getFullYear(),
  get copyright() {
    return `© ${this.copyrightYear} ${this.name}. All rights reserved.`;
  },
  
  // Trademark notice
  trademarkNotice: `PITCH™ and PITCH CRM™ are trademarks of PITCH CRM, Inc. This software is not affiliated with, endorsed by, or connected to any other product or service with a similar name.`,
  
  // Short trademark notice for footers
  trademarkShort: `PITCH™ and PITCH CRM™ are trademarks of PITCH CRM, Inc.`,
  
  // Taglines
  tagline: 'The AI-Powered CRM for Construction Businesses',
  taglineShort: 'Built for Construction. Powered by AI.',
  
  // Website
  website: 'https://pitch-crm.ai',
  
  // Legal page URLs
  legalUrls: {
    privacy: '/legal/privacy',
    terms: '/legal/terms',
    security: '/legal/security',
  },
  
  // Full URLs for external use (emails, PDFs)
  get fullUrls() {
    return {
      privacy: `${this.website}/legal/privacy`,
      terms: `${this.website}/legal/terms`,
      security: `${this.website}/legal/security`,
      website: this.website,
    };
  },
  
  // Contact information
  contact: {
    support: 'support@pitch-crm.ai',
    legal: 'legal@pitch-crm.ai',
    privacy: 'privacy@pitch-crm.ai',
  },
} as const;

/**
 * Generate email footer HTML with legal notices
 */
export function getEmailFooterHtml(): string {
  return `
    <div style="border-top: 1px solid #e2e8f0; padding-top: 20px; margin-top: 32px; text-align: center;">
      <p style="color: #64748b; font-size: 12px; margin: 0 0 8px 0;">
        ${BRAND.copyright}
      </p>
      <p style="color: #94a3b8; font-size: 11px; margin: 0 0 12px 0;">
        ${BRAND.trademarkShort}
      </p>
      <p style="color: #94a3b8; font-size: 11px; margin: 0;">
        <a href="${BRAND.fullUrls.privacy}" style="color: #94a3b8; text-decoration: underline;">Privacy Policy</a>
        &nbsp;•&nbsp;
        <a href="${BRAND.fullUrls.terms}" style="color: #94a3b8; text-decoration: underline;">Terms of Service</a>
        &nbsp;•&nbsp;
        <a href="${BRAND.fullUrls.security}" style="color: #94a3b8; text-decoration: underline;">Security</a>
      </p>
    </div>
  `;
}

/**
 * Generate plain text footer for emails
 */
export function getEmailFooterText(): string {
  return `
---
${BRAND.copyright}
${BRAND.trademarkShort}

Privacy Policy: ${BRAND.fullUrls.privacy}
Terms of Service: ${BRAND.fullUrls.terms}
Security: ${BRAND.fullUrls.security}
  `.trim();
}
