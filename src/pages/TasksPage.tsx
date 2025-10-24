import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import TaskList from "@/features/tasks/components/TaskList";
import { useState } from "react";
import TaskDetail from "@/features/tasks/components/TaskDetail";

const TasksPage = () => {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const handleTaskSelect = (task: any) => {
    setSelectedTaskId(task.id);
    setDetailOpen(true);
  };

  return (
    <GlobalLayout>
      <TaskList onTaskSelect={handleTaskSelect} />
      <TaskDetail
        taskId={selectedTaskId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </GlobalLayout>
  );
};

export default TasksPage;
