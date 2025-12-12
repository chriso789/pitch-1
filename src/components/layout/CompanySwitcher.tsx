import { Building2, ChevronDown, Check, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { useCompanySwitcher } from '@/hooks/useCompanySwitcher';
import { useCurrentUser } from '@/hooks/useCurrentUser';

export const CompanySwitcher = () => {
  const { companies, activeCompany, loading, switchCompany } = useCompanySwitcher();
  const { user } = useCurrentUser();

  // Hide if user only has access to one company (unless master who can manage all)
  if (loading || (companies.length <= 1 && user?.role !== 'master')) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Building2 className="h-4 w-4" />
          <span className="font-medium">{activeCompany?.tenant_name || 'Select Company'}</span>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Switch Company</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {companies.map((company) => (
          <DropdownMenuItem
            key={company.tenant_id}
            onClick={() => switchCompany(company.tenant_id)}
            className="flex items-center justify-between cursor-pointer"
          >
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{company.tenant_name}</span>
                {company.is_primary && (
                  <Badge variant="secondary" className="text-xs">Primary</Badge>
                )}
                {company.tenant_id === activeCompany?.tenant_id && (
                  <Check className="h-4 w-4 text-primary" />
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{company.location_count} location{company.location_count !== 1 ? 's' : ''}</span>
                <span>•</span>
                <span className="capitalize">{company.access_level}</span>
              </div>
            </div>
          </DropdownMenuItem>
        ))}
        {user?.role === 'master' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => window.location.href = '/admin/companies'}
              className="cursor-pointer"
            >
              <Settings className="h-4 w-4 mr-2" />
              Manage All Companies
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
