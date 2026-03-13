import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";

/**
 * /deeplink — Resolves pitchcrm:// deep links passed as query params.
 * 
 * Usage: /deeplink?url=pitchcrm://job/123
 * Maps:
 *   pitchcrm://job/:id       → /job/:id
 *   pitchcrm://contact/:id   → /contact/:id
 *   pitchcrm://project/:id   → /project/:id
 *   pitchcrm://lead/:id      → /lead/:id
 *   pitchcrm://dashboard     → /dashboard
 */
const DeepLinkResolver = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const rawUrl = searchParams.get("url") || "";
    const resolved = resolveDeepLink(rawUrl);
    navigate(resolved, { replace: true });
  }, [searchParams, navigate]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Redirecting...</p>
      </div>
    </div>
  );
};

function resolveDeepLink(url: string): string {
  // Strip the scheme: pitchcrm://job/123 → job/123
  const path = url.replace(/^pitchcrm:\/\//, "").replace(/^\/+/, "");
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return "/dashboard";

  const [first, second, third, fourth] = segments;

  // Compound routes
  if (first === 'job' && second && third === 'photos') return `/app/mobile/jobs/${second}/photos`;
  if (first === 'job' && second && third === 'note' && fourth === 'new') return `/job/${second}?action=new-note`;
  if (first === 'alerts') return '/app/mobile/alerts';
  if (first === 'tasks') return '/tasks';
  if (first === 'appointments' && second === 'today') return '/calendar?view=today';
  if (first === 'field') return '/app/mobile/field';

  // Simple entity routes
  const routes: Record<string, (id: string) => string> = {
    job: (id) => `/job/${id}`,
    contact: (id) => `/contact/${id}`,
    project: (id) => `/project/${id}`,
    lead: (id) => `/lead/${id}`,
  };

  if (routes[first] && second) {
    return routes[first](second);
  }

  // Direct route match (e.g., pitchcrm://dashboard)
  return `/${path}`;
}

export default DeepLinkResolver;
