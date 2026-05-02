/**
 * Warm Craftsman Why Choose Us
 * WARM STORYTELLING layout — earthy gradients, serif type, 2x2 promise cards.
 * Structure: earthy gradient header with narrative → stars + dynamic stats → 2x2 cards → cert bar.
 * DISTINCT from Bold-Editorial: no dark hero band, no oversized "reputation/results" heading, no testimonial pull-quote, no "SATISFACTION GUARANTEE" footer bar.
 * DISTINCT from Classic: no two-column sidebar.
 * DISTINCT from Premium-Dark: light earthy bg, serif fonts, warm tones.
 */
import React from 'react';
import { WhyChooseUsProps } from './types';
import { Shield, Award, Wrench, Clock, Star, Heart } from 'lucide-react';

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

export const WarmCraftsmanWhyChooseUs: React.FC<WhyChooseUsProps> = ({
  companyName = 'Our Team',
  licenseNumber,
  establishedYear,
  brandStory,
  brandMission,
  brandCertifications,
}) => {
  const yearsInBusiness = establishedYear ? Math.max(1, new Date().getFullYear() - establishedYear) : null;
  const heroBlurb = brandStory || `At ${companyName}, quality craftsmanship isn't just what we do — it's who we are. We treat every home like it's our own, and every customer like family.`;

  // Dynamic promises from company data
  const PROMISES: { icon: typeof Shield; title: string; body: string }[] = [];
  if (brandMission) {
    PROMISES.push({ icon: Heart, title: 'Our Promise', body: brandMission });
  }
  if (yearsInBusiness && yearsInBusiness > 3) {
    PROMISES.push({ icon: Award, title: `${yearsInBusiness} Years of Experience`, body: `We've built our reputation one project at a time over ${yearsInBusiness}+ years of serving our community.` });
  }
  if (licenseNumber) {
    PROMISES.push({ icon: Shield, title: 'Licensed Professional', body: `Fully licensed (#${licenseNumber}), bonded, and insured — your protection is non-negotiable.` });
  }
  if (brandCertifications) {
    const certs = brandCertifications.split(/[,;·•]/).map(s => s.trim()).filter(Boolean);
    PROMISES.push({ icon: Award, title: 'Certified & Qualified', body: certs.join(' · ') });
  }
  // Fill remaining slots with generic-but-unique content for this template
  const warmFallbacks = [
    { icon: Heart, title: 'Your Home, Our Priority', body: `We understand the trust you place in us when you invite us to work on your home. That responsibility drives everything we do.` },
    { icon: Clock, title: 'Clear Communication', body: `You\'ll always know what\'s happening, what\'s next, and exactly what to expect — no surprises, no guesswork.` },
    { icon: Wrench, title: 'Attention to Detail', body: `From the first measurement to the final walkthrough, every detail is planned, executed, and verified.` },
    { icon: Shield, title: 'Peace of Mind', body: `Our work is backed by comprehensive warranties so you can feel confident in your investment for years to come.` },
  ];
  while (PROMISES.length < 4) {
    const fb = warmFallbacks[PROMISES.length];
    if (fb) PROMISES.push(fb);
    else break;
  }

  const certList = brandCertifications
    ? brandCertifications.split(/[,;·•]/).map(s => s.trim()).filter(Boolean)
    : [];

  // Dynamic stats
  const stats: { value: string; label: string }[] = [];
  if (yearsInBusiness) stats.push({ value: `${yearsInBusiness}+`, label: 'Years' });
  stats.push({ value: '100%', label: 'Insured' });

  return (
    <div
      data-report-page
      className="relative overflow-hidden"
      style={{
        width: PAGE_WIDTH, minHeight: PAGE_HEIGHT, maxHeight: PAGE_HEIGHT,
        fontFamily: "'Georgia', 'Palatino', serif",
        background: 'linear-gradient(180deg, #F5F0E8 0%, #EDE6D6 100%)',
        color: '#3D3225',
      }}
    >
      <div className="px-10 pt-10 pb-7" style={{ background: 'linear-gradient(135deg, #5C4033, #3D3225)' }}>
        <div className="flex items-center gap-3 mb-4">
          <Heart className="w-4 h-4 text-[#C9956B]" />
          <div className="text-[10px] tracking-[0.4em] text-[#C9A96E] uppercase">Our Promise to You</div>
        </div>
        <h2 className="text-3xl font-bold text-[#F5F0E8] mb-4 leading-tight">
          Craftsmanship You<br />Can Count On
        </h2>
        <p className="text-sm text-[#F5F0E8]/70 max-w-[500px] leading-relaxed">{heroBlurb}</p>
      </div>
      <div className="h-[5px]" style={{ background: 'linear-gradient(90deg, #C9956B, #D4A574, #C9956B)' }} />

      {/* Stars + dynamic stats row */}
      <div className="px-10 py-5 flex items-center justify-between border-b border-[#C9956B]/15">
        <div className="flex items-center gap-1.5">
          {[0,1,2,3,4].map(i => (
            <Star key={i} className="w-4 h-4" style={{ color: '#C9956B', fill: '#C9956B' }} />
          ))}
        </div>
        <div className="flex gap-8">
          {stats.map((s, i) => (
            <div key={i} className="text-center">
              <div className="text-xl font-bold text-[#5C4033]">{s.value}</div>
              <div className="text-[8px] tracking-[0.2em] text-[#8B7D6F] uppercase">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Promises — 2x2 grid with dynamic content */}
      <div className="px-10 pt-6 grid grid-cols-2 gap-4">
        {PROMISES.slice(0, 4).map(p => {
          const Icon = p.icon;
          return (
            <div key={p.title} className="p-5 rounded-lg flex gap-4" style={{ background: 'rgba(93,64,51,0.05)', borderLeft: '3px solid #C9956B' }}>
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: '#5C4033' }}>
                <Icon className="w-5 h-5 text-[#C9956B]" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-[#3D3225] mb-1">{p.title}</h3>
                <p className="text-xs text-[#6B5D4F] leading-relaxed">{p.body}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Certifications */}
      {certList.length > 0 && (
        <div className="mx-10 mt-6 px-5 py-4 rounded-lg" style={{ background: 'rgba(201,149,107,0.1)', border: '1px solid rgba(201,149,107,0.2)' }}>
          <div className="text-[9px] tracking-[0.3em] text-[#C9956B] font-bold mb-2 uppercase">Certifications & Affiliations</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {certList.map((cert, i) => (
              <span key={i} className="text-xs text-[#6B5D4F]">• {cert}</span>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="absolute bottom-0 left-0 right-0 px-10 py-4" style={{ background: '#3D3225' }}>
        <div className="flex justify-between text-[10px] text-[#C9956B] tracking-[0.2em]">
          <span>{companyName.toUpperCase()}</span>
          {licenseNumber && <span>LIC #{licenseNumber}</span>}
        </div>
      </div>
    </div>
  );
};
