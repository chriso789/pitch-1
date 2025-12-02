import { useParams } from 'react-router-dom';
import { MeasurementCorrectionSystem } from '@/components/roof-measurement';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';

const MeasurementCorrectionPage = () => {
  const { id } = useParams<{ id: string }>();

  if (!id) {
    return (
      <GlobalLayout>
        <div className="p-8 text-center">
          <p className="text-muted-foreground">No measurement ID provided</p>
        </div>
      </GlobalLayout>
    );
  }

  return (
    <GlobalLayout>
      <MeasurementCorrectionSystem measurementId={id} />
    </GlobalLayout>
  );
};

export default MeasurementCorrectionPage;
