import { Link } from "react-router-dom";
import { SEO } from "@/components/seo/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, X, ArrowRight } from "lucide-react";

const PATH = "/blog/pitch-vs-acculynx";

const compareRows: Array<{ feature: string; pitch: string | true; acculynx: string | true | false }> = [
  { feature: "Starting price per user / month", pitch: "From ~$49", acculynx: "$273+" },
  { feature: "AI aerial roof measurements included", pitch: true, acculynx: "Add-on / EagleView $25–50 per report" },
  { feature: "Built-in power dialer (triple-line)", pitch: true, acculynx: false },
  { feature: "Field canvassing + territory mapping", pitch: true, acculynx: "Limited" },
  { feature: "Photo management with GPS + annotations", pitch: true, acculynx: "CompanyCam integration ($49/user)" },
  { feature: "E-signatures + proposals", pitch: true, acculynx: "DocuSign add-on ($40/user)" },
  { feature: "QuickBooks Online sync (production)", pitch: true, acculynx: true },
  { feature: "SRS / ABC Supply / QXO material ordering", pitch: true, acculynx: "Partial" },
  { feature: "Homeowner + crew portals", pitch: true, acculynx: "Homeowner only" },
  { feature: "Setup + onboarding cost", pitch: "Included", acculynx: "$500–$2,500" },
];

const savingsRows = [
  { tool: "AccuLynx", cost: 273 },
  { tool: "CompanyCam", cost: 49 },
  { tool: "Mojo Dialer", cost: 149 },
  { tool: "Roofr proposals", cost: 99 },
  { tool: "DocuSign", cost: 40 },
  { tool: "Spotio territory", cost: 125 },
  { tool: "EagleView (avg. 4 reports/mo)", cost: 150 },
];
const stackTotal = savingsRows.reduce((s, r) => s + r.cost, 0);
const pitchMonthly = 149; // representative bundled seat
const monthlySavings = stackTotal - pitchMonthly;
const annualSavings = monthlySavings * 12;

const Cell = ({ v }: { v: string | boolean }) => {
  if (v === true) return <Check className="h-5 w-5 text-primary" aria-label="Included" />;
  if (v === false) return <X className="h-5 w-5 text-muted-foreground" aria-label="Not included" />;
  return <span className="text-sm">{v}</span>;
};

