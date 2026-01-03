import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  FileText, 
  Plus, 
  Trash2, 
  Download,
  Sparkles,
  CheckCircle,
  Edit,
  Save,
  X
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface LineItem {
  code: string;
  description: string;
  category: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total: number;
}

interface ScopeDocument {
  id: string;
  document_number: string;
  document_type: string;
  version: number;
  status: string;
  line_items: LineItem[];
  total_amount: number;
  xactimate_compatible: boolean;
  created_at: string;
}

interface ScopeDocumentBuilderProps {
  jobId: string;
  insuranceClaimId?: string;
  damageAnalysis?: any;
  onDocumentCreated?: (doc: ScopeDocument) => void;
}

export const ScopeDocumentBuilder: React.FC<ScopeDocumentBuilderProps> = ({
  jobId,
  insuranceClaimId,
  damageAnalysis,
  onDocumentCreated,
}) => {
  const { profile } = useUserProfile();
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [existingDocument, setExistingDocument] = useState<ScopeDocument | null>(null);

  const [newItem, setNewItem] = useState<LineItem>({
    code: '',
    description: '',
    category: 'Roofing',
    quantity: 1,
    unit: 'SQ',
    unit_price: 0,
    total: 0,
  });

  useEffect(() => {
    if (insuranceClaimId) {
      fetchExistingScope();
    }
  }, [insuranceClaimId]);

  const fetchExistingScope = async () => {
    try {
      const { data, error } = await supabase
        .from('scope_documents')
        .select('*')
        .eq('insurance_claim_id', insuranceClaimId)
        .eq('document_type', 'initial_scope')
        .order('version', { ascending: false })
        .limit(1)
        .single();

      if (!error && data) {
        setExistingDocument(data as any);
        setLineItems((data.line_items as any) || []);
      }
    } catch (error) {
      // No existing scope, that's fine
    }
  };

  const generateFromDamageAnalysis = async () => {
    setGenerating(true);
    try {
      const response = await supabase.functions.invoke('generate-scope-document', {
        body: {
          job_id: jobId,
          damage_analysis: damageAnalysis,
          insurance_claim_id: insuranceClaimId,
        },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      const scopeDoc = response.data.scope_document;
      setLineItems(scopeDoc.line_items || []);
      setExistingDocument(scopeDoc);
      toast.success('Scope document generated from damage analysis');
      onDocumentCreated?.(scopeDoc);
    } catch (error: any) {
      console.error('Error generating scope:', error);
      toast.error(error.message || 'Failed to generate scope document');
    } finally {
      setGenerating(false);
    }
  };

  const addLineItem = () => {
    if (!newItem.description || !newItem.quantity) {
      toast.error('Please fill in description and quantity');
      return;
    }

    const total = newItem.quantity * newItem.unit_price;
    setLineItems([...lineItems, { ...newItem, total }]);
    setNewItem({
      code: '',
      description: '',
      category: 'Roofing',
      quantity: 1,
      unit: 'SQ',
      unit_price: 0,
      total: 0,
    });
  };

  const removeLineItem = (index: number) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  const updateLineItem = (index: number, updates: Partial<LineItem>) => {
    const updated = [...lineItems];
    updated[index] = { 
      ...updated[index], 
      ...updates,
      total: (updates.quantity ?? updated[index].quantity) * (updates.unit_price ?? updated[index].unit_price)
    };
    setLineItems(updated);
  };

  const saveScope = async () => {
    if (!profile?.tenant_id) return;

    setSaving(true);
    try {
      const totalAmount = lineItems.reduce((sum, item) => sum + item.total, 0);

      if (existingDocument) {
        const { error } = await supabase
          .from('scope_documents')
          .update({
            line_items: lineItems as any,
            total_amount: totalAmount,
            status: 'draft',
          })
          .eq('id', existingDocument.id);

        if (error) throw error;
        toast.success('Scope document updated');
      } else {
        const { data, error } = await supabase
          .from('scope_documents')
          .insert({
            tenant_id: profile.tenant_id,
            job_id: jobId,
            insurance_claim_id: insuranceClaimId,
            document_number: `SCOPE-${Date.now().toString(36).toUpperCase()}`,
            document_type: 'initial_scope',
            version: 1,
            status: 'draft',
            line_items: lineItems as any,
            total_amount: totalAmount,
            xactimate_compatible: true,
          })
          .select()
          .single();

        if (error) throw error;
        setExistingDocument(data as any);
        toast.success('Scope document created');
        onDocumentCreated?.(data as any);
      }
    } catch (error: any) {
      console.error('Error saving scope:', error);
      toast.error(error.message || 'Failed to save scope document');
    } finally {
      setSaving(false);
    }
  };

  const totalAmount = lineItems.reduce((sum, item) => sum + item.total, 0);

  const categories = ['Roofing', 'Gutters', 'Siding', 'Exterior', 'Interior', 'Other'];
  const units = ['SQ', 'SF', 'LF', 'EA', 'HR'];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Scope Document Builder
            </CardTitle>
            <CardDescription>
              Build Xactimate-compatible scope documents with AI assistance
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {damageAnalysis && (
              <Button 
                variant="outline" 
                onClick={generateFromDamageAnalysis}
                disabled={generating}
              >
                {generating ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent mr-2" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Generate from Damage Analysis
                  </>
                )}
              </Button>
            )}
            <Button onClick={saveScope} disabled={saving || lineItems.length === 0}>
              {saving ? 'Saving...' : 'Save Scope'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {existingDocument && (
          <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
            <Badge variant="secondary">{existingDocument.document_number}</Badge>
            <Badge variant="outline">v{existingDocument.version}</Badge>
            <Badge className={cn(
              existingDocument.status === 'approved' ? 'bg-green-500' :
              existingDocument.status === 'submitted' ? 'bg-blue-500' :
              'bg-yellow-500'
            )}>
              {existingDocument.status}
            </Badge>
            {existingDocument.xactimate_compatible && (
              <Badge variant="outline" className="gap-1">
                <CheckCircle className="h-3 w-3" />
                Xactimate Compatible
              </Badge>
            )}
          </div>
        )}

        {/* Line Items Table */}
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Code</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[100px]">Category</TableHead>
                <TableHead className="w-[80px] text-right">Qty</TableHead>
                <TableHead className="w-[60px]">Unit</TableHead>
                <TableHead className="w-[100px] text-right">Unit Price</TableHead>
                <TableHead className="w-[100px] text-right">Total</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineItems.map((item, index) => (
                <TableRow key={index}>
                  <TableCell>
                    {editingIndex === index ? (
                      <Input
                        value={item.code}
                        onChange={(e) => updateLineItem(index, { code: e.target.value })}
                        className="h-8"
                      />
                    ) : (
                      <span className="font-mono text-xs">{item.code}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {editingIndex === index ? (
                      <Input
                        value={item.description}
                        onChange={(e) => updateLineItem(index, { description: e.target.value })}
                        className="h-8"
                      />
                    ) : (
                      item.description
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {item.category}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {editingIndex === index ? (
                      <Input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateLineItem(index, { quantity: parseFloat(e.target.value) || 0 })}
                        className="h-8 w-16 text-right"
                      />
                    ) : (
                      item.quantity
                    )}
                  </TableCell>
                  <TableCell>{item.unit}</TableCell>
                  <TableCell className="text-right">
                    {editingIndex === index ? (
                      <Input
                        type="number"
                        value={item.unit_price}
                        onChange={(e) => updateLineItem(index, { unit_price: parseFloat(e.target.value) || 0 })}
                        className="h-8 w-20 text-right"
                      />
                    ) : (
                      `$${item.unit_price.toFixed(2)}`
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    ${item.total.toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {editingIndex === index ? (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-7 w-7"
                          onClick={() => setEditingIndex(null)}
                        >
                          <Save className="h-3 w-3" />
                        </Button>
                      ) : (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-7 w-7"
                          onClick={() => setEditingIndex(index)}
                        >
                          <Edit className="h-3 w-3" />
                        </Button>
                      )}
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-7 w-7 text-destructive"
                        onClick={() => removeLineItem(index)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}

              {/* Add New Item Row */}
              <TableRow className="bg-muted/30">
                <TableCell>
                  <Input
                    value={newItem.code}
                    onChange={(e) => setNewItem({ ...newItem, code: e.target.value })}
                    placeholder="Code"
                    className="h-8"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={newItem.description}
                    onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                    placeholder="Item description..."
                    className="h-8"
                  />
                </TableCell>
                <TableCell>
                  <select
                    value={newItem.category}
                    onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}
                    className="h-8 w-full rounded border bg-background px-2 text-xs"
                  >
                    {categories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    value={newItem.quantity}
                    onChange={(e) => setNewItem({ ...newItem, quantity: parseFloat(e.target.value) || 0 })}
                    className="h-8 w-16 text-right"
                  />
                </TableCell>
                <TableCell>
                  <select
                    value={newItem.unit}
                    onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
                    className="h-8 w-full rounded border bg-background px-2 text-xs"
                  >
                    {units.map(unit => (
                      <option key={unit} value={unit}>{unit}</option>
                    ))}
                  </select>
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    value={newItem.unit_price}
                    onChange={(e) => setNewItem({ ...newItem, unit_price: parseFloat(e.target.value) || 0 })}
                    className="h-8 w-20 text-right"
                  />
                </TableCell>
                <TableCell className="text-right font-medium">
                  ${(newItem.quantity * newItem.unit_price).toFixed(2)}
                </TableCell>
                <TableCell>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-7 w-7"
                    onClick={addLineItem}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {/* Total */}
        <div className="flex justify-end">
          <div className="bg-muted/50 rounded-lg p-4 min-w-[200px]">
            <div className="text-sm text-muted-foreground">Total Amount</div>
            <div className="text-2xl font-bold">
              ${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default ScopeDocumentBuilder;
