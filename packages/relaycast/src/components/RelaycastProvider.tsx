'use client';

import AuthGate from './AuthGate';
import RelaycastSidebar from './RelaycastSidebar';

export default function RelaycastProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGate>
      <div className="flex h-screen overflow-hidden bg-bg">
        <RelaycastSidebar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </AuthGate>
  );
}
