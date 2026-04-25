import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Zap, Printer } from 'lucide-react';
import { BRAND } from '@/lib/branding/legal';

interface LegalPageLayoutProps {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}

export const LegalPageLayout: React.FC<LegalPageLayoutProps> = ({
  title,
  lastUpdated,
  children,
}) => {
  const navigate = useNavigate();

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="fixed top-0 w-full bg-background/80 backdrop-blur-md border-b border-border z-50 print:hidden">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-gradient-to-br from-primary to-primary/70 rounded-lg flex items-center justify-center">
                <Zap className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="text-xl font-bold text-foreground">
                {BRAND.shortName}
              </span>
            </Link>
            <div className="flex items-center space-x-2">
              <Button variant="ghost" size="sm" onClick={handlePrint}>
                <Printer className="w-4 h-4 mr-2" />
                Print
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="pt-24 pb-16 px-4">
        <div className="container mx-auto max-w-3xl">
          {/* Header */}
          <header className="mb-10 pb-6 border-b border-border">
            <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-3 tracking-tight">
              {title}
            </h1>
            <p className="text-sm text-muted-foreground">
              Last updated: {lastUpdated}
            </p>
          </header>

          {/* Legal Content */}
          <article
            className="
              max-w-none text-foreground leading-relaxed
              [&_section]:mb-10
              [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mt-10 [&_h2]:mb-4 [&_h2]:tracking-tight [&_h2]:scroll-mt-24
              [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-foreground [&_h3]:mt-6 [&_h3]:mb-3
              [&_p]:text-base [&_p]:text-muted-foreground [&_p]:mb-4 [&_p]:leading-7
              [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-4 [&_ul]:space-y-2 [&_ul]:text-muted-foreground
              [&_li]:leading-7
              [&_li_strong]:text-foreground [&_li_strong]:font-semibold
              [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline [&_a]:font-medium
            "
          >
            {children}
          </article>

          {/* Trademark Notice */}
          <footer className="mt-12 pt-6 border-t border-border text-sm text-muted-foreground space-y-2">
            <p>{BRAND.trademarkNotice}</p>
            <p>{BRAND.copyright}</p>
          </footer>
        </div>
      </main>

      {/* Footer Navigation */}
      <footer className="bg-muted/50 border-t border-border py-8 px-4 print:hidden">
        <div className="container mx-auto max-w-3xl">
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
