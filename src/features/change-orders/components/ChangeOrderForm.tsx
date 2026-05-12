import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Upload, Loader2, Trash2, Plus, FileText } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useLaborRates, calculateEffectiveRate } from '@/hooks/useLaborRates';

const formSchema = z.object({
  project_id: z.string().min(1, 'Project is required'),
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  reason: z.string().min(1, 'Reason is required'),
  original_scope: z.string().optional(),
  new_scope: z.string().min(1, 'New scope is required'),
  time_impact_days: z.string().optional(),
});

interface LineItem {
  id: string;
  kind: 'material' | 'labor';
  description: string;
  quantity: number;
  unit_price: number;
  unit_of_measure?: string;
}

interface ChangeOrderFormProps {
  onClose: () => void;
  onSuccess: () => void;
  defaultProjectId?: string;
}

const newRow = (kind: 'material' | 'labor'): LineItem => ({
  id: crypto.randomUUID(),
  kind,
  description: '',
  quantity: 1,
  unit_price: 0,
  unit_of_measure: kind === 'labor' ? 'HR' : 'EA',
});

const getFunctionErrorMessage = async (error: any): Promise<string> => {
  try {
    const context = error?.context;
    if (context instanceof Response) {
      const body = await context.clone().json();
      if (body?.error) return body.error;
    }
  } catch {
    // Fall back to the Supabase client error message below.
  }
  return error?.message || 'AI could not parse it. Add line items manually below.';
};

