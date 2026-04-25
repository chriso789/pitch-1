import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Zap, Printer, ShieldCheck } from 'lucide-react';
import { BRAND } from '@/lib/branding/legal';

interface LegalPageLayoutProps {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

export const LegalPageLayout: React.FC<LegalPageLayoutProps> = ({
  title,
  lastUpdated,
  children,
}) => {
  const navigate = useNavigate();
  const articleRef = useRef<HTMLElement>(null);
  const [toc, setToc] = useState<{ id: string; label: string }[]>([]);
  const [activeId, setActiveId] = useState<string>('');

  const handlePrint = () => window.print();

  // Build a TOC from rendered <h2> elements and assign ids
  useEffect(() => {
    if (!articleRef.current) return;
    const headings = Array.from(
      articleRef.current.querySelectorAll('h2')
    ) as HTMLHeadingElement[];

    const items = headings.map((h) => {
      const label = h.textContent || '';
      const id = h.id || slugify(label);
      h.id = id;
      return { id, label };
    });
    setToc(items);

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-96px 0px -70% 0px', threshold: 0 }
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [children]);

  const formattedDate = useMemo(() => lastUpdated, [lastUpdated]);

  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation */}
      <nav className="fixed top-0 w-full bg-background/85 backdrop-blur-md border-b border-border z-50 print:hidden">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-primary to-primary/60 rounded-lg flex items-center justify-center shadow-sm">
                <Zap className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="text-lg font-semibold text-foreground tracking-tight">
                {BRAND.shortName}
              </span>
            </Link>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handlePrint}>
                <Printer className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">Print</span>
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">Back</span>
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-24 pb-10 px-4 border-b border-border bg-gradient-to-b from-muted/40 to-background print:pt-8 print:pb-4">
        <div className="container mx-auto max-w-5xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium mb-4">
            <ShieldCheck className="w-3.5 h-3.5" />
            Legal
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-foreground tracking-tight mb-3">
            {title}
          </h1>
          <p className="text-sm text-muted-foreground">
            Last updated: <span className="text-foreground font-medium">{formattedDate}</span>
          </p>
        </div>
      </section>

      {/* Content */}
      <main className="px-4 py-12">
        <div className="container mx-auto max-w-5xl grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-10">
          {/* Sticky TOC */}
          {toc.length > 0 && (
            <aside className="hidden lg:block print:hidden">
              <div className="sticky top-24">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  On this page
                </p>
                <nav className="flex flex-col gap-1 border-l border-border">
                  {toc.map((item) => (
                    <a
                      key={item.id}
                      href={`#${item.id}`}
                      className={`pl-3 -ml-px border-l-2 py-1 text-sm transition-colors ${
                        activeId === item.id
                          ? 'border-primary text-foreground font-medium'
                          : 'border-transparent text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {item.label}
                    </a>
                  ))}
                </nav>
              </div>
            </aside>
          )}

          {/* Article */}
          <article
            ref={articleRef}
            className="
              max-w-none text-foreground leading-relaxed
              [&_section]:mb-10 [&_section]:pb-2
              [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mt-10 [&_h2]:mb-4 [&_h2]:tracking-tight [&_h2]:scroll-mt-24
              [&_section:first-child_h2]:mt-0
              [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground [&_h3]:mt-6 [&_h3]:mb-2
              [&_p]:text-[15px] [&_p]:text-muted-foreground [&_p]:mb-4 [&_p]:leading-7
              [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-4 [&_ul]:space-y-2 [&_ul]:text-muted-foreground [&_ul]:marker:text-primary/60
              [&_li]:leading-7 [&_li]:text-[15px]
              [&_li_strong]:text-foreground [&_li_strong]:font-semibold
              [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline [&_a]:font-medium
            "
          >
            {children}

            {/* Trademark notice */}
            <div className="mt-12 pt-6 border-t border-border text-xs text-muted-foreground space-y-1">
              <p>{BRAND.trademarkNotice}</p>
              <p>{BRAND.copyright}</p>
            </div>
          </article>
        </div>
      </main>

      {/* Footer Navigation */}
      <footer className="bg-muted/40 border-t border-border py-8 px-4 print:hidden">
        <div className="container mx-auto max-w-5xl">
          <div className="flex flex-wrap justify-center gap-6 text-sm">
            <Link to="/legal/privacy" className="text-muted-foreground hover:text-foreground transition-colors">
              Privacy Policy
            </Link>
            <Link to="/legal/terms" className="text-muted-foreground hover:text-foreground transition-colors">
              Terms of Service
            </Link>
            <Link to="/legal/security" className="text-muted-foreground hover:text-foreground transition-colors">
              Security Policy
            </Link>
            <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
              Home
            </Link>
          </div>
          <div className="text-center mt-4 text-muted-foreground text-xs">
            {BRAND.copyright}
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LegalPageLayout;
