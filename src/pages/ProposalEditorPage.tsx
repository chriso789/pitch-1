import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProposalBuilder } from '@/components/proposals/ProposalBuilder';

const ProposalEditorPage = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  if (!projectId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">No project selected</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-7xl py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Create Proposal</h1>
            <p className="text-muted-foreground">
              Build a professional proposal with Good/Better/Best pricing
            </p>
          </div>
        </div>

        {/* Proposal Builder */}
        <ProposalBuilder
          projectId={projectId}
          onComplete={(estimateId) => {
            navigate(`/estimates/${estimateId}`);
          }}
        />
      </div>
    </div>
  );
};

export default ProposalEditorPage;
