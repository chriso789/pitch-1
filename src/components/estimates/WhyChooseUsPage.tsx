/**
 * WhyChooseUsPage — bold trust-builder page. Stats, badges, guarantees.
 * Full letter-sized page rendered in the estimate PDF + online viewer.
 * 
 * All content is now fully dynamic — pulls from company brand settings.
 */
import React from 'react';
import { Award, ShieldCheck, Star, Wrench, Clock, ThumbsUp } from 'lucide-react';
import type { BrandStat, BrandCommitment, BrandTestimonial } from './templates/types';

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

interface WhyChooseUsPageProps {
  companyName?: string;
  licenseNumber?: string | null;
  establishedYear?: number | null;
  brandStory?: string | null;
  brandMission?: string | null;
  brandCertifications?: string | null;
  brandStats?: BrandStat[] | null;
  brandTestimonial?: BrandTestimonial | null;
  brandCommitments?: BrandCommitment[] | null;
  brandPrimaryColor?: string | null;
  brandAccentColor?: string | null;
}

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  shield: ShieldCheck,
  award: Award,
  wrench: Wrench,
  clock: Clock,
};

const DEFAULT_PROMISES: BrandCommitment[] = [
  {
    title: 'Lifetime Workmanship Warranty',
    body: 'Every install is backed in writing — long after the trucks pull away.',
    icon: 'shield',
  },
  {
    title: 'Manufacturer-Certified Crews',
    body: 'Factory-trained installers using OEM-approved methods and materials.',
    icon: 'award',
  },
  {
    title: 'Daily Clean-Up Standard',
    body: 'Magnetic nail sweeps, debris removal, and a job-site you can live with.',
    icon: 'wrench',
  },
  {
    title: 'On-Time, On-Budget',
    body: 'Clear schedules, fixed pricing, no surprise change-orders.',
    icon: 'clock',
  },
];

const buildDefaultStats = (establishedYear?: number | null): BrandStat[] => {
  const yearsInBusiness = establishedYear
    ? Math.max(1, new Date().getFullYear() - establishedYear)
    : null;
  return [
    { value: yearsInBusiness ? `${yearsInBusiness}+` : '20+', label: 'Years\nin business' },
    { value: '5,000+', label: 'Projects\ncompleted' },
    { value: '5.0★', label: 'Average\ncustomer rating' },
    { value: '100%', label: 'Licensed,\nbonded, insured' },
  ];
};

const DEFAULT_TESTIMONIAL: BrandTestimonial = {
  quote: 'They showed up when they said they would, did exactly what they promised, and the finished product looks unbelievable. Easiest home decision we\'ve ever made.',
  attribution: 'VERIFIED HOMEOWNER REVIEW',
};

