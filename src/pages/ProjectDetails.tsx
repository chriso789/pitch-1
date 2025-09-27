import { useParams, useNavigate } from "react-router-dom";
import ProjectDetails from "@/features/projects/components/ProjectDetails";

const ProjectDetailsPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  if (!id) {
    return <div className="p-6">Project ID not found</div>;
  }

  const handleBack = () => {
    navigate(-1);
  };

  return <ProjectDetails projectId={id} onBack={handleBack} />;
};

export default ProjectDetailsPage;