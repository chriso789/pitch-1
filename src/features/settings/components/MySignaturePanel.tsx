import React, { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Pen, RotateCcw, Upload, Loader2, Check } from 'lucide-react';

interface MySignaturePanelProps {
  userId?: string;
  hideHeader?: boolean;
  title?: string;
  description?: string;
}

export default function MySignaturePanel({ userId, hideHeader, title, description }: MySignaturePanelProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savedSig, setSavedSig] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [targetUserId, setTargetUserId] = useState<string | null>(userId ?? null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      let uid = userId ?? null;
      if (!uid) {
        const { data: { user } } = await supabase.auth.getUser();
        uid = user?.id ?? null;
      }
      if (!uid) { setLoading(false); return; }
      setTargetUserId(uid);
      const { data } = await supabase
        .from('profiles')
        .select('signature_image_path, signature_updated_at')
        .eq('id', uid)
        .maybeSingle();
      setSavedSig(data?.signature_image_path ?? null);
      setSavedAt(data?.signature_updated_at ?? null);
      setLoading(false);
    })();
  }, [userId]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = c.offsetWidth;
    c.height = c.offsetHeight;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, [savedSig, loading]);

  const getPoint = (e: React.MouseEvent | React.TouchEvent) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const start = (e: React.MouseEvent | React.TouchEvent) => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const p = getPoint(e);
    setDrawing(true);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing) return;
    if ('touches' in e) e.preventDefault();
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const p = getPoint(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const stop = () => {
    if (drawing) { setDrawing(false); setHasInk(true); }
  };
  const clearPad = () => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  const persistDataUrl = async (dataUrl: string) => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('profiles')
        .update({ signature_image_path: dataUrl, signature_updated_at: now })
        .eq('id', user.id);
      if (error) throw error;
      setSavedSig(dataUrl);
      setSavedAt(now);
      setHasInk(false);
      clearPad();
      toast.success('Signature saved');
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Could not save signature');
    } finally {
      setSaving(false);
    }
  };

  const saveDrawn = async () => {
    const c = canvasRef.current; if (!c || !hasInk) return;
    await persistDataUrl(c.toDataURL('image/png'));
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 500_000) {
      toast.error('Image too large (max 500KB)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') persistDataUrl(reader.result);
    };
    reader.readAsDataURL(f);
  };

  const removeSig = async () => {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    await supabase
      .from('profiles')
      .update({ signature_image_path: null, signature_updated_at: null })
      .eq('id', user.id);
    setSavedSig(null); setSavedAt(null); setSaving(false);
    toast.success('Signature removed');
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold">My Signature</h2>
        <p className="text-muted-foreground text-sm">
          This signature is automatically stamped on every document you finalize as the company
          representative, after the client signs.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {savedSig && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Check className="h-4 w-4 text-green-600" /> Saved Signature
                </CardTitle>
                <CardDescription>
                  {savedAt ? `Last updated ${new Date(savedAt).toLocaleString()}` : ''}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="border rounded-md bg-muted/30 p-4 flex items-center justify-center">
                  <img src={savedSig} alt="Saved signature" className="max-h-32 object-contain" />
                </div>
                <div className="flex justify-end mt-3">
                  <Button variant="outline" size="sm" onClick={removeSig} disabled={saving}>
                    Remove
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Pen className="h-4 w-4" /> {savedSig ? 'Replace Signature' : 'Draw Signature'}
              </CardTitle>
              <CardDescription>Draw with your mouse or finger.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border-2 border-dashed border-muted-foreground/30 rounded-md bg-white">
                <canvas
                  ref={canvasRef}
                  className="w-full h-48 cursor-crosshair touch-none"
                  onMouseDown={start}
                  onMouseMove={move}
                  onMouseUp={stop}
                  onMouseLeave={stop}
                  onTouchStart={start}
                  onTouchMove={move}
                  onTouchEnd={stop}
                  style={{ touchAction: 'none' }}
                />
              </div>
              <div className="flex items-center justify-between mt-3">
                <Button variant="outline" size="sm" onClick={clearPad} disabled={!hasInk || saving}>
                  <RotateCcw className="h-4 w-4 mr-1" /> Clear
                </Button>
                <Button onClick={saveDrawn} disabled={!hasInk || saving}>
                  {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                  Save Signature
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Upload className="h-4 w-4" /> Upload Image
              </CardTitle>
              <CardDescription>PNG or JPG, max 500KB. Transparent background recommended.</CardDescription>
            </CardHeader>
            <CardContent>
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={onFile}
                disabled={saving}
                className="block w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground hover:file:opacity-90"
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
