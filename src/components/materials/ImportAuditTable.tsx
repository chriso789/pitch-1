import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AuditItem } from "./MaterialImportAuditDialog";

interface ImportAuditTableProps {
  items: AuditItem[];
  onToggleSelection: (code: string) => void;
}

export function ImportAuditTable({ items, onToggleSelection }: ImportAuditTableProps) {
  const formatCurrency = (value: number | null) => {
    if (value === null) return '—';
    return `$${value.toFixed(2)}`;
  };

  const formatDiff = (item: AuditItem) => {
    if (item.status === 'new') return <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">NEW</Badge>;
    if (item.priceDiff === null || item.priceDiff === 0) return <span className="text-muted-foreground">$0.00</span>;
    
    const isIncrease = item.priceDiff > 0;
    const sign = isIncrease ? '+' : '';
    
    return (
      <span className={cn(
        "font-medium",
        isIncrease ? "text-orange-600 dark:text-orange-400" : "text-blue-600 dark:text-blue-400"
      )}>
        {sign}${item.priceDiff.toFixed(2)}
      </span>
    );
  };

  const formatPct = (item: AuditItem) => {
    if (item.status === 'new' || item.priceDiffPct === null || item.priceDiffPct === 0) return null;
    
    const isIncrease = item.priceDiffPct > 0;
    const sign = isIncrease ? '+' : '';
    
    return (
      <span className={cn(
        "text-xs",
        isIncrease ? "text-orange-500" : "text-blue-500"
      )}>
        ({sign}{item.priceDiffPct.toFixed(1)}%)
      </span>
    );
  };

  const getRowClass = (item: AuditItem) => {
    switch (item.status) {
      case 'new':
        return 'bg-green-50/50 dark:bg-green-950/10 hover:bg-green-50 dark:hover:bg-green-950/20';
      case 'increase':
        return 'bg-orange-50/50 dark:bg-orange-950/10 hover:bg-orange-50 dark:hover:bg-orange-950/20';
      case 'decrease':
        return 'bg-blue-50/50 dark:bg-blue-950/10 hover:bg-blue-50 dark:hover:bg-blue-950/20';
      default:
        return '';
    }
  };

  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No items in this category
      </div>
    );
  }

  return (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[50px]">Select</TableHead>
            <TableHead className="w-[120px]">Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="w-[100px]">Category</TableHead>
            <TableHead className="w-[60px]">UOM</TableHead>
            <TableHead className="w-[100px] text-right">Current</TableHead>
            <TableHead className="w-[100px] text-right">New</TableHead>
            <TableHead className="w-[120px] text-right">Difference</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow 
              key={item.code} 
              className={cn("cursor-pointer", getRowClass(item))}
              onClick={() => onToggleSelection(item.code)}
            >
              <TableCell onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={item.selected}
                  onCheckedChange={() => onToggleSelection(item.code)}
                />
              </TableCell>
              <TableCell className="font-mono text-sm">{item.code}</TableCell>
              <TableCell>
                <div className="max-w-[250px] truncate" title={item.name}>
                  {item.name}
                </div>
              </TableCell>
              <TableCell>
                {item.category && (
                  <Badge variant="secondary" className="text-xs truncate max-w-[80px]">
                    {item.category}
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">{item.uom}</TableCell>
              <TableCell className="text-right text-muted-foreground">
                {formatCurrency(item.currentCost)}
              </TableCell>
              <TableCell className="text-right font-medium">
                {formatCurrency(item.newCost)}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  {formatDiff(item)}
                  {formatPct(item)}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