export default function PitchVsAcculynx() {
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "Pitch CRM vs AccuLynx: The 2026 Roofing CRM Comparison",
      description:
        "Side-by-side comparison of Pitch CRM and AccuLynx for roofing contractors — pricing, AI measurements, dialer, proposals, and total cost of ownership.",
      author: { "@type": "Organization", name: "Pitch CRM" },
      datePublished: "2026-07-23",
      mainEntityOfPage: `https://pitch-crm.ai${PATH}`,
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "Is Pitch CRM a real AccuLynx alternative for roofing companies?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes. Pitch CRM covers the same core roofing workflows — pipeline, estimates, production, invoicing, and QuickBooks sync — and adds AI aerial measurements, a triple-line power dialer, and field canvassing that AccuLynx sells as separate add-ons or doesn't offer.",
          },
        },
        {
          "@type": "Question",
          name: "How much can a roofing contractor save by replacing AccuLynx with Pitch CRM?",
          acceptedAnswer: {
            "@type": "Answer",
            text: `Contractors replacing AccuLynx plus the typical add-on stack (CompanyCam, a dialer, DocuSign, EagleView, Spotio) save roughly $${monthlySavings.toLocaleString()} per user each month — about $${annualSavings.toLocaleString()} per user per year.`,
          },
        },
        {
          "@type": "Question",
          name: "Does Pitch CRM include AI roof measurements?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes. Pitch CRM includes AI aerial measurements with pitch, area, and material takeoffs so you don't pay $25–$50 per EagleView report.",
          },
        },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Pitch CRM vs AccuLynx: 2026 Roofing CRM Comparison"
        description="AccuLynx vs Pitch CRM — compare pricing, AI roof measurements, dialer, proposals, and see how roofing contractors save $40k+/user per year."
        path={PATH}
        ogType="article"
        jsonLd={jsonLd}
      />

      <article className="max-w-4xl mx-auto px-6 py-16">
        <nav className="text-sm text-muted-foreground mb-6">
          <Link to="/" className="hover:text-foreground">Home</Link>
          <span className="mx-2">/</span>
          <span>Blog</span>
          <span className="mx-2">/</span>
          <span>Pitch CRM vs AccuLynx</span>
        </nav>

        <header className="mb-10">
          <p className="text-sm font-medium text-primary mb-3">Roofing CRM Comparison · Updated July 2026</p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            Pitch CRM vs AccuLynx: the AI-powered roofing CRM alternative
          </h1>
          <p className="text-lg text-muted-foreground">
            AccuLynx has been the default roofing CRM for years — but at $273+ per user and a stack
            of paid add-ons for measurements, dialing, proposals, and e-signatures, contractors are
            paying <strong>${stackTotal}/user/month</strong> before a single shingle is sold. Here's
            how Pitch CRM stacks up as an all-in-one, AI-first replacement.
          </p>
        </header>

        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">The quick answer</h2>
          <Card>
            <CardContent className="pt-6 space-y-3 text-base">
              <p>
                <strong>Pitch CRM</strong> replaces AccuLynx <em>plus</em> the roofing tool stack
                most crews layer on top of it (CompanyCam, Mojo Dialer, DocuSign, EagleView,
                Spotio). Roofing contractors switching from that stack save roughly{" "}
                <strong>${monthlySavings.toLocaleString()}/user/month</strong> — about{" "}
                <strong>${annualSavings.toLocaleString()}/user/year</strong> — and consolidate
                everything into one AI-powered platform.
              </p>
              <p>
                Choose <strong>AccuLynx</strong> if you need decades-old enterprise workflow rigidity
                and are already paying for the full add-on stack. Choose{" "}
                <strong>Pitch CRM</strong> if you want AI measurements, a power dialer, proposals,
                canvassing, and QuickBooks sync in a single seat.
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">Feature-by-feature comparison</h2>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-4 font-semibold">Feature</th>
                  <th className="p-4 font-semibold">Pitch CRM</th>
                  <th className="p-4 font-semibold">AccuLynx</th>
                </tr>
              </thead>
              <tbody>
                {compareRows.map((r) => (
                  <tr key={r.feature} className="border-t">
                    <td className="p-4 font-medium">{r.feature}</td>
                    <td className="p-4"><Cell v={r.pitch} /></td>
                    <td className="p-4"><Cell v={r.acculynx as string | boolean} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">The real cost of an AccuLynx-based stack</h2>
          <p className="text-muted-foreground mb-6">
            AccuLynx by itself doesn't cover measurements, dialing, proposals, e-sign, or
            canvassing. Here's what most roofing contractors actually pay per rep, per month:
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-4 font-semibold">Tool</th>
                  <th className="p-4 font-semibold text-right">Monthly cost / user</th>
                </tr>
              </thead>
              <tbody>
                {savingsRows.map((r) => (
                  <tr key={r.tool} className="border-t">
                    <td className="p-4">{r.tool}</td>
                    <td className="p-4 text-right font-mono">${r.cost}</td>
                  </tr>
                ))}
                <tr className="border-t bg-muted/30">
                  <td className="p-4 font-semibold">Total stack cost</td>
                  <td className="p-4 text-right font-mono font-semibold">${stackTotal}</td>
                </tr>
                <tr className="border-t">
                  <td className="p-4 font-semibold text-primary">Pitch CRM (all-in-one)</td>
                  <td className="p-4 text-right font-mono font-semibold text-primary">${pitchMonthly}</td>
                </tr>
                <tr className="border-t bg-primary/5">
                  <td className="p-4 font-bold">You save</td>
                  <td className="p-4 text-right font-mono font-bold">
                    ${monthlySavings.toLocaleString()}/mo · ${annualSavings.toLocaleString()}/yr per user
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-12 space-y-8">
          <div>
            <h2 className="text-2xl font-semibold mb-3">Where Pitch CRM wins</h2>
            <ul className="space-y-2 text-base">
              <li className="flex gap-3"><Check className="h-5 w-5 text-primary shrink-0 mt-1" /><span><strong>AI roof measurements built in</strong> — pitch, area, ridges, hips, and valleys from aerial imagery without paying per report.</span></li>
              <li className="flex gap-3"><Check className="h-5 w-5 text-primary shrink-0 mt-1" /><span><strong>Triple-line power dialer</strong> with AI transcription, sentiment, and auto-drop voicemail — no Mojo subscription.</span></li>
              <li className="flex gap-3"><Check className="h-5 w-5 text-primary shrink-0 mt-1" /><span><strong>Live GPS canvassing + territory alerts</strong> designed specifically for storm and retail roofing.</span></li>
              <li className="flex gap-3"><Check className="h-5 w-5 text-primary shrink-0 mt-1" /><span><strong>Native e-signatures</strong> on branded quotes with real-time open + sign notifications.</span></li>
              <li className="flex gap-3"><Check className="h-5 w-5 text-primary shrink-0 mt-1" /><span><strong>Direct supplier integrations</strong> — ABC Supply, SRS Distribution, and QXO with contract pricing and PO creation.</span></li>
            </ul>
          </div>

          <div>
            <h2 className="text-2xl font-semibold mb-3">Where AccuLynx still fits</h2>
            <ul className="space-y-2 text-base text-muted-foreground">
              <li className="flex gap-3"><Check className="h-5 w-5 shrink-0 mt-1" /><span>Very large operations already deeply invested in AccuLynx's workflow and supplement management.</span></li>
              <li className="flex gap-3"><Check className="h-5 w-5 shrink-0 mt-1" /><span>Teams that don't need AI measurements, dialing, or canvassing and prefer separate best-of-breed tools.</span></li>
            </ul>
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4">FAQ</h2>
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold mb-1">Is Pitch CRM a real AccuLynx alternative?</h3>
              <p className="text-muted-foreground">Yes — Pitch CRM covers the same core roofing workflows (pipeline, estimates, production, invoicing, QuickBooks sync) and bundles AI measurements, a dialer, and canvassing that AccuLynx charges extra for or doesn't offer.</p>
            </div>
            <div>
              <h3 className="font-semibold mb-1">How much can I save switching from AccuLynx?</h3>
              <p className="text-muted-foreground">Contractors replacing AccuLynx and its typical add-on stack save roughly ${monthlySavings.toLocaleString()}/user/month, or ${annualSavings.toLocaleString()}/user/year.</p>
            </div>
            <div>
              <h3 className="font-semibold mb-1">Does Pitch CRM include AI roof measurements?</h3>
              <p className="text-muted-foreground">Yes. AI aerial measurements with material takeoffs are included — no EagleView fees at $25–$50 per report.</p>
            </div>
            <div>
              <h3 className="font-semibold mb-1">Can I import my existing AccuLynx data?</h3>
              <p className="text-muted-foreground">Yes — contacts, jobs, pipeline history, and documents import through our onboarding team at no extra cost.</p>
            </div>
          </div>
        </section>

        <Card className="bg-primary/5 border-primary/20">
          <CardHeader>
            <CardTitle className="text-2xl">See Pitch CRM on your own pipeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>Get a 20-minute walkthrough on your data. No pressure, no rip-and-replace required to try it.</p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/demo-request">Book a demo <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/pricing">See pricing</Link>
              </Button>
              <Button asChild variant="ghost" size="lg">
                <Link to="/features">All features</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </article>
    </div>
  );
}
