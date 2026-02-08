'use client';

import RelaycastProvider from '@/components/RelaycastProvider';
import { useAuthStore } from '@/lib/store';

function OverviewContent() {
  const workspace = useAuthStore((s) => s.workspace);

  return (
    <div className="p-8">
      <h1 className="mb-2 text-2xl font-semibold text-text">
        Welcome to {workspace?.name ?? 'Relaycast'}
      </h1>
      <p className="text-sm text-text-muted">
        Your workspace overview will appear here.
      </p>
    </div>
  );
}

export default function OverviewPage() {
  return (
    <RelaycastProvider>
      <OverviewContent />
    </RelaycastProvider>
  );
}
