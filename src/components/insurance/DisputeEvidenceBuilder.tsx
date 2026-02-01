// ============================================================
// Dispute Evidence Builder Component
// UI for building supplement evidence packets with prior paid examples
// ============================================================

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { 
  Search, 
  Plus,
  Trash2,
  FileText,
  DollarSign,
  TrendingUp,
  Building2,
  MapPin,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Package,
  Download,
  Send
} from 'lucide-react';
import { 
  useCanonicalItems, 
  useEvidenceSearch, 
  useCreateSupplementPacket 
} from '@/hooks/useScopeIntelligence';
import { CARRIER_DISPLAY_NAMES } from '@/lib/insurance/canonicalItems';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils';

interface DisputeItem {
  id: string;
  canonical_item_id: string;
  canonical_item_name: string;
  line_item_id?: string;
  requested_amount: number;
  dispute_reason: string;
}

interface DisputeEvidenceBuilderProps {
  jobId?: string;
  insuranceClaimId?: string;
  className?: string;
  onPacketCreated?: (packetId: string) => void;
}

export const DisputeEvidenceBuilder: React.FC<DisputeEvidenceBuilderProps> = ({
  jobId,
  insuranceClaimId,
  className,
  onPacketCreated
}) => {
  const [disputeItems, setDisputeItems] = useState<DisputeItem[]>([]);
  const [selectedItemForEvidence, setSelectedItemForEvidence] = useState<string | null>(null);
  const [packetTitle, setPacketTitle] = useState('');
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [newItem, setNewItem] = useState<Partial<DisputeItem>>({});
  const [searchCarrier, setSearchCarrier] = useState<string>('');
  const [searchState, setSearchState] = useState<string>('');

  const { data: canonicalItems } = useCanonicalItems();
  const createPacket = useCreateSupplementPacket();

  // Evidence search for selected item
  const selectedCanonicalId = disputeItems.find(d => d.id === selectedItemForEvidence)?.canonical_item_id;
  const { data: evidenceResults, isLoading: evidenceLoading } = useEvidenceSearch(
    selectedCanonicalId ? {
      canonicalItemId: selectedCanonicalId,
      carrierNormalized: searchCarrier || undefined,
      stateCode: searchState || undefined,
      includeNetwork: true
    } : null
  );

  const handleAddItem = () => {
    if (!newItem.canonical_item_id || !newItem.requested_amount) return;
    
    const canonicalItem = canonicalItems?.find(c => c.id === newItem.canonical_item_id);
    
    setDisputeItems([...disputeItems, {
      id: crypto.randomUUID(),
      canonical_item_id: newItem.canonical_item_id,
      canonical_item_name: canonicalItem?.display_name || 'Unknown',
      line_item_id: newItem.line_item_id,
      requested_amount: newItem.requested_amount,
      dispute_reason: newItem.dispute_reason || 'Item not included in initial estimate'
    }]);
    
    setNewItem({});
    setIsAddingItem(false);
  };

  const handleRemoveItem = (itemId: string) => {
    setDisputeItems(disputeItems.filter(d => d.id !== itemId));
    if (selectedItemForEvidence === itemId) {
      setSelectedItemForEvidence(null);
    }
  };

  const handleCreatePacket = async () => {
    if (!packetTitle || disputeItems.length === 0) return;

    const result = await createPacket.mutateAsync({
      title: packetTitle,
      items: disputeItems.map(item => ({
        canonical_item_id: item.canonical_item_id,
        line_item_id: item.line_item_id,
        requested_amount: item.requested_amount,
        dispute_reason: item.dispute_reason
      })),
      priorExamples: evidenceResults?.internal_examples || [],
      jobId,
      insuranceClaimId
    });

    onPacketCreated?.(result.id);
    
    // Reset form
    setDisputeItems([]);
    setPacketTitle('');
    setSelectedItemForEvidence(null);
  };

  const totalRequested = disputeItems.reduce((sum, item) => sum + item.requested_amount, 0);

  return (
    <div className={cn("grid grid-cols-1 lg:grid-cols-2 gap-6", className)}>
      {/* Left Panel: Disputed Items */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Supplement Request Items
          </CardTitle>
          <CardDescription>
            Add items to dispute with supporting evidence
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Packet Title */}
          <div>
            <label className="text-sm font-medium mb-2 block">Packet Title</label>
            <Input
              placeholder="e.g., Supplement Request - Ridge Vent & Decking"
              value={packetTitle}
              onChange={(e) => setPacketTitle(e.target.value)}
            />
          </div>

          <Separator />

          {/* Dispute Items List */}
          <div className="space-y-3">
            {disputeItems.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No items added yet</p>
                <p className="text-sm">Add line items you want to dispute</p>
              </div>
            ) : (
              disputeItems.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    "p-4 border rounded-lg cursor-pointer transition-colors",
                    selectedItemForEvidence === item.id 
                      ? "border-primary bg-primary/5" 
                      : "hover:bg-muted/50"
                  )}
                  onClick={() => setSelectedItemForEvidence(item.id)}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium">{item.canonical_item_name}</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {item.dispute_reason}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-primary">
                        {formatCurrency(item.requested_amount)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveItem(item.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Add Item Button */}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setIsAddingItem(true)}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Dispute Item
          </Button>

          {/* Total */}
          {disputeItems.length > 0 && (
            <div className="flex items-center justify-between pt-4 border-t">
              <span className="font-medium">Total Requested</span>
              <span className="text-xl font-bold text-primary">
                {formatCurrency(totalRequested)}
              </span>
            </div>
          )}

          {/* Create Packet Button */}
          <Button
            className="w-full"
            disabled={!packetTitle || disputeItems.length === 0 || createPacket.isPending}
            onClick={handleCreatePacket}
          >
            {createPacket.isPending ? (
              <>Creating...</>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Create Evidence Packet
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Right Panel: Evidence Search */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Prior Paid Evidence
          </CardTitle>
          <CardDescription>
            {selectedItemForEvidence 
              ? "Search for prior paid examples to support your claim"
              : "Select an item to search for evidence"
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!selectedItemForEvidence ? (
            <div className="text-center py-12 text-muted-foreground">
              <TrendingUp className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Select a dispute item to search for evidence</p>
            </div>
          ) : (
            <>
              {/* Search Filters */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium mb-1 block">Carrier</label>
                  <Select value={searchCarrier} onValueChange={setSearchCarrier}>
                    <SelectTrigger>
                      <SelectValue placeholder="Any carrier" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Any carrier</SelectItem>
                      {Object.entries(CARRIER_DISPLAY_NAMES).map(([key, name]) => (
                        <SelectItem key={key} value={key}>{name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">State</label>
                  <Input
                    placeholder="e.g., FL"
                    value={searchState}
                    onChange={(e) => setSearchState(e.target.value.toUpperCase())}
                    maxLength={2}
                  />
                </div>
              </div>

              {/* Price Statistics */}
              {evidenceResults?.price_stats && evidenceResults.price_stats.sample_count > 0 && (
                <div className="p-4 bg-muted/50 rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium">Price Statistics</span>
                    <Badge variant="outline">
                      {evidenceResults.price_stats.sample_count} examples
                    </Badge>
                  </div>
                  <div className="grid grid-cols-4 gap-4 text-center">
                    <div>
                      <p className="text-xs text-muted-foreground">Min</p>
                      <p className="font-semibold">{formatCurrency(evidenceResults.price_stats.min)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">25th %</p>
                      <p className="font-semibold">{formatCurrency(evidenceResults.price_stats.p25)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Median</p>
                      <p className="font-semibold text-primary">{formatCurrency(evidenceResults.price_stats.median)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Max</p>
                      <p className="font-semibold">{formatCurrency(evidenceResults.price_stats.max)}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Evidence Examples */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Prior Paid Examples</h4>
                
                {evidenceLoading ? (
                  <div className="text-center py-8">
                    <Search className="h-8 w-8 animate-pulse mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Searching...</p>
                  </div>
                ) : evidenceResults?.internal_examples.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No prior examples found</p>
                    <p className="text-xs">Try adjusting filters or adding more scopes</p>
                  </div>
                ) : (
                  <div className="max-h-[400px] overflow-y-auto space-y-2">
                    {evidenceResults?.internal_examples.map((example: any, idx: number) => (
                      <div
                        key={idx}
                        className="p-3 border rounded-lg text-sm"
                      >
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <Building2 className="h-3 w-3 text-muted-foreground" />
                              <span className="font-medium">
                                {CARRIER_DISPLAY_NAMES[example.carrier_normalized] || example.carrier_normalized}
                              </span>
                            </div>
                            {example.state_code && (
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <MapPin className="h-3 w-3" />
                                <span>{example.state_code}</span>
                              </div>
                            )}
                            {example.loss_year && (
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <Calendar className="h-3 w-3" />
                                <span>{example.loss_year}</span>
                              </div>
                            )}
                          </div>
                          <div className="text-right">
                            {example.unit_price && (
                              <p className="font-semibold text-primary">
                                {formatCurrency(example.unit_price)}/unit
                              </p>
                            )}
                            {example.quantity && (
                              <p className="text-xs text-muted-foreground">
                                Qty: {example.quantity}
                              </p>
                            )}
                          </div>
                        </div>
                        {example.snippet_text && (
                          <p className="mt-2 text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                            "{example.snippet_text}"
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Add Item Dialog */}
      <Dialog open={isAddingItem} onOpenChange={setIsAddingItem}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Dispute Item</DialogTitle>
            <DialogDescription>
              Select a canonical line item and specify the requested amount
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Line Item</label>
              <Select 
                value={newItem.canonical_item_id}
                onValueChange={(v) => setNewItem({ ...newItem, canonical_item_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a line item..." />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {canonicalItems?.map(item => (
                    <SelectItem key={item.id} value={item.id!}>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {item.category}
                        </Badge>
                        {item.display_name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Requested Amount ($)</label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={newItem.requested_amount || ''}
                onChange={(e) => setNewItem({ 
                  ...newItem, 
                  requested_amount: parseFloat(e.target.value) || 0 
                })}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Dispute Reason</label>
              <Textarea
                placeholder="Why should this item be included?"
                value={newItem.dispute_reason || ''}
                onChange={(e) => setNewItem({ ...newItem, dispute_reason: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddingItem(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleAddItem}
              disabled={!newItem.canonical_item_id || !newItem.requested_amount}
            >
              Add Item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DisputeEvidenceBuilder;
