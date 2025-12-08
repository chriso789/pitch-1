import { ReactNode } from 'react';

interface ReportPageProps {
  pageNumber: number;
  companyInfo?: {
    name: string;
    logo?: string;
    phone?: string;
    email?: string;
    license?: string;
  };
  title?: string;
  children: ReactNode;
}

export function ReportPage({ pageNumber, companyInfo, title, children }: ReportPageProps) {
  return (
    <div 
      className="bg-white dark:bg-card rounded-lg shadow-sm border p-8 min-h-[800px] relative"
      style={{ aspectRatio: '8.5/11' }}
    >
      {/* Header */}
      {pageNumber > 1 && (
        <div className="flex items-center justify-between mb-6 pb-4 border-b">
          <div className="flex items-center gap-3">
            {companyInfo?.logo ? (
              <img src={companyInfo.logo} alt={companyInfo.name} className="h-8" />
            ) : (
              <span className="font-bold text-lg text-primary">{companyInfo?.name || 'PITCH CRM'}</span>
            )}
          </div>
          {title && (
            <h2 className="text-xl font-semibold text-primary">{title}</h2>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1">
        {children}
      </div>

      {/* Footer */}
      <div className="absolute bottom-6 left-8 right-8 flex items-center justify-between text-xs text-muted-foreground border-t pt-4">
        <span>© {new Date().getFullYear()} {companyInfo?.name || 'PITCH CRM'}</span>
        <span>Page {pageNumber}</span>
        {companyInfo?.license && <span>Lic# {companyInfo.license}</span>}
      </div>
    </div>
  );
}
