import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, MessageSquare, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

interface CloseoutPayload {
  ok: true;
  enabled: boolean;
  headline: string;
  message: string;
  feedback_enabled: boolean;
  feedback_submitted: boolean;
  destinations: { id: string; platform: string; label: string }[];
}

const route = (path: string, params: Record<string, string> = {}) => {
  const url = new URL(`${SUPABASE_URL}/functions/v1/email-api`);
  url.searchParams.set("__route", path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
};
const headers = { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` };

export function CloseoutReviewSection({ deliveryId }: { deliveryId: string }) {
  const [data, setData] = useState<CloseoutPayload | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(route("/closeout/view", { d: deliveryId }), { headers })
      .then((r) => r.json())
      .then((b) => b?.ok && setData(b))
      .catch(() => undefined);
  }, [deliveryId]);

  if (!data?.enabled) return null;

  const submit = async () => {
    if (!rating) return;
    setSaving(true);
    try {
      const r = await fetch(route("/closeout/feedback"), {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ d: deliveryId, rating, comment }),
      });
      if (r.ok) setDone(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mb-5 grid gap-5 border border-border bg-card p-5 shadow-sm md:grid-cols-2">
      {data.destinations.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold">{data.headline}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{data.message}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {data.destinations.map((d) => (
              <Button key={d.id} variant="outline" asChild>
                <a href={route("/closeout/review", { d: deliveryId, r: d.id })} target="_blank" rel="noopener noreferrer">
                  {d.label} <ExternalLink className="ml-2 h-4 w-4" />
                </a>
              </Button>
            ))}
          </div>
        </div>
      )}
      {data.feedback_enabled && (
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <MessageSquare className="h-5 w-5" /> Private feedback
          </h2>
          {done || data.feedback_submitted ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" /> Thank you — your feedback was sent to the team.
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted-foreground">Tell us directly how the project went.</p>
              <div className="mt-3 flex gap-1" role="radiogroup" aria-label="Rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" aria-label={`${n} of 5`} onClick={() => setRating(n)}>
                    <Star className={`h-7 w-7 ${n <= rating ? "fill-primary text-primary" : "text-muted-foreground"}`} />
                  </button>
                ))}
              </div>
              <Textarea className="mt-3" rows={3} maxLength={2000} placeholder="Comments (optional)"
                value={comment} onChange={(e) => setComment(e.target.value)} />
              <Button className="mt-3" onClick={submit} disabled={!rating || saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send feedback
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