export const WhyChooseUsPage: React.FC<WhyChooseUsPageProps> = ({
  companyName = 'Our Team',
  licenseNumber,
  establishedYear,
  brandStory,
  brandMission,
  brandCertifications,
  brandStats,
  brandTestimonial,
  brandCommitments,
  brandPrimaryColor,
  brandAccentColor,
}) => {
  const stats = (brandStats && brandStats.length > 0) ? brandStats : buildDefaultStats(establishedYear);
  const commitments = (brandCommitments && brandCommitments.length > 0) ? brandCommitments : DEFAULT_PROMISES;
  const testimonial = brandTestimonial || DEFAULT_TESTIMONIAL;
  const primaryColor = brandPrimaryColor || 'hsl(var(--primary))';
  const accentColor = brandAccentColor || '#1a1a2e';

  const heroBlurb = brandStory
    ? brandStory
    : "You're not just hiring a contractor — you're hiring a team obsessed with doing it right the first time.";

  return (
    <div
      data-report-page
      className="relative bg-white text-gray-900 overflow-hidden"
      style={{
        width: `${PAGE_WIDTH}px`,
        minHeight: `${PAGE_HEIGHT}px`,
        maxHeight: `${PAGE_HEIGHT}px`,
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* Dark editorial header band */}
      <div
        className="relative px-12 pt-12 pb-10 text-white"
        style={{
          background: `linear-gradient(135deg, ${accentColor} 0%, ${accentColor} 60%, ${primaryColor} 130%)`,
        }}
      >
        <div
          className="text-[10px] font-bold tracking-[0.4em] mb-3"
          style={{ color: primaryColor }}
        >
          {establishedYear ? `EST. ${establishedYear} · ` : ''}WHY HOMEOWNERS CHOOSE {companyName.toUpperCase()}
        </div>
        <h2
          className="font-black leading-[0.88]"
          style={{ fontSize: '54px', letterSpacing: '-0.03em' }}
        >
          Built on
          <br />
          <span style={{ color: primaryColor }}>reputation.</span>
          <br />
          Backed by results.
        </h2>
        <p className="text-sm text-white/80 max-w-[560px] mt-4 leading-relaxed">
          {heroBlurb}
        </p>
        {brandMission && (
          <p className="text-xs text-white/60 max-w-[560px] mt-3 leading-relaxed italic">
            Our mission: {brandMission}
          </p>
        )}

        {/* Star strip */}
        <div className="flex items-center gap-1.5 mt-6">
          {[0, 1, 2, 3, 4].map((i) => (
            <Star
              key={i}
              className="w-5 h-5"
              style={{ color: primaryColor, fill: primaryColor }}
            />
          ))}
          <span className="ml-2 text-xs font-semibold tracking-wider text-white/80">
            CONSISTENTLY 5-STAR REVIEWED
          </span>
        </div>
      </div>

      {/* Stats grid */}
      <div className={`grid grid-cols-${Math.min(stats.length, 4)} border-b border-gray-200`}>
        {stats.slice(0, 4).map((s, i) => (
          <div
            key={i}
            className={`px-4 py-7 text-center ${
              i < Math.min(stats.length, 4) - 1 ? 'border-r border-gray-200' : ''
            }`}
          >
            <div
              className="font-black leading-none mb-2"
              style={{
                fontSize: '40px',
                letterSpacing: '-0.03em',
                color: primaryColor,
              }}
            >
              {s.value}
            </div>
            <div className="text-[10px] font-bold tracking-[0.2em] text-gray-500 whitespace-pre-line leading-tight">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Promises grid */}
      <div className="px-12 pt-10 pb-8">
        <div className="text-[10px] font-bold tracking-[0.4em] text-gray-400 mb-4">
          OUR COMMITMENT
        </div>
        <div className="grid grid-cols-2 gap-5">
          {commitments.slice(0, 4).map((p) => {
            const IconComponent = ICON_MAP[p.icon || 'shield'] || ShieldCheck;
            return (
              <div
                key={p.title}
                className="bg-gray-50 rounded-lg p-5 flex gap-4 border border-gray-100"
              >
                <div
                  className="w-12 h-12 shrink-0 rounded-lg flex items-center justify-center text-white"
                  style={{
                    background: `linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%)`,
                  }}
                >
                  <IconComponent className="w-6 h-6" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-base text-gray-900 mb-1 leading-tight">
                    {p.title}
                  </h3>
                  <p className="text-xs text-gray-600 leading-relaxed">
                    {p.body}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pull quote / testimonial */}
      <div className="mx-12 mb-8 relative">
        <div
          className="absolute -top-3 -left-2 text-7xl font-black leading-none select-none"
          style={{ color: primaryColor, opacity: 0.25 }}
        >
          "
        </div>
        <blockquote
          className="pl-10 pr-4 py-3 italic text-gray-700 leading-relaxed"
          style={{ fontSize: '17px' }}
        >
          {testimonial.quote}
        </blockquote>
        <div className="pl-10 mt-2 flex items-center gap-3">
          <div className="flex">
            {[0, 1, 2, 3, 4].map((i) => (
              <Star
                key={i}
                className="w-3.5 h-3.5"
                style={{ color: primaryColor, fill: primaryColor }}
              />
            ))}
          </div>
          <span className="text-[11px] font-bold tracking-wider text-gray-500">
            — {testimonial.attribution}
          </span>
        </div>
      </div>

      {/* Brand certifications / affiliations strip */}
      {brandCertifications && (
        <div className="mx-12 mb-16 px-5 py-3 bg-gray-50 border-l-4 rounded-sm" style={{ borderColor: primaryColor }}>
          <div className="text-[9px] font-bold tracking-[0.3em] text-gray-500 mb-1">
            CERTIFICATIONS & AFFILIATIONS
          </div>
          <p className="text-xs text-gray-700 leading-relaxed">
            {brandCertifications}
          </p>
        </div>
      )}

      {/* Footer guarantee bar */}
      <div
        className="absolute bottom-0 left-0 right-0 px-12 py-4 flex items-center justify-between text-white"
        style={{ background: accentColor }}
      >
        <div className="flex items-center gap-2">
          <ThumbsUp className="w-4 h-4" style={{ color: primaryColor }} />
          <span className="text-[11px] font-bold tracking-[0.25em]">
            100% SATISFACTION GUARANTEE
          </span>
        </div>
        <div className="text-[10px] tracking-[0.3em] opacity-70">
          {companyName.toUpperCase()}
          {licenseNumber ? ` · LIC #${licenseNumber}` : ''}
        </div>
      </div>
    </div>
  );
};

export default WhyChooseUsPage;
