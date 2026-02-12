import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { Loader2 } from "lucide-react";

const ProjectDetailsPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) return;

    const lookup = async () => {
      const { data, error: err } = await supabase
        .from('projects')
        .select('pipeline_entry_id')
        .eq('id', id)
        .maybeSingle();

      if (err || !data?.pipeline_entry_id) {
        setError(true);
        return;
      }

      navigate(`/lead/${data.pipeline_entry_id}`, { replace: true });
    };

    lookup();
  }, [id, navigate]);

  if (error) {
    return (
      <GlobalLayout>
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          Project not found
        </div>
      </GlobalLayout>
    );
  }

  return (
    <GlobalLayout>
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground">Redirecting...</span>
      </div>
    </GlobalLayout>
  );
};

export default ProjectDetailsPage;
