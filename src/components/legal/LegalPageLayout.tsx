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
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Navigation */}
      <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-md border-b border-slate-200 z-50 print:hidden">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                {BRAND.shortName}
              </span>
            </Link>
            <div className="flex items-center space-x-4">
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
        <div className="container mx-auto max-w-4xl">
          {/* Header */}
          <header className="mb-8 pb-6 border-b border-slate-200">
            <h1 className="text-4xl font-bold text-slate-900 mb-2">{title}</h1>
            <p className="text-slate-500">
              Last Updated: {lastUpdated}
            </p>
          </header>

          {/* Legal Content */}
          <article className="prose prose-slate prose-lg max-w-none">
            {children}
          </article>

          {/* Trademark Notice */}
          <footer className="mt-12 pt-6 border-t border-slate-200 text-sm text-slate-500">
            <p className="mb-2">{BRAND.trademarkNotice}</p>
            <p>{BRAND.copyright}</p>
          </footer>
        </div>
      </main>

      {/* Footer Navigation */}
      <footer className="bg-slate-900 text-white py-8 px-4 print:hidden">
        <div className="container mx-auto max-w-4xl">
          <div className="flex flex-wrap justify-center gap-6 text-sm">
            <Link to="/legal/privacy" className="text-slate-400 hover:text-white transition-colors">
              Privacy Policy
            </Link>
            <Link to="/legal/terms" className="text-slate-400 hover:text-white transition-colors">
              Terms of Service
            </Link>
            <Link to="/legal/security" className="text-slate-400 hover:text-white transition-colors">
              Security Policy
            </Link>
            <Link to="/" className="text-slate-400 hover:text-white transition-colors">
              Home
            </Link>
          </div>
          <div className="text-center mt-4 text-slate-500 text-xs">
            {BRAND.copyright}
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LegalPageLayout;
