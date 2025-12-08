import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, Eye } from 'lucide-react';
import { formatCurrency, formatPercent } from '@/lib/commission-calculator';
import { format } from 'date-fns';

interface CommissionEarning {
  id: string;
  job_number: string | null;
  customer_name: string | null;
  job_address: string | null;
  closed_date: string | null;
  contract_value: number;
  actual_material_cost: number;
  actual_labor_cost: number;
  total_adjustments: number;
  gross_profit: number;
  rep_overhead_rate: number;
  rep_overhead_amount: number;
  net_profit: number;
  commission_type: string;
  commission_rate: number;
  commission_amount: number;
  status: string;
  profiles?: { first_name: string; last_name: string } | null;
}

interface CommissionReportTableProps {
  earnings: CommissionEarning[];
  showRep?: boolean;
  onViewDetails?: (earning: CommissionEarning) => void;
}

export function CommissionReportTable({
  earnings,
  showRep = false,
  onViewDetails,
}: CommissionReportTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid':
        return <Badge className="bg-green-500">Paid</Badge>;
      case 'approved':
        return <Badge className="bg-blue-500">Approved</Badge>;
      default:
        return <Badge variant="outline">Pending</Badge>;
    }
  };

  const getCommissionTypeBadge = (type: string) => {
    if (type === 'percentage_selling_price') {
      return <Badge variant="secondary">Selling Price</Badge>;
    }
    return <Badge variant="secondary">Profit Split</Badge>;
  };

  if (earnings.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No commission records found for the selected period
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10"></TableHead>
            <TableHead>Job</TableHead>
            {showRep && <TableHead>Rep</TableHead>}
            <TableHead>Closed</TableHead>
            <TableHead className="text-right">Contract</TableHead>
            <TableHead className="text-right">Gross Profit</TableHead>
            <TableHead className="text-right">Net Profit</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead className="text-right">Commission</TableHead>
            <TableHead>Status</TableHead>
            {onViewDetails && <TableHead className="w-10"></TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {earnings.map((earning) => {
            const isExpanded = expandedRows.has(earning.id);
            return (
              <Collapsible key={earning.id} asChild open={isExpanded}>
                <>
                  <TableRow className="cursor-pointer hover:bg-muted/50">
                    <TableCell>
                      <CollapsibleTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => toggleRow(earning.id)}
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>
                      </CollapsibleTrigger>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">
                        {earning.job_number || 'N/A'}
                      </div>
                      <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                        {earning.customer_name || earning.job_address}
                      </div>
                    </TableCell>
                    {showRep && (
                      <TableCell>
                        {earning.profiles
                          ? `${earning.profiles.first_name} ${earning.profiles.last_name}`
                          : 'N/A'}
                      </TableCell>
                    )}
                    <TableCell>
                      {earning.closed_date
                        ? format(new Date(earning.closed_date), 'MM/dd/yyyy')
                        : 'N/A'}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(Number(earning.contract_value))}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(Number(earning.gross_profit))}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(Number(earning.net_profit))}
                    </TableCell>
                    <TableCell>
                      {getCommissionTypeBadge(earning.commission_type)}
                    </TableCell>
                    <TableCell className="text-right font-bold text-green-600">
                      {formatCurrency(Number(earning.commission_amount))}
                    </TableCell>
                    <TableCell>{getStatusBadge(earning.status)}</TableCell>
                    {onViewDetails && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => onViewDetails(earning)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>

                  <CollapsibleContent asChild>
                    <TableRow className="bg-muted/30">
                      <TableCell colSpan={showRep ? 11 : 10} className="p-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Materials:</span>
                            <div className="font-medium">
                              {formatCurrency(Number(earning.actual_material_cost))}
                            </div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Labor:</span>
                            <div className="font-medium">
                              {formatCurrency(Number(earning.actual_labor_cost))}
                            </div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Adjustments:</span>
                            <div
                              className={`font-medium ${
                                Number(earning.total_adjustments) >= 0
                                  ? 'text-green-600'
                                  : 'text-red-600'
                              }`}
                            >
                              {formatCurrency(Number(earning.total_adjustments))}
                            </div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Rep Overhead:</span>
                            <div className="font-medium">
                              {formatPercent(Number(earning.rep_overhead_rate))} (
                              {formatCurrency(Number(earning.rep_overhead_amount))})
                            </div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Commission Rate:</span>
                            <div className="font-medium">
                              {formatPercent(Number(earning.commission_rate))}
                            </div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Address:</span>
                            <div className="font-medium truncate">
                              {earning.job_address || 'N/A'}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  </CollapsibleContent>
                </>
              </Collapsible>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
