import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, Download } from 'lucide-react';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);

export default function PublicChangeOrderView() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedName, setSignedName] = useState('');
  const [signedEmail, setSignedEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [signedConfirmed, setSignedConfirmed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const docRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: res, error } = await supabase.functions.invoke('get-change-order-by-token', { body: { token } });
        if (error) throw error;
        if ((res as any)?.error) throw new Error((res as any).error);
        setData(res);
        setSignedName((res as any).recipient_name || '');
        setSignedEmail((res as any).recipient_email || '');
      } catch (e: any) {
        setError(e.message || 'Unable to load change order');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const startDraw = (e: React.PointerEvent) => {
    drawing.current = true;
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    const ctx = c.getContext('2d')!;
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };
  const moveDraw = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    const ctx = c.getContext('2d')!;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111';
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };
  const endDraw = () => { drawing.current = false; };
  const clearSig = () => {
    const c = canvasRef.current; if (!c) return;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
  };

  const handleApprove = async () => {
    if (!signedName.trim()) { toast.error('Please type your full name'); return; }
    setSubmitting(true);
    try {
      const sig = canvasRef.current?.toDataURL('image/png') || null;
      const { data: res, error } = await supabase.functions.invoke('sign-change-order', {
        body: { token, signed_by_name: signedName, signed_by_email: signedEmail, signature_data_url: sig },
      });
      if (error) throw error;
      if ((res as any)?.error) throw new Error((res as any).error);
      setSignedConfirmed(true);
      toast.success('Change order approved. Thank you!');
    } catch (e: any) {
      toast.error(e.message || 'Approval failed');
    } finally {
      setSubmitting(false);
    }
  };

  const downloadPdf = async () => {
    const html2canvas = (await import('html2canvas')).default;
    const jsPDF = (await import('jspdf')).default;
    if (!docRef.current) return;
    const canvas = await html2canvas(docRef.current, { scale: 1.5, useCORS: true, backgroundColor: '#fff' });
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
    const w = 215.9, ph = 279.4;
    const h = (canvas.height * w) / canvas.width;
    const img = canvas.toDataURL('image/jpeg', 0.7);
    let left = h, pos = 0;
    pdf.addImage(img, 'JPEG', 0, pos, w, h); left -= ph;
    while (left > 0) { pos = left - h; pdf.addPage(); pdf.addImage(img, 'JPEG', 0, pos, w, h); left -= ph; }
    pdf.save(`${data?.change_order?.co_number || 'change-order'}.pdf`);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (error) return <div className="min-h-screen flex items-center justify-center text-center p-8"><div><h1 className="text-xl font-semibold mb-2">Link unavailable</h1><p className="text-muted-foreground">{error}</p></div></div>;

  const co = data.change_order;
  const company = data.company || {};
  const customer = data.customer || {};
  const container: any = co.line_items || {};
  const items: any[] = Array.isArray(co.line_items) ? co.line_items : (container.items || []);
  const lineTotal = (i: any) => (Number(i.quantity ?? i.qty ?? 1) || 0) * (Number(i.unit_price ?? i.price ?? i.rate ?? 0) || 0);
  const matSum = items.filter((i) => (i.kind || 'material') !== 'labor').reduce((s, i) => s + (Number(i.line_total) || lineTotal(i)), 0);
  const labSum = items.filter((i) => i.kind === 'labor').reduce((s, i) => s + (Number(i.line_total) || lineTotal(i)), 0);
  const subtotal = (Number(co.material_total) || matSum) + (Number(co.labor_total) || labSum);
  const ohPct = Number(container.overhead_pct);
  const prPct = Number(container.profit_pct);
  const hasMarkup = Number.isFinite(ohPct) && Number.isFinite(prPct) && (ohPct + prPct) > 0 && (ohPct + prPct) < 100;
  const denom = hasMarkup ? Math.max(0.01, 1 - ohPct / 100 - prPct / 100) : 1;
  const computedPrice = subtotal / denom;
  const storedPrice = Number(co.cost_impact || 0);
  const priceToClient = storedPrice > subtotal + 0.5 ? storedPrice : (computedPrice || storedPrice || subtotal);
  const alreadySigned = data.already_signed || signedConfirmed;

  return (
    <div className="min-h-screen bg-muted/30 py-6 px-3">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={downloadPdf}><Download className="h-4 w-4 mr-1" /> Download PDF</Button>
        </div>

        <Card className="p-8 bg-white" ref={docRef as any}>
          <div className="flex justify-between border-b pb-4 mb-6">
            <div className="flex gap-4">
              {company.logo_url && <img src={company.logo_url} alt="logo" className="h-16 w-16 object-contain" />}
              <div>
                <h2 className="text-xl font-bold">{company.name}</h2>
                {company.address_street && <p className="text-sm text-muted-foreground">{company.address_street} {company.address_city}, {company.address_state} {company.address_zip}</p>}
                {(company.phone || company.email) && <p className="text-sm text-muted-foreground">{company.phone} {company.email && `• ${company.email}`}</p>}
                {company.license_number && <p className="text-xs text-muted-foreground">License #{company.license_number}</p>}
              </div>
            </div>
            <div className="text-right">
              <h1 className="text-2xl font-bold">CHANGE ORDER</h1>
              <p className="text-sm">{co.co_number}</p>
              <p className="text-sm text-muted-foreground">{new Date(co.created_at).toLocaleDateString()}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 mb-6">
            <div>
              <p className="text-xs uppercase text-muted-foreground tracking-wide">Customer</p>
              <p className="font-semibold">{customer.name}</p>
              {customer.address_street && <p className="text-sm">{customer.address_street} {customer.address_city}, {customer.address_state} {customer.address_zip}</p>}
              {(customer.phone || customer.email) && <p className="text-sm">{customer.phone} {customer.email && `• ${customer.email}`}</p>}
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground tracking-wide">Project</p>
              <p className="font-semibold">{co.title}</p>
              <p className="text-sm">Time impact: {co.time_impact_days || 0} days</p>
            </div>
          </div>

          {co.reason && (<div className="mb-4"><p className="text-xs uppercase text-muted-foreground tracking-wide">Reason for change</p><p className="text-sm">{co.reason}</p></div>)}
          {co.new_scope && (<div className="mb-4"><p className="text-xs uppercase text-muted-foreground tracking-wide">New scope</p><p className="text-sm">{co.new_scope}</p></div>)}

          {items.length > 0 && (
            <div className="mb-4">
              <p className="text-xs uppercase text-muted-foreground tracking-wide mb-2">Materials & line items</p>
              <table className="w-full text-sm border">
                <thead className="bg-muted">
                  <tr><th className="text-left p-2">Description</th><th className="text-right p-2 w-20">Qty</th><th className="text-right p-2 w-20">UOM</th></tr>
                </thead>
                <tbody>
                  {items.map((it: any, i: number) => (
                    <tr key={i} className="border-t"><td className="p-2">{it.description || it.name}</td><td className="text-right p-2">{it.quantity ?? it.qty ?? ''}</td><td className="text-right p-2">{it.unit || it.uom || ''}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="border-t pt-4 flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between font-bold text-base"><span>Price to Client</span><span>{fmt(Number(co.cost_impact || 0))}</span></div>
            </div>
          </div>
        </Card>

        <Card className="p-6 bg-white">
          {alreadySigned ? (
            <div className="text-center py-6">
              <CheckCircle2 className="h-12 w-12 mx-auto text-green-600 mb-2" />
              <h3 className="text-lg font-semibold">Change Order Approved</h3>
              <p className="text-sm text-muted-foreground">Signed by {data.signed_by_name || signedName} {data.signed_at ? `on ${new Date(data.signed_at).toLocaleString()}` : ''}</p>
            </div>
          ) : (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Approve & Sign</h3>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-muted-foreground">Full name</label><Input value={signedName} onChange={e => setSignedName(e.target.value)} placeholder="Your full name" /></div>
                <div><label className="text-xs text-muted-foreground">Email</label><Input value={signedEmail} onChange={e => setSignedEmail(e.target.value)} placeholder="you@email.com" /></div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Draw signature (optional)</label>
                <div className="border rounded-md bg-white">
                  <canvas
                    ref={canvasRef}
                    width={600}
                    height={140}
                    className="w-full touch-none"
                    onPointerDown={startDraw}
                    onPointerMove={moveDraw}
                    onPointerUp={endDraw}
                    onPointerLeave={endDraw}
                  />
                </div>
                <Button variant="ghost" size="sm" onClick={clearSig}>Clear</Button>
              </div>
              <p className="text-xs text-muted-foreground">By clicking Approve, you agree this constitutes your electronic signature. Your name, email, IP, browser, and timestamp will be recorded as proof of approval.</p>
              <Button className="w-full" disabled={submitting} onClick={handleApprove}>
                {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />} Approve Change Order
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