export function ChangeOrderForm({ onClose, onSuccess, defaultProjectId }: ChangeOrderFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [items, setItems] = useState<LineItem[]>([]);
  const [overheadPct, setOverheadPct] = useState<number>(10);
  const [profitPct, setProfitPct] = useState<number>(20);
  const [quickLaborHours, setQuickLaborHours] = useState<number>(0);
  const [quickLaborRate, setQuickLaborRate] = useState<number>(75);
  const [invoiceFile, setInvoiceFile] = useState<{ url: string; path: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const tenantId = useEffectiveTenantId();

  const { data: projects } = useQuery({
    queryKey: ['projects-for-co'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('id, name, project_number')
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: !defaultProjectId,
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { time_impact_days: '0', project_id: defaultProjectId || '' },
  });

  const materialTotal = items
    .filter((i) => i.kind === 'material')
    .reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);
  const laborTotal = items
    .filter((i) => i.kind === 'labor')
    .reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);
  const subtotal = materialTotal + laborTotal;
  const overheadAmount = subtotal * (overheadPct / 100);
  const profitAmount = (subtotal + overheadAmount) * (profitPct / 100);
  const grandTotal = subtotal + overheadAmount + profitAmount;

  const addQuickLabor = () => {
    if (quickLaborHours <= 0) {
      toast({ title: 'Enter hours', description: 'Add labor hours first.', variant: 'destructive' });
      return;
    }
    setItems((p) => [
      ...p,
      {
        id: crypto.randomUUID(),
        kind: 'labor',
        description: 'Labor',
        quantity: quickLaborHours,
        unit_price: quickLaborRate,
        unit_of_measure: 'HR',
      },
    ]);
    setQuickLaborHours(0);
  };

  const updateItem = (id: string, patch: Partial<LineItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };
  const removeItem = (id: string) => setItems((prev) => prev.filter((it) => it.id !== id));

  const handleInvoiceUpload = async (file: File) => {
    if (!tenantId) {
      toast({ title: 'No tenant', description: 'Tenant not loaded yet.', variant: 'destructive' });
      return;
    }
    setIsParsing(true);
    try {
      // 1. Upload to storage (tenant_id as first folder per RLS)
      const ext = file.name.split('.').pop() || 'pdf';
      const path = `${tenantId}/change-orders/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage
        .from('documents')
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;

      const { data: signed } = await supabase.storage
        .from('documents')
        .createSignedUrl(path, 60 * 60);
      const url = signed?.signedUrl;
      if (!url) throw new Error('Failed to get signed URL');

      setInvoiceFile({ url, path, name: file.name });

      // 2. Parse with AI. Keep the uploaded invoice even if AI parsing fails.
      const { data: parsed, error: parseErr } = await supabase.functions.invoke(
        'parse-invoice-document',
        { body: { document_url: url } }
      );
      if (parseErr) {
        const parseMessage = await getFunctionErrorMessage(parseErr);
        toast({
          title: 'Invoice uploaded',
          description: `${parseMessage} Add material and labor line items manually below.`,
        });
        return;
      }

      const lineItems = parsed?.parsed?.line_items || [];
      if (lineItems.length === 0) {
        toast({
          title: 'Invoice uploaded',
          description: 'No line items detected automatically. Add them manually below.',
        });
      } else {
        const materialRows: LineItem[] = lineItems.map((li: any) => ({
          id: crypto.randomUUID(),
          kind: 'material',
          description: li.description || 'Material',
          quantity: Number(li.quantity) || 1,
          unit_price: Number(li.unit_price) || Number(li.line_total) || 0,
          unit_of_measure: li.unit_of_measure || 'EA',
        }));
        setItems((prev) => [...prev, ...materialRows]);
        toast({
          title: 'Invoice parsed',
          description: `Added ${materialRows.length} material line items.`,
        });
      }
    } catch (err: any) {
      console.error('[invoice upload]', err);
      toast({
        title: 'Upload failed',
        description: err.message || 'Could not upload invoice',
        variant: 'destructive',
      });
    } finally {
      setIsParsing(false);
    }
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not found');

      const coNumber = `CO-${Date.now()}`;

      const { error } = await (supabase as any).from('change_orders').insert({
        project_id: values.project_id,
        co_number: coNumber,
        title: values.title,
        description: values.description,
        reason: values.reason,
        original_scope: values.original_scope,
        new_scope: values.new_scope,
        cost_impact: grandTotal,
        material_total: materialTotal,
        labor_total: laborTotal,
        line_items: { items, overhead_pct: overheadPct, profit_pct: profitPct, overhead_amount: overheadAmount, profit_amount: profitAmount, subtotal },
        material_invoice_url: invoiceFile?.url || null,
        material_invoice_storage_path: invoiceFile?.path || null,
        time_impact_days: parseInt(values.time_impact_days || '0'),
        requested_by: user.id,
        status: 'draft',
      });

      if (error) throw error;

      toast({ title: 'Success', description: 'Change order created successfully' });
      onSuccess();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Change Order</DialogTitle>
          <DialogDescription>
            Upload a material invoice and add labor — totals build the change order automatically.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {!defaultProjectId && (
              <FormField
                control={form.control}
                name="project_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select project" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {projects?.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.name} ({project.project_number})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="Brief description of change" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason for Change</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Why is this change necessary?" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* ===== Material invoice upload ===== */}
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-sm">Material Invoice</h4>
                  <p className="text-xs text-muted-foreground">
                    Upload a supplier invoice — AI extracts material line items automatically.
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleInvoiceUpload(f);
                    e.target.value = '';
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isParsing}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {isParsing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  {isParsing ? 'Parsing…' : 'Upload Invoice'}
                </Button>
              </div>
              {invoiceFile && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" />
                  <a href={invoiceFile.url} target="_blank" rel="noreferrer" className="underline">
                    {invoiceFile.name}
                  </a>
                </div>
              )}
            </div>

            {/* ===== Line items ===== */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm">Line Items</h4>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setItems((p) => [...p, newRow('material')])}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Material
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setItems((p) => [...p, newRow('labor')])}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Labor
                  </Button>
                </div>
              </div>

              {items.length === 0 ? (
                <p className="text-xs text-muted-foreground py-3 text-center border border-dashed rounded">
                  No line items. Upload an invoice or add rows above.
                </p>
              ) : (
                <div className="space-y-2">
                  {items.map((it) => {
                    const lineTotal = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
                    return (
                      <div
                        key={it.id}
                        className="grid grid-cols-12 gap-2 items-center text-sm border rounded p-2"
                      >
                        <span
                          className={`col-span-1 text-xs font-medium px-2 py-0.5 rounded text-center ${
                            it.kind === 'material'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {it.kind === 'material' ? 'MAT' : 'LAB'}
                        </span>
                        <Input
                          className="col-span-5 h-8"
                          placeholder="Description"
                          value={it.description}
                          onChange={(e) => updateItem(it.id, { description: e.target.value })}
                        />
                        <Input
                          className="col-span-1 h-8"
                          type="number"
                          step="0.01"
                          value={it.quantity}
                          onChange={(e) =>
                            updateItem(it.id, { quantity: parseFloat(e.target.value) || 0 })
                          }
                        />
                        <Input
                          className="col-span-2 h-8"
                          type="number"
                          step="0.01"
                          placeholder="Unit $"
                          value={it.unit_price}
                          onChange={(e) =>
                            updateItem(it.id, { unit_price: parseFloat(e.target.value) || 0 })
                          }
                        />
                        <span className="col-span-2 text-right font-medium">
                          ${lineTotal.toFixed(2)}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="col-span-1 h-8 w-8"
                          onClick={() => removeItem(it.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Quick labor add */}
              <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
                <h4 className="font-semibold text-sm">Add Labor Cost</h4>
                <p className="text-xs text-muted-foreground">
                  Use this if labor isn't included in the uploaded invoice.
                </p>
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-4">
                    <label className="text-xs text-muted-foreground">Hours</label>
                    <Input
                      type="number"
                      step="0.5"
                      value={quickLaborHours || ''}
                      onChange={(e) => setQuickLaborHours(parseFloat(e.target.value) || 0)}
                      placeholder="0"
                    />
                  </div>
                  <div className="col-span-4">
                    <label className="text-xs text-muted-foreground">Rate ($/hr)</label>
                    <Input
                      type="number"
                      step="0.01"
                      value={quickLaborRate || ''}
                      onChange={(e) => setQuickLaborRate(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div className="col-span-2 text-sm font-medium">
                    ${(quickLaborHours * quickLaborRate).toFixed(2)}
                  </div>
                  <Button type="button" size="sm" className="col-span-2" onClick={addQuickLabor}>
                    Add
                  </Button>
                </div>
              </div>

              {/* Overhead & profit controls */}
              <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
                <h4 className="font-semibold text-sm">Overhead & Profit</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Overhead %</label>
                    <Input
                      type="number"
                      step="0.1"
                      value={overheadPct}
                      onChange={(e) => setOverheadPct(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Profit %</label>
                    <Input
                      type="number"
                      step="0.1"
                      value={profitPct}
                      onChange={(e) => setProfitPct(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>
              </div>

              {/* totals */}
              <div className="rounded-lg bg-muted/40 p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Materials</span>
                  <span>${materialTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Labor</span>
                  <span>${laborTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between border-t pt-1 mt-1">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>${subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Overhead ({overheadPct}%)</span>
                  <span>${overheadAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Profit ({profitPct}%)</span>
                  <span>${profitAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-semibold border-t pt-1 mt-1 text-base">
                  <span>Total Change Order</span>
                  <span>${grandTotal.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <FormField
              control={form.control}
              name="time_impact_days"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Time Impact (days)</FormLabel>
                  <FormControl>
                    <Input type="number" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="original_scope"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Original Scope</FormLabel>
                  <FormControl>
                    <Textarea placeholder="What was originally planned?" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="new_scope"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Scope</FormLabel>
                  <FormControl>
                    <Textarea placeholder="What will be done instead?" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Additional Details</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Any additional information..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Change Order
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
