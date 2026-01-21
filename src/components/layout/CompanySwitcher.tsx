import { useState } from 'react';
import { Building2, ChevronDown, Check, Settings, Search } from 'lucide-react';
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCompanySwitcher } from '@/hooks/useCompanySwitcher';
import { useCurrentUser } from '@/hooks/useCurrentUser';

export const CompanySwitcher = () => {
  const { companies, activeCompany, loading, switchCompany } = useCompanySwitcher();
  const { user } = useCurrentUser();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  // Hide if user only has access to one company (unless master who can manage all)
  if (loading || (companies.length <= 1 && user?.role !== 'master')) {
    return null;
  }

  const filteredCompanies = companies.filter(company =>
    company.tenant_name.toLowerCase().includes(search.toLowerCase())
  );

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setSearch('');
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2 max-w-[220px]">
          <Avatar className="h-6 w-6">
            <AvatarImage src={activeCompany?.logo_url || undefined} alt={activeCompany?.tenant_name} />
            <AvatarFallback className="text-xs bg-primary text-primary-foreground">
              {activeCompany?.tenant_name ? getInitials(activeCompany.tenant_name) : <Building2 className="h-3 w-3" />}
            </AvatarFallback>
          </Avatar>
          <span className="font-medium truncate max-w-[120px]">
            {activeCompany?.tenant_name || 'Select Company'}
          </span>
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Switch Company</DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        {/* Search Input */}
        <div className="p-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search companies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9"
              autoFocus
            />
          </div>
        </div>
        
        <DropdownMenuSeparator />
        
        {/* Scrollable Company List */}
        <ScrollArea className="h-[300px]">
          {filteredCompanies.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No companies found
            </div>
          ) : (
            filteredCompanies.map((company) => {
              const isActive = company.tenant_id === activeCompany?.tenant_id;
              return (
                <DropdownMenuItem
                  key={company.tenant_id}
                  onClick={() => {
                    switchCompany(company.tenant_id);
                    setOpen(false);
                  }}
                  className={`flex items-center gap-3 cursor-pointer mx-1 ${
                    isActive ? 'bg-accent' : ''
                  }`}
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={company.logo_url || undefined} alt={company.tenant_name} />
                    <AvatarFallback className="text-xs bg-muted">
                      {getInitials(company.tenant_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{company.tenant_name}</span>
                      {company.is_primary && (
                        <Badge variant="secondary" className="text-xs shrink-0">Primary</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{company.location_count} location{company.location_count !== 1 ? 's' : ''}</span>
                      <span>•</span>
                      <span className="capitalize">{company.access_level}</span>
                    </div>
                  </div>
                  {isActive && (
                    <Check className="h-4 w-4 text-primary shrink-0" />
                  )}
                </DropdownMenuItem>
              );
            })
          )}
        </ScrollArea>
        
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
