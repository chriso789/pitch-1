import { useParams, useNavigate } from "react-router-dom";
import ProjectDetails from "@/features/projects/components/ProjectDetails";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";

const ProjectDetailsPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  if (!id) {
    return (
      <GlobalLayout>
        <div className="p-6">Project ID not found</div>
      </GlobalLayout>
    );
  }

  const handleBack = () => {
    navigate(-1);
  };

  return (
    <GlobalLayout>
      <ProjectDetails projectId={id} onBack={handleBack} />
    </GlobalLayout>
  );
};

export default ProjectDetailsPage;
