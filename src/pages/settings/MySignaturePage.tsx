import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import MySignaturePanel from '@/features/settings/components/MySignaturePanel';

export default function MySignaturePage() {
  return (
    <GlobalLayout>
      <div className="max-w-3xl mx-auto p-6">
        <MySignaturePanel />
      </div>
    </GlobalLayout>
  );
}
